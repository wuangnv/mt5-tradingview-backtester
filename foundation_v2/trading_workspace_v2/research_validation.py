from __future__ import annotations

import hashlib
import json
import math
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP


class ResearchReconciliationError(RuntimeError):
    pass


def _number(value, name):
    if isinstance(value, bool):
        raise ResearchReconciliationError(f"{name} must be numeric")
    try:
        number = Decimal(str(value))
    except Exception as exc:
        raise ResearchReconciliationError(f"{name} must be numeric") from exc
    if not number.is_finite():
        raise ResearchReconciliationError(f"{name} must be finite")
    return number


def _expect(value, expected, name):
    if expected is None:
        if value is not None:
            raise ResearchReconciliationError(f"{name} should be unavailable")
    elif not math.isclose(float(_number(value, name)), float(expected), rel_tol=1e-10, abs_tol=1e-8):
        raise ResearchReconciliationError(f"{name} does not match independent oracle")


def validate_engine_result(result: dict, *, rows=None, continue_check=None) -> dict:
    if result.get("artifact_schema_version") != "research-engine-result-v1":
        raise ResearchReconciliationError("unsupported research engine artifact schema")
    ledger = result.get("ledger")
    metrics = result.get("metrics")
    protocol = result.get("protocol")
    if not isinstance(ledger, list) or not isinstance(metrics, dict) or not isinstance(protocol, dict):
        raise ResearchReconciliationError("research engine artifact is incomplete")
    protocol_hash = hashlib.sha256((json.dumps(protocol, sort_keys=True, separators=(",", ":")) + "\n").encode()).hexdigest()
    if protocol_hash != result.get("protocol_sha256"):
        raise ResearchReconciliationError("protocol hash mismatch")
    if metrics.get("metric_schema_version") != "metrics-v2":
        raise ResearchReconciliationError("unsupported metrics schema")
    for actual, expected in (
        (result.get("playbook_id"), protocol["playbook"]["record_id"]),
        (result.get("playbook_revision"), protocol["playbook"]["revision"]),
        (result.get("dataset_sha256"), protocol["dataset"]["artifact_sha256"]),
        (result.get("engine_code_sha256"), protocol["engine"]["code_sha256"]),
        (result.get("split"), protocol["split"]),
    ):
        if actual != expected:
            raise ResearchReconciliationError("result identity differs from protocol")

    model = protocol["parameters"]["cost_model"]
    instrument = protocol["dataset"]["instrument_spec"]
    rules = protocol["playbook"]["rules"]
    quantity = _number(rules["quantity"], "quantity")
    units = quantity * _number(instrument["contract_size"], "contract_size")
    rate = _number(model.get("quote_to_account_rate", 1), "conversion")
    tick = _number(instrument["tick_size"], "tick_size")
    risk = _number(rules["planned_stop_distance_price"], "stop_distance") * units * rate
    quantum = Decimal(1).scaleb(-int(model.get("rounding_decimals", 2)))
    money = lambda value: value.quantize(quantum, rounding=ROUND_HALF_UP)
    timeframe = int(protocol["dataset"]["timeframe_seconds"])
    bars = None if rows is None else [row for row in rows if protocol["range"]["from_utc"] <= row["timestamp"] and row["timestamp"] + timeframe <= protocol["range"]["to_utc"]]
    index_by_time = {} if bars is None else {row["timestamp"]: i for i, row in enumerate(bars)}
    nets, gross_values, fee_values, rs = [], [], [], []
    last_close = protocol["range"]["from_utc"]

    for index, trade in enumerate(ledger):
        if continue_check is not None:
            continue_check()
        label = f"ledger[{index}]"
        side = trade.get("side")
        if side not in {"BUY", "SELL"} or trade.get("trade_id") != f"engine-{index + 1}":
            raise ResearchReconciliationError(f"{label} side/identity is invalid")
        if trade.get("symbol") != instrument["instrument_id"] or trade.get("exit_model") != "fixed_horizon_bar_close":
            raise ResearchReconciliationError(f"{label} execution model is invalid")
        entry = _number(trade.get("price_open"), label + ".price_open")
        exit_price = _number(trade.get("price_close"), label + ".price_close")
        if min(entry, exit_price) <= 0 or entry % tick or exit_price % tick:
            raise ResearchReconciliationError(f"{label} fill is off tick or nonpositive")
        _expect(trade.get("quantity"), quantity, label + ".quantity")
        signal, opened, closed = (trade.get(key) for key in ("signal_time_utc", "open_time_utc", "close_time_utc"))
        if any(type(value) is not int for value in (signal, opened, closed)):
            raise ResearchReconciliationError(f"{label} timestamps must be integer seconds")
        if not last_close <= signal <= opened < closed <= protocol["range"]["to_utc"]:
            raise ResearchReconciliationError(f"{label} timing order/overlap is invalid")
        last_close = closed

        if bars is not None:
            entry_index = index_by_time.get(opened, -1)
            exit_index = index_by_time.get(closed - timeframe, -1)
            lookback = int(rules["lookback"])
            if entry_index <= lookback or exit_index != entry_index + int(rules["hold_bars"]) - 1:
                raise ResearchReconciliationError(f"{label} fill does not match source horizon")
            decision = bars[entry_index - 1]
            if signal != decision["timestamp"] + timeframe:
                raise ResearchReconciliationError(f"{label} signal is not a closed bar")
            prior = bars[entry_index - 1 - lookback:entry_index - 1]
            triggered = (side == "BUY" and rules.get("direction", "both") != "short" and decision["close"] > max(row["high"] for row in prior)) or (side == "SELL" and rules.get("direction", "both") != "long" and decision["close"] < min(row["low"] for row in prior))
            if not triggered:
                raise ResearchReconciliationError(f"{label} signal not supported by source bars")
            spread = _number(protocol["parameters"].get("spread_price", 0), "spread") / 2
            raw_open = _number(bars[entry_index]["open"], "source.open")
            raw_close = _number(bars[exit_index]["close"], "source.close")
            expected_entry = ((raw_open + (spread if side == "BUY" else -spread)) / tick).to_integral_value(rounding=ROUND_CEILING if side == "BUY" else ROUND_FLOOR) * tick
            expected_exit = ((raw_close + (-spread if side == "BUY" else spread)) / tick).to_integral_value(rounding=ROUND_FLOOR if side == "BUY" else ROUND_CEILING) * tick
            _expect(entry, expected_entry, label + ".entry_from_source")
            _expect(exit_price, expected_exit, label + ".exit_from_source")

        # Derive Decimal costs independently of the engine's retained helper.
        gross_quote = (exit_price - entry) * units * (1 if side == "BUY" else -1)
        raw_gross = gross_quote * rate
        commission = max(_number(model.get("commission_per_side_account", 0), "commission") * 2,
                         _number(model.get("minimum_fee_account", 0), "minimum_fee"))
        slip = _number(model.get("slippage_price_per_side", 0), "slippage") * 2 * units * rate
        financing = _number(model.get("financing_account", 0), "financing")
        gross = money(raw_gross)
        fees = money(commission) + money(slip) + money(financing)
        net = money(raw_gross - commission - slip - financing)
        expected_costs = {
            "entry_fill": entry, "exit_fill": exit_price, "gross_quote": gross_quote,
            "gross_account": gross, "commission_account": money(commission),
            "slippage_account": money(slip), "financing_account": money(financing), "net_account": net,
        }
        for field, expected in expected_costs.items():
            _expect(trade.get("costs", {}).get(field), expected, label + ".costs." + field)
        for field, expected in {"gross_pnl": gross, "fees": fees, "net_pnl": net,
                                "rounding_adjustment": net - gross + fees,
                                "planned_risk_budget": risk, "realized_r": net / risk}.items():
            _expect(trade.get(field), expected, label + "." + field)
        nets.append(net)
        gross_values.append(gross)
        fee_values.append(fees)
        rs.append(net / risk)

    count = len(nets)
    wins = [value for value in nets if value > Decimal("1e-12")]
    losses = [value for value in nets if value < Decimal("-1e-12")]
    start = _number(protocol["starting_balance"], "starting_balance")
    _expect(metrics.get("starting_balance"), start, "metrics.starting_balance")
    balance = peak = start
    max_dd = max_dd_pct = Decimal(0)
    streak = max_streak = 0
    balances = [start]
    drawdowns = [(start, Decimal(0), Decimal(0))]
    for value in nets:
        balance += value
        peak = max(peak, balance)
        max_dd = max(max_dd, peak - balance)
        max_dd_pct = max(max_dd_pct, (peak - balance) / peak * 100)
        streak = streak + 1 if value < Decimal("-1e-12") else 0
        max_streak = max(max_streak, streak)
        balances.append(balance)
        drawdowns.append((peak, peak - balance, (peak - balance) / peak * 100))
    expected_metrics = {
        "closed_trade_count": count, "wins": len(wins), "losses": len(losses),
        "breakeven": count - len(wins) - len(losses),
        "win_rate_pct": len(wins) / count * 100 if count else None,
        "loss_rate_pct": len(losses) / count * 100 if count else None,
        "gross_pnl": sum(gross_values), "fees": sum(fee_values), "net_pnl": sum(nets),
        "profit_factor_after_cost": sum(wins) / abs(sum(losses)) if losses else None,
        "payoff_ratio_after_cost": (sum(wins) / len(wins)) / abs(sum(losses) / len(losses)) if wins and losses else None,
        "expectancy_net_per_trade": sum(nets) / count if count else None,
        "average_realized_r": sum(rs) / count if count else None,
        "realized_r_known_count": count, "gross_pnl_known_count": count, "fees_known_count": count,
        "closed_trade_balance_max_drawdown": max_dd, "closed_trade_balance_max_drawdown_pct": max_dd_pct,
        "max_loss_streak": max_streak, "ending_closed_trade_balance": balance,
    }
    for field, expected in expected_metrics.items():
        _expect(metrics.get(field), expected, "metrics." + field)
    curve = metrics.get("closed_trade_balance_curve", [])
    if len(curve) != len(balances):
        raise ResearchReconciliationError("balance curve length mismatch")
    for index, expected in enumerate(balances):
        _expect(curve[index].get("closed_trade_balance"), expected, f"balance_curve[{index}]")
        if curve[index].get("sequence") != index or curve[index].get("trade_id") != (ledger[index - 1]["trade_id"] if index else None):
            raise ResearchReconciliationError("balance curve trade linkage mismatch")
    dd_curve = metrics.get("closed_trade_balance_drawdown_curve", [])
    if len(dd_curve) != len(drawdowns):
        raise ResearchReconciliationError("drawdown curve length mismatch")
    for index, (peak, drawdown, percentage) in enumerate(drawdowns):
        for field, expected in {"closed_trade_balance": balances[index], "peak_closed_trade_balance": peak,
                                "drawdown": drawdown, "drawdown_pct": percentage}.items():
            _expect(dd_curve[index].get(field), expected, f"drawdown_curve[{index}].{field}")
    return {"reconciled": True, "trade_count": count, "metric_schema_version": "metrics-v2",
            "oracle": "independent-decimal-v1", "source_fills_verified": rows is not None}
