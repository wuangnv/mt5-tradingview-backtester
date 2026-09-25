from __future__ import annotations

from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR


class ExecutionSemanticsError(ValueError):
    pass


class IntrabarAmbiguityError(ExecutionSemanticsError):
    pass


def _decimal(value, label: str, *, positive: bool = False) -> Decimal:
    try:
        result = Decimal(str(value))
    except Exception as exc:
        raise ExecutionSemanticsError(f"{label} must be decimal") from exc
    if not result.is_finite() or (positive and result <= 0):
        raise ExecutionSemanticsError(f"{label} must be finite{' and positive' if positive else ''}")
    return result


def quote_from_mid(mid, *, spread_price, tick_size) -> tuple[Decimal, Decimal]:
    """Return deterministic bid/ask using the accepted U5b adverse tick rounding."""

    mid_value = _decimal(mid, "mid", positive=True)
    spread = _decimal(spread_price, "spread_price")
    tick = _decimal(tick_size, "tick_size", positive=True)
    if spread < 0:
        raise ExecutionSemanticsError("spread_price must be nonnegative")
    half_spread = spread / Decimal(2)
    bid = ((mid_value - half_spread) / tick).to_integral_value(rounding=ROUND_FLOOR) * tick
    ask = ((mid_value + half_spread) / tick).to_integral_value(rounding=ROUND_CEILING) * tick
    if bid <= 0 or ask <= 0 or ask < bid:
        raise ExecutionSemanticsError("derived bid/ask quote is invalid")
    return bid, ask


def validate_ohlc_bar(bar: dict) -> None:
    values = {name: _decimal(bar.get(name), name, positive=True) for name in ("open", "high", "low", "close")}
    if not (
        values["low"]
        <= min(values["open"], values["close"])
        <= max(values["open"], values["close"])
        <= values["high"]
    ):
        raise ExecutionSemanticsError("invalid OHLC bar")


def protective_exit_for_bar(
    *,
    side: str,
    bar: dict,
    stop_loss,
    take_profit,
    spread_price,
    tick_size,
    allow_open_gap: bool,
) -> dict | None:
    """Evaluate one OHLC bar with the accepted U5b protective-order ordering.

    If both stop and take-profit are reachable inside one bar and lower-timeframe
    ordering is unavailable, fail closed instead of inventing a winner.
    """

    validate_ohlc_bar(bar)
    side = str(side).upper()
    if side not in {"BUY", "SELL"}:
        raise ExecutionSemanticsError("side must be BUY or SELL")
    stop = _decimal(stop_loss, "stop_loss", positive=True)
    take = _decimal(take_profit, "take_profit", positive=True)
    if side == "BUY" and not stop < take:
        raise ExecutionSemanticsError("BUY protective stop must be below take-profit")
    if side == "SELL" and not take < stop:
        raise ExecutionSemanticsError("SELL protective take-profit must be below stop")

    open_bid, open_ask = quote_from_mid(
        bar["open"], spread_price=spread_price, tick_size=tick_size
    )
    if allow_open_gap:
        if side == "BUY" and open_bid <= stop:
            return {"exit_price": open_bid, "reason": "stop_loss_gap", "at_open": True}
        if side == "BUY" and open_bid >= take:
            return {"exit_price": take, "reason": "take_profit_gap", "at_open": True}
        if side == "SELL" and open_ask >= stop:
            return {"exit_price": open_ask, "reason": "stop_loss_gap", "at_open": True}
        if side == "SELL" and open_ask <= take:
            return {"exit_price": take, "reason": "take_profit_gap", "at_open": True}

    low_bid, low_ask = quote_from_mid(
        bar["low"], spread_price=spread_price, tick_size=tick_size
    )
    high_bid, high_ask = quote_from_mid(
        bar["high"], spread_price=spread_price, tick_size=tick_size
    )
    if side == "BUY":
        stop_hit = low_bid <= stop
        take_hit = high_bid >= take
    else:
        stop_hit = high_ask >= stop
        take_hit = low_ask <= take
    if stop_hit and take_hit:
        raise IntrabarAmbiguityError(
            "protective exit is intrabar ambiguous; lower-timeframe ordering required"
        )
    if stop_hit:
        return {"exit_price": stop, "reason": "stop_loss", "at_open": False}
    if take_hit:
        return {"exit_price": take, "reason": "take_profit", "at_open": False}
    return None
