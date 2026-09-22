from __future__ import annotations

import hashlib
import inspect
import json
import math
import time
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
from pathlib import Path

from .retained import CostModel, InstrumentSpec, calculate_round_trip_cost, compute_metrics_v2


ENGINE_VERSION = "bar-breakout-v1"


class ResearchEngineValidationError(ValueError):
    pass


class ResearchEngineInterrupted(RuntimeError):
    pass


def engine_code_sha256() -> str:
    package = Path(__file__).resolve().parent
    sources = {f"foundation/{path.name}": path for path in package.glob("*.py")}
    sources["foundation/uv.lock"] = package.parent / "uv.lock"
    for module in (CostModel, InstrumentSpec, calculate_round_trip_cost, compute_metrics_v2):
        sources[f"retained/{module.__module__}.py"] = Path(inspect.getfile(module))
    manifest = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in sources.items()}
    return hashlib.sha256(json.dumps(manifest, sort_keys=True).encode("utf-8")).hexdigest()


def _positive_int(value, name: str) -> int:
    if isinstance(value, bool):
        raise ResearchEngineValidationError(f"{name} must be a positive integer")
    try:
        number = int(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ResearchEngineValidationError(f"{name} must be a positive integer") from exc
    if number <= 0 or str(number) != str(value):
        raise ResearchEngineValidationError(f"{name} must be a positive integer")
    return number


def _positive_float(value, name: str) -> float:
    if isinstance(value, bool):
        raise ResearchEngineValidationError(f"{name} must be positive")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ResearchEngineValidationError(f"{name} must be positive") from exc
    if not math.isfinite(number) or number <= 0:
        raise ResearchEngineValidationError(f"{name} must be positive")
    return number


def validate_rules(rules: dict) -> None:
    allowed = {"engine", "lookback", "hold_bars", "quantity", "planned_stop_distance_price", "direction"}
    if set(rules) - allowed:
        raise ResearchEngineValidationError("unsupported rule fields; protective orders and margin are not implemented")
    if rules.get("engine") != ENGINE_VERSION:
        raise ResearchEngineValidationError(f"playbook rules must declare engine={ENGINE_VERSION}")
    for name in ("lookback", "hold_bars"):
        _positive_int(rules.get(name), f"rules.{name}")
    for name in ("quantity", "planned_stop_distance_price"):
        _positive_float(rules.get(name), f"rules.{name}")
    if rules.get("direction", "both") not in {"long", "short", "both"}:
        raise ResearchEngineValidationError("rules.direction must be long, short, or both")


def execute_breakout(rows: list[dict], protocol: dict, *, continue_check=None, deadline=None) -> dict:
    deadline = deadline if deadline is not None else time.perf_counter() + int(protocol["budget"]["max_runtime_ms"]) / 1000

    def check():
        if time.perf_counter() >= deadline:
            raise ResearchEngineValidationError("run exceeded budget.max_runtime_ms")
        if continue_check is not None and not continue_check():
            raise ResearchEngineInterrupted("research execution interrupted")

    check()
    if protocol.get("engine", {}).get("version") != ENGINE_VERSION:
        raise ResearchEngineValidationError("unsupported engine version")
    current_hash = engine_code_sha256()
    if current_hash != _LOADED_CODE_SHA256:
        raise ResearchEngineValidationError("engine sources changed; restart worker before execution")
    if protocol.get("engine", {}).get("code_sha256") != current_hash:
        raise ResearchEngineValidationError("engine code hash no longer matches queued protocol")

    rules = protocol.get("playbook", {}).get("rules") or {}
    validate_rules(rules)
    lookback = _positive_int(rules.get("lookback"), "rules.lookback")
    hold_bars = _positive_int(rules.get("hold_bars"), "rules.hold_bars")
    quantity = _positive_float(rules.get("quantity"), "rules.quantity")
    stop_distance = _positive_float(rules.get("planned_stop_distance_price"), "rules.planned_stop_distance_price")
    direction = str(rules.get("direction") or "both").lower()
    if direction not in {"long", "short", "both"}:
        raise ResearchEngineValidationError("rules.direction must be long, short, or both")

    dataset = protocol["dataset"]
    instrument = InstrumentSpec.from_mapping(dataset.get("instrument_spec"))
    timeframe_seconds = _positive_int(dataset.get("timeframe_seconds"), "dataset.timeframe_seconds")
    minimum = float(instrument.quantity_min)
    step = float(instrument.quantity_step)
    if quantity < minimum or not math.isclose(quantity / step, round(quantity / step), rel_tol=0, abs_tol=1e-9):
        raise ResearchEngineValidationError("strategy quantity violates instrument minimum/step")

    data_from = int(protocol["range"]["from_utc"])
    data_to = int(protocol["range"]["to_utc"])
    if len(rows) > int(protocol["budget"]["max_bars"]):
        raise ResearchEngineValidationError("run exceeded budget.max_bars")
    bars = []
    for row in rows:
        check()
        timestamp = int(row["timestamp"])
        if data_from <= timestamp and timestamp + timeframe_seconds <= data_to:
            prices = [_positive_float(row.get(key), key) for key in ("open", "high", "low", "close")]
            if not prices[2] <= min(prices[0], prices[3]) <= max(prices[0], prices[3]) <= prices[1]:
                raise ResearchEngineValidationError("invalid OHLC bar")
            bars.append(row)
    if len(bars) < lookback + hold_bars + 1:
        raise ResearchEngineValidationError("dataset range is too short for playbook rules")
    timestamps = [int(row["timestamp"]) for row in bars]
    if timestamps != sorted(timestamps) or len(timestamps) != len(set(timestamps)):
        raise ResearchEngineValidationError("engine requires strictly ordered unique bars")
    if any(right - left < timeframe_seconds for left, right in zip(timestamps, timestamps[1:])):
        raise ResearchEngineValidationError("bars overlap the declared timeframe; closed-bar timing is unsafe")

    cost_model = CostModel.from_mapping(protocol["parameters"]["cost_model"])
    spread_price = Decimal(str(protocol["parameters"].get("spread_price", 0)))
    if not spread_price.is_finite() or spread_price < 0:
        raise ResearchEngineValidationError("spread_price must be finite and nonnegative")
    starting_balance = _positive_float(protocol["starting_balance"], "starting_balance")
    ledger: list[dict] = []
    signals = {"long": 0, "short": 0, "no_signal": 0, "skipped_overlap": 0}
    i = lookback
    next_free_index = i
    while i < len(bars) - hold_bars:
        check()
        decision = bars[i]
        signal_time = int(decision["timestamp"]) + timeframe_seconds
        if signal_time > data_to:
            break
        prior = bars[i - lookback:i]
        prior_high = max(float(item["high"]) for item in prior)
        prior_low = min(float(item["low"]) for item in prior)
        close = float(decision["close"])
        side = None
        if close > prior_high and direction in {"long", "both"}:
            side = "BUY"
            signals["long"] += 1
        elif close < prior_low and direction in {"short", "both"}:
            side = "SELL"
            signals["short"] += 1
        else:
            signals["no_signal"] += 1
            i += 1
            continue
        if i < next_free_index:
            signals["skipped_overlap"] += 1
            i += 1
            continue

        entry_index = i + 1
        exit_index = i + hold_bars
        entry_bar = bars[entry_index]
        exit_bar = bars[exit_index]
        close_time = int(exit_bar["timestamp"]) + timeframe_seconds
        if close_time > data_to:
            break
        half_spread = spread_price / 2
        entry_mid = Decimal(str(entry_bar["open"]))
        exit_mid = Decimal(str(exit_bar["close"]))
        tick = instrument.tick_size

        def bid(mid):
            return ((mid - half_spread) / tick).to_integral_value(rounding=ROUND_FLOOR) * tick

        def ask(mid):
            return ((mid + half_spread) / tick).to_integral_value(rounding=ROUND_CEILING) * tick

        cost = calculate_round_trip_cost(
            cost_model,
            side,
            quantity,
            float(instrument.contract_size),
            bid(entry_mid),
            ask(entry_mid),
            bid(exit_mid),
            ask(exit_mid),
        )
        fees = sum(Decimal(str(cost[key])) for key in ("commission_account", "slippage_account", "financing_account"))
        # U2 rounds gross, components and net independently; keep that difference visible.
        rounding_adjustment = Decimal(str(cost["net_account"])) - Decimal(str(cost["gross_account"])) + fees
        planned_risk = stop_distance * quantity * float(instrument.contract_size) * float(cost_model.quote_to_account_rate)
        ledger.append(
            {
                "trade_id": f"engine-{len(ledger) + 1}",
                "signal_time_utc": signal_time,
                "open_time_utc": int(entry_bar["timestamp"]),
                "close_time_utc": close_time,
                "symbol": instrument.instrument_id,
                "side": side,
                "quantity": quantity,
                "price_open": cost["entry_fill"],
                "price_close": cost["exit_fill"],
                "gross_pnl": cost["gross_account"],
                "fees": float(fees),
                "rounding_adjustment": float(rounding_adjustment),
                "costs": cost,
                "net_pnl": cost["net_account"],
                "planned_risk_budget": planned_risk,
                "realized_r": cost["net_account"] / planned_risk,
                "exit_model": "fixed_horizon_bar_close",
            }
        )
        next_free_index = exit_index
        i += 1

    check()
    metrics = compute_metrics_v2(ledger, starting_balance)
    check()
    return {
        "assumptions": {
            "timing": "closed-bar signal; next-bar-open entry; fixed-horizon bar-close exit",
            "overlap": "single position; overlapping signals skipped",
            "spread_price": float(spread_price),
            "price_basis": "midpoint OHLC plus assumed constant spread; adverse tick rounding",
            "slippage_basis": "explicit round-trip monetary cost, not added to fill price",
            "rounding": "U2 component/net rounding; explicit rounding_adjustment in ledger",
            "cost_model_version": cost_model.version,
            "cost_evidence": "hypothetical zero-cost scenario" if not any((spread_price, cost_model.commission_per_side_account, cost_model.minimum_fee_account, cost_model.slippage_price_per_side, cost_model.financing_account)) else "modeled costs; not broker-confirmed",
            "planned_risk_model": "fixed_stop_distance_budget_v1",
            "protective_orders": "unsupported; planned stop distance is an R denominator only",
            "margin_model": "unsupported; not broker execution evidence",
            "data_quality": dataset.get("quality"),
            "data_source": dataset.get("source"),
        },
        "signals": signals,
        "ledger": ledger,
        "metrics": metrics,
        "observed_range": {
            "from_utc": int(bars[0]["timestamp"]),
            "to_utc": min(data_to, int(bars[-1]["timestamp"]) + timeframe_seconds),
            "bar_count": len(bars),
        },
    }


_LOADED_CODE_SHA256 = engine_code_sha256()
