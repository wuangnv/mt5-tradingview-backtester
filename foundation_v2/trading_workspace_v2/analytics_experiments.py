"""Read-only bracket experiments bounded by the original trade's exposure."""

from decimal import Decimal, InvalidOperation

from .analytics_read_model import AnalyticsValidationError
from .execution_semantics import IntrabarAmbiguityError, protective_exit_for_bar, quote_from_mid, validate_ohlc_bar
from .replay_analytics import build_replay_analytics_view
from .replay_execution import parse_replay_execution_snapshot
from .retained import CostModel, InstrumentSpec, calculate_round_trip_cost


def _positive(value, name, maximum):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise AnalyticsValidationError(f"invalid {name}") from exc
    if not result.is_finite() or not 0 < result <= maximum:
        raise AnalyticsValidationError(f"invalid {name}")
    return result


def _unavailable(reason):
    return {"status": "unsupported", "reason": reason, "net_pnl": None, "exit_price": None}


def _trade_experiment(trade, bars, snapshot, config, instrument, costs):
    start, end = trade["open_cursor_index"], trade["close_cursor_index"]
    if not 0 <= start <= end < len(bars):
        raise AnalyticsValidationError("trade exposure outside observed dataset")
    path = bars[start:end + 1]
    for bar in path:
        validate_ohlc_bar(bar)
    if (int(path[0]["timestamp"]) != trade["open_time_utc"]
            or trade["close_time_utc"] not in {int(path[-1]["timestamp"]),
                                             int(path[-1]["timestamp"]) + snapshot.timeframe_seconds}):
        raise AnalyticsValidationError("trade timestamps disagree with dataset")
    entry = Decimal(str(trade["price_open"]))
    close = Decimal(str(trade["price_close"]))
    side = trade["side"]
    direction = Decimal(1) if side == "BUY" else Decimal(-1)
    entry_bid, entry_ask = quote_from_mid(path[0]["open"], spread_price=snapshot.spread_price,
                                        tick_size=instrument.tick_size)
    base = {"trade_id": trade["trade_id"], "original_net_pnl": trade["net_pnl"]}
    if entry != (entry_ask if side == "BUY" else entry_bid):
        return {**base, "excursion": {"status": "unsupported", "reason": "entry_quote_mismatch"},
                "stop_loss": _unavailable("entry_quote_mismatch"),
                "risk_reward": _unavailable("entry_quote_mismatch")}
    close_event = snapshot.ledger[trade["close_event_sequence"] - 1]
    original_cost = calculate_round_trip_cost(costs, side, Decimal(str(trade["quantity"])),
                                               instrument.contract_size, entry_bid, entry_ask, close, close)
    if (close_event["details"].get("cost_model_version") != costs.version
            or Decimal(str(original_cost["net_account"])) != Decimal(str(trade["net_pnl"]))):
        return {**base, "excursion": {"status": "unsupported", "reason": "original_cost_model_mismatch"},
                "stop_loss": _unavailable("original_cost_model_mismatch"),
                "risk_reward": _unavailable("original_cost_model_mismatch")}
    distance = config["stop_distance_ticks"] * instrument.tick_size * config["stop_multiplier"]
    stop = entry - direction * distance
    take = entry + direction * distance * config["target_r"]
    gap_close = trade["exit_reason"] in {"stop_loss_gap", "take_profit_gap"}
    observations = [entry, close]
    for index, bar in enumerate(path):
        prices = [bar["open"]] if index == len(path) - 1 else [bar["high"], bar["low"]]
        for price in prices:
            bid, ask = quote_from_mid(price, spread_price=snapshot.spread_price, tick_size=instrument.tick_size)
            observations.append(bid if side == "BUY" else ask)
    changes = [(price - entry) * direction for price in observations]
    mae, mfe = max(Decimal(0), -min(changes)), max(Decimal(0), max(changes))
    excursion = {
        "status": "observed" if gap_close else "lower_bound",
        "basis": "closeable_bid_ask_price; terminal intrabar extrema excluded",
        "mae_price": float(mae), "mfe_price": float(mfe),
        "mae_r": float(mae / distance), "mfe_r": float(mfe / distance),
        "r_basis": "configured_stop_distance", "ideal_r": None,
        "excluded_terminal_bar": not gap_close,
    }

    def simulate(stop_only):
        if stop <= 0 or (not stop_only and take <= 0):
            return _unavailable("configured_bracket_nonpositive")
        # An unreachable opposite bracket permits reuse of the engine's stop/gap semantics.
        limit = (max(Decimal(str(b["high"])) for b in path) + snapshot.spread_price + instrument.tick_size
                 if side == "BUY" else instrument.tick_size / Decimal(2))
        scenario_take = limit if stop_only else take
        for index, bar in enumerate(path):
            terminal = index == len(path) - 1
            if terminal and gap_close:
                bar = {**bar, **{name: bar["open"] for name in ("high", "low", "close")}}
            try:
                exit_value = protective_exit_for_bar(
                    side=side, bar=bar, stop_loss=stop, take_profit=scenario_take,
                    spread_price=snapshot.spread_price, tick_size=instrument.tick_size,
                    allow_open_gap=index > 0)
            except IntrabarAmbiguityError:
                return {"status": "ambiguous", "reason": "intrabar_order_unknown",
                        "net_pnl": None, "exit_price": None}
            if exit_value is not None:
                if terminal and not exit_value["at_open"]:
                    return _unavailable("original_exit_precedes_unknown_terminal_extrema")
                result = outcome(exit_value["exit_price"], exit_value["reason"], start + index)
                if stop_only:
                    result["target_price"] = None
                return result
            if terminal and gap_close:
                # The position ceased to exist at this open: later extrema cannot be consulted.
                result = outcome(close, "original_close", end)
                if stop_only:
                    result["target_price"] = None
                return result
        result = outcome(close, "original_close", end)
        if stop_only:
            result["target_price"] = None
        return result

    def outcome(price, reason, cursor):
        result = calculate_round_trip_cost(costs, side, Decimal(str(trade["quantity"])),
                                           instrument.contract_size, entry_bid, entry_ask, price, price)
        return {"status": "ready", "reason": reason, "exit_cursor_index": cursor,
                "exit_price": float(price), "net_pnl": result["net_account"],
                "gross_pnl": result["gross_account"], "cost_model_version": costs.version,
                "stop_price": float(stop), "target_price": float(take)}

    return {**base, "excursion": excursion, "stop_loss": simulate(True), "risk_reward": simulate(False)}


def build_replay_experiments(record, bars, *, dataset_sha256, filters=None,
                             stop_distance_ticks=20, stop_multiplier=1, target_r=2):
    """Never changes a record or substitutes simulated financials into its ledger."""
    config = {"stop_distance_ticks": _positive(stop_distance_ticks, "stop_distance_ticks", 1000000),
              "stop_multiplier": _positive(stop_multiplier, "stop_multiplier", 100),
              "target_r": _positive(target_r, "target_r", 100)}
    analytics = build_replay_analytics_view(record, filters)
    response = {"schema_version": "replay-analytics-experiments-v1", "read_only": True,
                "config": {name: float(value) for name, value in config.items()},
                "provenance": analytics["provenance"], "scope": analytics["scope"],
                "account_currency": analytics.get("account_currency"), "rows": [],
                "bounds": "selected closed trades; original close; no future bars",
                "risk_basis": "user_configured_distance; not original planned risk",
                "blocked_by_data": analytics.get("blocked_by_data", [])}
    if not analytics["analytics_available"]:
        return response
    snapshot = parse_replay_execution_snapshot(record["payload"]["execution"])
    if dataset_sha256 != snapshot.dataset_sha256:
        raise AnalyticsValidationError("experiment dataset hash disagrees with execution")
    instrument = InstrumentSpec.from_mapping(snapshot.instrument_spec)
    costs = CostModel.from_mapping(snapshot.cost_model)
    if instrument.account_ccy != costs.account_ccy:
        raise AnalyticsValidationError("experiment instrument and cost currency disagree")
    visible = bars[:snapshot.cursor_index + 1]
    response["rows"] = [_trade_experiment(trade, visible, snapshot, config, instrument, costs)
                        for trade in analytics["ledger"]]
    response["summary"] = {}
    for name in ("stop_loss", "risk_reward"):
        outcomes = [row[name] for row in response["rows"]]
        ready = [item for item in outcomes if item["status"] == "ready"]
        response["summary"][name] = {
            "selected_trade_count": len(outcomes), "supported_trade_count": len(ready),
            "ambiguous_trade_count": sum(item["status"] == "ambiguous" for item in outcomes),
            "unsupported_trade_count": sum(item["status"] == "unsupported" for item in outcomes),
            "net_pnl": sum(item["net_pnl"] for item in ready) if len(ready) == len(outcomes) else None,
            "supported_subset_net_pnl": sum(item["net_pnl"] for item in ready) if ready else None,
        }
    return response
