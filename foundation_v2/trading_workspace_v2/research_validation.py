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


def _quote_sides(midpoint, spread, tick):
    midpoint = _number(midpoint, "source.price")
    half_spread = spread / 2
    bid = ((midpoint - half_spread) / tick).to_integral_value(rounding=ROUND_FLOOR) * tick
    ask = ((midpoint + half_spread) / tick).to_integral_value(rounding=ROUND_CEILING) * tick
    if bid <= 0:
        raise ResearchReconciliationError("source quote is nonpositive")
    return bid, ask


def _protective_source_oracle(*, bars, entry_index, side, rules, protocol, tick, spread, units, rate, timeframe):
    margin = protocol.get("parameters", {}).get("research_margin")
    if not isinstance(margin, dict) or margin.get("version") != "fixed-starting-balance-leverage-v1":
        raise ResearchReconciliationError("protective result lacks immutable research margin assumptions")
    leverage = _number(margin.get("leverage"), "research_margin.leverage")
    if leverage <= 0:
        raise ResearchReconciliationError("research leverage must be positive")
    entry_bid, entry_ask = _quote_sides(bars[entry_index]["open"], spread, tick)
    entry = entry_ask if side == "BUY" else entry_bid
    margin_required = entry * units * rate / leverage
    if margin_required > _number(protocol["starting_balance"], "starting_balance"):
        raise ResearchReconciliationError("published protective trade exceeds research margin assumption")
    stop_distance = _number(rules["stop_loss_distance_price"], "stop_loss_distance_price")
    take_profit_distance = _number(rules["take_profit_distance_price"], "take_profit_distance_price")
    if side == "BUY":
        stop = ((entry - stop_distance) / tick).to_integral_value(rounding=ROUND_FLOOR) * tick
        take_profit = ((entry + take_profit_distance) / tick).to_integral_value(rounding=ROUND_CEILING) * tick
    else:
        stop = ((entry + stop_distance) / tick).to_integral_value(rounding=ROUND_CEILING) * tick
        take_profit = ((entry - take_profit_distance) / tick).to_integral_value(rounding=ROUND_FLOOR) * tick
    if stop <= 0 or take_profit <= 0:
        raise ResearchReconciliationError("protective levels are nonpositive")

    horizon_index = entry_index + int(rules["hold_bars"]) - 1
    for bar_index in range(entry_index, horizon_index + 1):
        row = bars[bar_index]
        if bar_index > entry_index:
            open_bid, open_ask = _quote_sides(row["open"], spread, tick)
            if side == "BUY" and open_bid <= stop:
                return entry, stop, take_profit, margin_required, "stop_loss_gap", open_bid, int(row["timestamp"]), bar_index
            if side == "BUY" and open_bid >= take_profit:
                return entry, stop, take_profit, margin_required, "take_profit_gap", take_profit, int(row["timestamp"]), bar_index
            if side == "SELL" and open_ask >= stop:
                return entry, stop, take_profit, margin_required, "stop_loss_gap", open_ask, int(row["timestamp"]), bar_index
            if side == "SELL" and open_ask <= take_profit:
                return entry, stop, take_profit, margin_required, "take_profit_gap", take_profit, int(row["timestamp"]), bar_index
        low_bid, low_ask = _quote_sides(row["low"], spread, tick)
        high_bid, high_ask = _quote_sides(row["high"], spread, tick)
        if side == "BUY":
            stop_hit = low_bid <= stop
            take_profit_hit = high_bid >= take_profit
        else:
            stop_hit = high_ask >= stop
            take_profit_hit = low_ask <= take_profit
        if stop_hit and take_profit_hit:
            raise ResearchReconciliationError("source bar has ambiguous protective exit")
        if stop_hit:
            return entry, stop, take_profit, margin_required, "stop_loss", stop, int(row["timestamp"]) + timeframe, bar_index
        if take_profit_hit:
            return entry, stop, take_profit, margin_required, "take_profit", take_profit, int(row["timestamp"]) + timeframe, bar_index

    exit_bid, exit_ask = _quote_sides(bars[horizon_index]["close"], spread, tick)
    return (
        entry,
        stop,
        take_profit,
        margin_required,
        "horizon",
        exit_bid if side == "BUY" else exit_ask,
        int(bars[horizon_index]["timestamp"]) + timeframe,
        horizon_index,
    )


def _signal_source_oracle(*, bars, rules, protocol, tick, spread, units, rate, timeframe):
    lookback = int(rules["lookback"])
    hold_bars = int(rules["hold_bars"])
    direction = str(rules.get("direction") or "both").lower()
    exit_mode = rules.get("exit_mode", "fixed_horizon")
    signals = {"long": 0, "short": 0, "no_signal": 0, "skipped_overlap": 0}
    leverage = starting_balance = None
    if exit_mode == "protective":
        margin = protocol.get("parameters", {}).get("research_margin")
        if not isinstance(margin, dict) or margin.get("version") != "fixed-starting-balance-leverage-v1":
            raise ResearchReconciliationError("protective result lacks immutable research margin assumptions")
        leverage = _number(margin.get("leverage"), "research_margin.leverage")
        if leverage <= 0:
            raise ResearchReconciliationError("research leverage must be positive")
        starting_balance = _number(protocol["starting_balance"], "starting_balance")
        signals["skipped_margin"] = 0

    i = lookback
    next_free_index = i
    while i < len(bars) - hold_bars:
        decision = bars[i]
        prior = bars[i - lookback:i]
        close = _number(decision["close"], "source.close")
        prior_high = max(_number(row["high"], "source.high") for row in prior)
        prior_low = min(_number(row["low"], "source.low") for row in prior)
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
        if exit_mode == "protective":
            entry_bid, entry_ask = _quote_sides(bars[entry_index]["open"], spread, tick)
            entry = entry_ask if side == "BUY" else entry_bid
            margin_required = entry * units * rate / leverage
            if margin_required > starting_balance:
                signals["skipped_margin"] += 1
                i += 1
                continue
            *_, actual_exit_index = _protective_source_oracle(
                bars=bars,
                entry_index=entry_index,
                side=side,
                rules=rules,
                protocol=protocol,
                tick=tick,
                spread=spread,
                units=units,
                rate=rate,
                timeframe=timeframe,
            )
        else:
            actual_exit_index = i + hold_bars
        next_free_index = actual_exit_index
        i += 1
    return signals


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
    exit_mode = rules.get("exit_mode", "fixed_horizon")
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
    full_spread = _number(protocol["parameters"].get("spread_price", 0), "spread")
    if bars is not None:
        expected_signals = _signal_source_oracle(
            bars=bars,
            rules=rules,
            protocol=protocol,
            tick=tick,
            spread=full_spread,
            units=units,
            rate=rate,
            timeframe=timeframe,
        )
        if result.get("signals") != expected_signals:
            raise ResearchReconciliationError("signal counters do not match independent source oracle")
    native_fills = None
    if protocol.get("engine", {}).get("backend") == "nautilus":
        execution = result.get("execution")
        if not isinstance(execution, dict) or not isinstance(execution.get("fills"), list):
            raise ResearchReconciliationError("Nautilus execution evidence is missing")
        if execution.get("native_version") != protocol["engine"].get("native_version"):
            raise ResearchReconciliationError("Nautilus runtime identity differs from protocol")
        if execution.get("adapter_version") != protocol["engine"].get("adapter_version"):
            raise ResearchReconciliationError("Nautilus adapter identity differs from protocol")
        if execution.get("runtime_identity") != protocol["engine"].get("runtime_identity"):
            raise ResearchReconciliationError("Nautilus runtime environment differs from protocol")
        isolation = execution.get("isolation") or {}
        if isolation.get("worker_owned_job_object") is not True or isolation.get("active_process_limit") != 1:
            raise ResearchReconciliationError("Nautilus process isolation evidence is incomplete")
        if isolation.get("process_memory_limit_mb") != protocol["budget"].get("max_memory_mb"):
            raise ResearchReconciliationError("Nautilus memory isolation differs from protocol")
        if execution.get("signals") != result.get("signals"):
            raise ResearchReconciliationError("Nautilus signal evidence differs from result")
        observed = execution.get("observed_range") or {}
        published_observed = result.get("observed_range") or {}
        for field in ("from_utc", "to_utc", "bar_count"):
            if observed.get(field) != published_observed.get(field):
                raise ResearchReconciliationError("Nautilus observed range differs from result")
        native_fills = execution["fills"]
        if len(native_fills) != len(ledger) * 2:
            raise ResearchReconciliationError("Nautilus fill count does not match ledger")
        fill_ids = [fill.get("native_trade_id") for fill in native_fills]
        order_ids = [fill.get("client_order_id") for fill in native_fills]
        if any(not value for value in fill_ids + order_ids) or len(set(fill_ids)) != len(fill_ids) or len(set(order_ids)) != len(order_ids):
            raise ResearchReconciliationError("Nautilus fill/order identities are missing or duplicated")
    nets, gross_values, fee_values, rs = [], [], [], []
    last_close = protocol["range"]["from_utc"]

    for index, trade in enumerate(ledger):
        if continue_check is not None:
            continue_check()
        label = f"ledger[{index}]"
        side = trade.get("side")
        if side not in {"BUY", "SELL"} or trade.get("trade_id") != f"engine-{index + 1}":
            raise ResearchReconciliationError(f"{label} side/identity is invalid")
        expected_exit_model = "protective_bracket" if exit_mode == "protective" else "fixed_horizon_bar_close"
        if trade.get("symbol") != instrument["instrument_id"] or trade.get("exit_model") != expected_exit_model:
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

        if native_fills is not None:
            native_entry, native_exit = native_fills[index * 2:index * 2 + 2]
            link = trade.get("execution_link")
            if not isinstance(link, dict):
                raise ResearchReconciliationError(f"{label} Nautilus execution link is missing")
            expected_link = {
                "entry_order_id": native_entry.get("client_order_id"),
                "exit_order_id": native_exit.get("client_order_id"),
                "entry_fill_id": native_entry.get("native_trade_id"),
                "exit_fill_id": native_exit.get("native_trade_id"),
                "entry_timestamp_ns": native_entry.get("timestamp_ns"),
                "exit_timestamp_ns": native_exit.get("timestamp_ns"),
            }
            if link != expected_link:
                raise ResearchReconciliationError(f"{label} Nautilus execution identity differs from raw fills")
            if native_entry.get("role") != "entry" or native_exit.get("role") != "exit":
                raise ResearchReconciliationError(f"{label} Nautilus fill roles are invalid")
            if native_entry.get("signal_time_utc") != signal or native_exit.get("signal_time_utc") != signal:
                raise ResearchReconciliationError(f"{label} Nautilus fill signal linkage is invalid")
            if native_entry.get("side") != side or native_exit.get("side") == side:
                raise ResearchReconciliationError(f"{label} Nautilus fill sides are invalid")
            _expect(native_entry.get("units"), units, label + ".native_entry.units")
            _expect(native_exit.get("units"), units, label + ".native_exit.units")
            _expect(native_entry.get("price"), entry, label + ".native_entry.price")
            _expect(native_exit.get("price"), exit_price, label + ".native_exit.price")
            entry_ns = native_entry.get("timestamp_ns")
            exit_ns = native_exit.get("timestamp_ns")
            if type(entry_ns) is not int or type(exit_ns) is not int:
                raise ResearchReconciliationError(f"{label} Nautilus fill timestamps must be integer nanoseconds")
            if entry_ns != opened * 10**9 + 1:
                raise ResearchReconciliationError(f"{label} Nautilus entry timing differs from next-open contract")
            if native_entry.get("order_type") != "MARKET":
                raise ResearchReconciliationError(f"{label} Nautilus entry is not a market order")
            if exit_mode == "protective":
                reason = trade.get("exit_reason")
                if native_exit.get("exit_reason") != reason or native_exit.get("close_time_utc") != closed:
                    raise ResearchReconciliationError(f"{label} Nautilus protective exit context differs from ledger")
                expected_order_type = {
                    "stop_loss": "STOP_MARKET",
                    "stop_loss_gap": "STOP_MARKET",
                    "take_profit": "LIMIT",
                    "take_profit_gap": "LIMIT",
                    "horizon": "MARKET",
                }.get(reason)
                if native_exit.get("order_type") != expected_order_type:
                    raise ResearchReconciliationError(f"{label} Nautilus protective order type differs from exit reason")
                if reason in {"stop_loss", "take_profit"}:
                    expected_exit_ns = closed * 10**9 - 1
                elif reason in {"stop_loss_gap", "take_profit_gap"}:
                    expected_exit_ns = closed * 10**9 + 1
                elif reason == "horizon":
                    expected_exit_ns = closed * 10**9
                else:
                    raise ResearchReconciliationError(f"{label} protective exit reason is invalid")
                if exit_ns != expected_exit_ns:
                    raise ResearchReconciliationError(f"{label} Nautilus protective fill timing differs from modeled event")
                if reason != "horizon":
                    if not native_entry.get("order_list_id") or native_entry.get("order_list_id") != native_exit.get("order_list_id"):
                        raise ResearchReconciliationError(f"{label} Nautilus protective fills are not linked to one bracket")
            elif exit_ns != closed * 10**9:
                raise ResearchReconciliationError(f"{label} Nautilus fill timing differs from next-open/fixed-close contract")

        if bars is not None:
            entry_index = index_by_time.get(opened, -1)
            lookback = int(rules["lookback"])
            if entry_index <= lookback:
                raise ResearchReconciliationError(f"{label} entry does not match source timing")
            decision = bars[entry_index - 1]
            if signal != decision["timestamp"] + timeframe:
                raise ResearchReconciliationError(f"{label} signal is not a closed bar")
            prior = bars[entry_index - 1 - lookback:entry_index - 1]
            triggered = (side == "BUY" and rules.get("direction", "both") != "short" and decision["close"] > max(row["high"] for row in prior)) or (side == "SELL" and rules.get("direction", "both") != "long" and decision["close"] < min(row["low"] for row in prior))
            if not triggered:
                raise ResearchReconciliationError(f"{label} signal not supported by source bars")
            if exit_mode == "protective":
                (
                    expected_entry,
                    expected_stop,
                    expected_take_profit,
                    expected_margin,
                    expected_reason,
                    expected_exit,
                    expected_close,
                    expected_exit_index,
                ) = _protective_source_oracle(
                    bars=bars,
                    entry_index=entry_index,
                    side=side,
                    rules=rules,
                    protocol=protocol,
                    tick=tick,
                    spread=full_spread,
                    units=units,
                    rate=rate,
                    timeframe=timeframe,
                )
                _expect(entry, expected_entry, label + ".entry_from_source")
                _expect(exit_price, expected_exit, label + ".exit_from_source")
                _expect(trade.get("protective_stop_price"), expected_stop, label + ".protective_stop_price")
                _expect(trade.get("protective_take_profit_price"), expected_take_profit, label + ".protective_take_profit_price")
                _expect(trade.get("research_margin_required_account"), expected_margin, label + ".research_margin_required_account")
                if trade.get("exit_reason") != expected_reason or closed != expected_close:
                    raise ResearchReconciliationError(f"{label} protective exit differs from source oracle")
                if expected_exit_index != index_by_time.get(
                    expected_close if expected_reason.endswith("_gap") else expected_close - timeframe,
                    -1,
                ):
                    raise ResearchReconciliationError(f"{label} protective source index is inconsistent")
            else:
                exit_index = index_by_time.get(closed - timeframe, -1)
                if exit_index != entry_index + int(rules["hold_bars"]) - 1:
                    raise ResearchReconciliationError(f"{label} fill does not match source horizon")
                half_spread = full_spread / 2
                raw_open = _number(bars[entry_index]["open"], "source.open")
                raw_close = _number(bars[exit_index]["close"], "source.close")
                expected_entry = ((raw_open + (half_spread if side == "BUY" else -half_spread)) / tick).to_integral_value(rounding=ROUND_CEILING if side == "BUY" else ROUND_FLOOR) * tick
                expected_exit = ((raw_close + (-half_spread if side == "BUY" else half_spread)) / tick).to_integral_value(rounding=ROUND_FLOOR if side == "BUY" else ROUND_CEILING) * tick
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
