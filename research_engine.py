"""Deterministic local research engine for one explicitly supported strategy family."""

import hashlib
import json
import math
import time
from pathlib import Path

from data_contracts import CostModel, DataContractError
from data_costs import calculate_round_trip_cost
from evidence_metrics import compute_metrics_v2
from research_store import ResearchConflict, ResearchValidationError


ENGINE_VERSION = "bar-breakout-v1"


class ResearchEngineError(RuntimeError):
    code = "RESEARCH_ENGINE_ERROR"


class ResearchEngineValidationError(ResearchEngineError):
    code = "RESEARCH_ENGINE_INVALID"


class ResearchEngineDataDenied(ResearchEngineError):
    code = "RESEARCH_ENGINE_DATA_DENIED"


def _code_hash():
    path = Path(__file__)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _finite(value, name, *, minimum=None, strictly_positive=False):
    if isinstance(value, bool):
        raise ResearchEngineValidationError(f"{name} must be a finite number")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ResearchEngineValidationError(f"{name} must be a finite number") from exc
    if not math.isfinite(number):
        raise ResearchEngineValidationError(f"{name} must be a finite number")
    if strictly_positive and number <= 0:
        raise ResearchEngineValidationError(f"{name} must be positive")
    if minimum is not None and number < minimum:
        raise ResearchEngineValidationError(f"{name} must be at least {minimum}")
    return number


def _integer(value, name, *, minimum=0):
    if isinstance(value, bool):
        raise ResearchEngineValidationError(f"{name} must be an integer")
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ResearchEngineValidationError(f"{name} must be an integer") from exc
    if str(number) != str(value).strip() and not isinstance(value, int):
        raise ResearchEngineValidationError(f"{name} must be an integer")
    if number < minimum:
        raise ResearchEngineValidationError(f"{name} must be at least {minimum}")
    return number


def _dataset_directory(data_root, dataset_id):
    prefix = "dataset-sha256:"
    if not isinstance(dataset_id, str) or not dataset_id.startswith(prefix):
        raise ResearchEngineValidationError("engine requires an immutable dataset-sha256 dataset")
    key = dataset_id[len(prefix):]
    if len(key) != 64 or any(char not in "0123456789abcdef" for char in key.lower()):
        raise ResearchEngineValidationError("dataset_id is invalid")
    return Path(data_root) / "datasets" / key


def _load_dataset(data_root, protocol, max_bars):
    directory = _dataset_directory(data_root, protocol["dataset_id"])
    manifest_path = directory / "manifest.json"
    if not manifest_path.is_file():
        raise ResearchEngineValidationError("dataset manifest is missing")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ResearchEngineValidationError("dataset manifest is unreadable") from exc
    if manifest.get("dataset_id") != protocol["dataset_id"]:
        raise ResearchEngineValidationError("dataset manifest identity does not match protocol")
    if manifest.get("normalized_sha256") != protocol["dataset_sha256"]:
        raise ResearchEngineValidationError("dataset content hash does not match protocol")
    if manifest.get("quality", {}).get("disposition") == "missing_data":
        raise ResearchEngineValidationError("dataset contains no usable data")

    holdout = manifest.get("holdout_policy") or {"mode": "none"}
    holdout_from = holdout.get("from_utc")
    if holdout.get("mode") != "none" and holdout_from not in (None, ""):
        try:
            holdout_ms = int(holdout_from) * 1000
        except (TypeError, ValueError) as exc:
            raise ResearchEngineValidationError("dataset holdout boundary is invalid") from exc
        if int(protocol["cutoff_ms"]) >= holdout_ms:
            raise ResearchEngineDataDenied("protocol cutoff reaches a locked holdout range")

    relative = manifest.get("normalized_relative_path")
    if not isinstance(relative, str) or not relative:
        raise ResearchEngineValidationError("normalized dataset path is missing")
    bars_path = directory / relative
    if not bars_path.is_file():
        raise ResearchEngineValidationError("normalized dataset content is missing")
    digest = hashlib.sha256()
    bars = []
    try:
        with bars_path.open("rb") as raw_handle:
            for chunk in iter(lambda: raw_handle.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != manifest.get("normalized_copy_sha256"):
            raise ResearchEngineValidationError("normalized dataset checksum mismatch")
        with bars_path.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                row = json.loads(line)
                timestamp_ms = _integer(row.get("time_utc"), f"bar[{line_number}].time_utc") * 1000
                if timestamp_ms < int(protocol["data_start_ms"]):
                    continue
                if timestamp_ms >= int(protocol["cutoff_ms"]):
                    continue
                bars.append(
                    {
                        "time_utc": timestamp_ms // 1000,
                        "open": _finite(row.get("open"), f"bar[{line_number}].open", strictly_positive=True),
                        "high": _finite(row.get("high"), f"bar[{line_number}].high", strictly_positive=True),
                        "low": _finite(row.get("low"), f"bar[{line_number}].low", strictly_positive=True),
                        "close": _finite(row.get("close"), f"bar[{line_number}].close", strictly_positive=True),
                    }
                )
                if len(bars) > max_bars:
                    raise ResearchEngineValidationError("run exceeded budget.max_bars")
    except json.JSONDecodeError as exc:
        raise ResearchEngineValidationError("normalized dataset contains invalid JSON") from exc
    bars.sort(key=lambda item: item["time_utc"])
    if len({item["time_utc"] for item in bars}) != len(bars):
        raise ResearchEngineValidationError("engine refuses duplicate bar timestamps")
    return manifest, bars


def _normalize_rules(strategy, protocol):
    if strategy.get("capability_status") != "engine-supported":
        raise ResearchEngineValidationError("strategy version is not engine-supported")
    rules = strategy.get("rules")
    if not isinstance(rules, dict) or rules.get("engine") != ENGINE_VERSION:
        raise ResearchEngineValidationError(f"strategy rules must declare engine={ENGINE_VERSION}")
    lookback = _integer(rules.get("lookback"), "rules.lookback", minimum=1)
    hold_bars = _integer(rules.get("hold_bars"), "rules.hold_bars", minimum=1)
    direction = str(rules.get("direction") or "both").strip().lower()
    if direction not in {"long", "short", "both"}:
        raise ResearchEngineValidationError("rules.direction must be long, short, or both")
    quantity = _finite(rules.get("quantity"), "rules.quantity", strictly_positive=True)
    stop_distance = _finite(
        rules.get("planned_stop_distance_price"),
        "rules.planned_stop_distance_price",
        strictly_positive=True,
    )
    parameters = protocol.get("parameters") or {}
    if not isinstance(parameters, dict):
        raise ResearchEngineValidationError("protocol.parameters must be an object")
    starting_balance = _finite(
        parameters.get("starting_balance"), "parameters.starting_balance", strictly_positive=True
    )
    spread_price = _finite(parameters.get("spread_price", 0), "parameters.spread_price", minimum=0)
    try:
        cost_model = CostModel.from_mapping(parameters.get("cost_model"))
    except DataContractError as exc:
        raise ResearchEngineValidationError(str(exc)) from exc
    return {
        "lookback": lookback,
        "hold_bars": hold_bars,
        "direction": direction,
        "quantity": quantity,
        "planned_stop_distance_price": stop_distance,
        "starting_balance": starting_balance,
        "spread_price": spread_price,
        "cost_model": cost_model,
    }


def _validate_instrument(manifest, rules):
    instrument = manifest.get("instrument")
    if not isinstance(instrument, dict):
        raise ResearchEngineValidationError("dataset instrument snapshot is missing")
    contract_size = _finite(
        instrument.get("contract_size"), "instrument.contract_size", strictly_positive=True
    )
    minimum = _finite(instrument.get("quantity_min"), "instrument.quantity_min", strictly_positive=True)
    step = _finite(instrument.get("quantity_step"), "instrument.quantity_step", strictly_positive=True)
    quantity = rules["quantity"]
    if quantity < minimum:
        raise ResearchEngineValidationError("strategy quantity is below instrument minimum")
    steps = round(quantity / step)
    if not math.isclose(quantity, steps * step, rel_tol=0, abs_tol=1e-9):
        raise ResearchEngineValidationError("strategy quantity does not match instrument quantity_step")
    return instrument, contract_size


def execute_breakout(bars, manifest, strategy, protocol):
    rules = _normalize_rules(strategy, protocol)
    instrument, contract_size = _validate_instrument(manifest, rules)
    timeframe_seconds = _integer(manifest.get("timeframe_seconds"), "timeframe_seconds", minimum=1)
    minimum_bars = rules["lookback"] + rules["hold_bars"] + 1
    if len(bars) < minimum_bars:
        raise ResearchEngineValidationError("dataset range is too short for strategy rules")

    ledger = []
    signals = {"long": 0, "short": 0, "no_signal": 0, "skipped_overlap": 0}
    i = rules["lookback"]
    next_free_index = i
    while i < len(bars) - rules["hold_bars"]:
        decision = bars[i]
        decision_available = (decision["time_utc"] + timeframe_seconds) * 1000
        if decision_available > int(protocol["cutoff_ms"]):
            break
        prior = bars[i - rules["lookback"]:i]
        prior_high = max(item["high"] for item in prior)
        prior_low = min(item["low"] for item in prior)
        side = None
        if decision["close"] > prior_high and rules["direction"] in {"long", "both"}:
            side = "BUY"
            signals["long"] += 1
        elif decision["close"] < prior_low and rules["direction"] in {"short", "both"}:
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
        exit_index = i + rules["hold_bars"]
        entry_bar = bars[entry_index]
        exit_bar = bars[exit_index]
        exit_available = (exit_bar["time_utc"] + timeframe_seconds) * 1000
        if exit_available > int(protocol["cutoff_ms"]):
            break
        half_spread = rules["spread_price"] / 2.0
        entry_mid = entry_bar["open"]
        exit_mid = exit_bar["close"]
        cost = calculate_round_trip_cost(
            rules["cost_model"],
            side,
            rules["quantity"],
            contract_size,
            entry_mid - half_spread,
            entry_mid + half_spread,
            exit_mid - half_spread,
            exit_mid + half_spread,
        )
        planned_risk = (
            rules["planned_stop_distance_price"]
            * rules["quantity"]
            * contract_size
            * float(rules["cost_model"].quote_to_account_rate)
        )
        explicit_cost = (
            cost["commission_account"] + cost["slippage_account"] + cost["financing_account"]
        )
        ledger.append(
            {
                "trade_id": f"engine-{len(ledger) + 1}",
                "signal_time_utc": decision["time_utc"] + timeframe_seconds,
                "open_time_utc": entry_bar["time_utc"],
                "close_time_utc": exit_bar["time_utc"] + timeframe_seconds,
                "symbol": instrument["instrument_id"],
                "side": side,
                "quantity": rules["quantity"],
                "price_open": cost["entry_fill"],
                "price_close": cost["exit_fill"],
                "gross_pnl": cost["gross_account"],
                "fees": explicit_cost,
                "net_pnl": cost["net_account"],
                "planned_risk_budget": planned_risk,
                "realized_r": cost["net_account"] / planned_risk,
                "exit_model": "fixed_horizon_bar_close",
            }
        )
        next_free_index = exit_index + 1
        i = exit_index + 1

    metrics = compute_metrics_v2(ledger, rules["starting_balance"])
    observed_until_ms = (bars[-1]["time_utc"] + timeframe_seconds) * 1000
    return {
        "artifact_schema_version": "research-engine-result-v1",
        "engine_version": ENGINE_VERSION,
        "engine_code_sha256": _code_hash(),
        "strategy": {
            "strategy_key": strategy["strategy_key"],
            "version": strategy["version"],
            "capability_status": strategy["capability_status"],
        },
        "dataset": {
            "dataset_id": manifest["dataset_id"],
            "normalized_sha256": manifest["normalized_sha256"],
            "quality_disposition": manifest.get("quality", {}).get("disposition"),
            "holdout_policy": manifest.get("holdout_policy"),
        },
        "assumptions": {
            "timing": "signal uses closed bar; entry next bar open; exit fixed horizon bar close",
            "spread_price": rules["spread_price"],
            "cost_model_version": rules["cost_model"].version,
            "planned_risk_model": "fixed_stop_distance_budget_v1",
            "overlap": "single position; overlapping signals skipped",
        },
        "signals": signals,
        "ledger": ledger,
        "metrics": metrics,
        "observed_until_ms": min(observed_until_ms, int(protocol["cutoff_ms"])),
    }


class ResearchEngineRunner:
    def __init__(self, research_store, data_root):
        self.research_store = research_store
        self.data_root = Path(data_root)

    def execute(self, run_id):
        run = self.research_store.get_run(run_id)
        if run["status"] != "planned":
            raise ResearchConflict("automatic execution requires a planned run")
        protocol = run["protocol"]
        strategy = run["strategy_version"]
        budget = run["budget"]
        started = time.perf_counter()
        self.research_store.start_run(run_id)
        try:
            manifest, bars = _load_dataset(self.data_root, protocol, budget["max_bars"])
            result = execute_breakout(bars, manifest, strategy, protocol)
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            if elapsed_ms > budget["max_runtime_ms"]:
                raise ResearchEngineValidationError("run exceeded budget.max_runtime_ms")
            result["runtime"] = {"elapsed_ms": round(elapsed_ms, 3), "bar_count": len(bars)}
            completed = self.research_store.complete_run(
                run_id,
                {"observed_until_ms": result["observed_until_ms"], "result": result},
            )
            return completed
        except Exception as exc:
            try:
                self.research_store.fail_run(run_id, str(exc))
            except (ResearchConflict, ResearchValidationError):
                pass
            raise
