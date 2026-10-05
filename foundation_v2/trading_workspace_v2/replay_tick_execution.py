"""Opt-in execution on immutable broker Bid/Ask ticks, with no OHLC fallback."""

from __future__ import annotations

from decimal import Decimal
from typing import Iterable, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .execution_semantics import validate_ohlc_bar
from .replay_execution import (
    ReplayExecutionAdvance,
    ReplayExecutionError,
    ReplayExecutionEventV2,
    ReplayExecutionSnapshotV2,
    ReplayMarginAdmission,
    ReplayOpenPosition,
    ReplayQueuedMarketOrder,
    ReplayResearchMargin,
    _decimal,
    _liquidation_pnl,
    initialize_replay_execution,
    reconstruct_replay_execution_checkpoint,
)
from .retained import CostModel, InstrumentSpec


class BrokerReplayTick(BaseModel):
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False, frozen=True)
    time_msc: int = Field(ge=0, strict=True)
    sequence: int = Field(ge=0, strict=True)
    bid: Decimal = Field(gt=0)
    ask: Decimal = Field(gt=0)

    @model_validator(mode="after")
    def quotes_are_ordered(self):
        if self.ask < self.bid:
            raise ValueError("broker tick ask must be at least bid")
        return self


class ReplayTickExecutionSnapshot(ReplayExecutionSnapshotV2):
    schema_version: Literal["replay-execution-tick-v1"] = "replay-execution-tick-v1"
    tick_snapshot_id: str = Field(min_length=1, max_length=128, frozen=True)
    tick_snapshot_sha256: str = Field(pattern=r"^[a-f0-9]{64}$", frozen=True)
    quote_source: Literal["broker_bid_ask"] = "broker_bid_ask"
    last_bid: Decimal | None = Field(default=None, gt=0)
    last_ask: Decimal | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def tick_quotes_and_ledger_are_consistent(self):
        if (self.last_bid is None) != (self.last_ask is None):
            raise ValueError("tick checkpoint requires both last quotes")
        if self.last_bid is not None and self.last_ask < self.last_bid:
            raise ValueError("tick checkpoint ask must be at least bid")
        if self.spread_price != 0 or self.cost_model.get("spread_basis") != "bid_ask_embedded":
            raise ValueError("tick execution uses embedded broker spread only")
        last_quote_key = None
        last_cursor = -1
        last_time = -1
        for sequence, raw in enumerate(self.ledger, start=1):
            event = validate_tick_execution_event(self, raw)
            if (event.sequence != sequence or event.replay_session_id != self.replay_session_id
                    or event.branch_id != self.branch_id or event.dataset_id != self.dataset_id
                    or event.dataset_sha256 != self.dataset_sha256
                    or not last_cursor <= event.cursor_index <= self.cursor_index
                    or event.virtual_time_utc < last_time):
                raise ValueError("tick execution ledger lineage/time is inconsistent")
            last_cursor, last_time = event.cursor_index, event.virtual_time_utc
            if "time_msc" in event.details:
                key = (event.details["time_msc"], event.details["sequence"])
                if last_quote_key is not None and key < last_quote_key:
                    raise ValueError("tick ledger reverses broker quote order")
                last_quote_key = key
        if self.event_sequence != len(self.ledger):
            raise ValueError("tick execution ledger length differs from its event sequence")
        quote_event = next((raw for raw in reversed(self.ledger) if "bid" in raw.get("details", {})), None)
        if quote_event is not None and (self.last_bid != _decimal(quote_event["details"]["bid"], "last bid")
                or self.last_ask != _decimal(quote_event["details"]["ask"], "last ask")):
            raise ValueError("tick checkpoint quotes differ from its canonical ledger")
        return self


class ReplayTickExecutionAdvance(ReplayExecutionAdvance):
    snapshot: ReplayTickExecutionSnapshot


def initialize_tick_execution(
    *, tick_snapshot_id: str, tick_snapshot_sha256: str,
    research_margin: ReplayResearchMargin | dict, **kwargs,
) -> ReplayTickExecutionSnapshot:
    base = initialize_replay_execution(research_margin=research_margin, **kwargs)
    raw = base.model_dump(mode="python")
    raw.update(schema_version="replay-execution-tick-v1", tick_snapshot_id=tick_snapshot_id,
               tick_snapshot_sha256=tick_snapshot_sha256)
    return ReplayTickExecutionSnapshot.model_validate(raw)


def validate_tick_execution_event(
    snapshot: ReplayTickExecutionSnapshot, raw: dict,
) -> ReplayExecutionEventV2:
    """Supplement the existing V2 money/margin validation with tick provenance."""
    event = ReplayExecutionEventV2.model_validate(raw)
    # Native closed-checkpoint amendments/transitions retain their V2 contracts.
    if event.kind == "phase_transition":
        return event
    d = event.details
    if (d.get("tick_snapshot_id") != snapshot.tick_snapshot_id
            or d.get("tick_snapshot_sha256") != snapshot.tick_snapshot_sha256
            or d.get("quote_source") != snapshot.quote_source):
        raise ReplayExecutionError("tick event provenance differs from the frozen snapshot")
    tick = BrokerReplayTick.model_validate(d)
    position = ReplayOpenPosition.model_validate(d["open_position"]) if d.get("open_position") else None
    pending = ReplayQueuedMarketOrder.model_validate(d["pending_market_order"]) if d.get("pending_market_order") else None
    if event.open_positions != int(position is not None) or event.pending_orders != int(pending is not None):
        raise ReplayExecutionError("tick event checkpoint state is inconsistent")
    expected_floating = Decimal("0")
    if position:
        expected_floating, _ = _liquidation_pnl(position, exit_bid=tick.bid, exit_ask=tick.ask,
            instrument=InstrumentSpec.from_mapping(snapshot.instrument_spec),
            cost_model=CostModel.from_mapping(snapshot.cost_model))
    if event.floating_pl != expected_floating:
        raise ReplayExecutionError("tick event floating pnl differs from its observed closeable quote")
    if event.kind == "protection_change":
        target = d.get("open_position") or d.get("pending_market_order")
        reference = tick.bid if target.get("side") == "BUY" else tick.ask
        if _decimal(d["closeable_quote"], "closeable quote") != reference:
            raise ReplayExecutionError("tick protection must use the observed closeable quote")
        return event
    start = d.get("window_start_msc")
    end = d.get("window_end_msc")
    if (type(start) is not int or type(end) is not int or start < 0
            or end - start != snapshot.timeframe_seconds * 1000
            or not start <= tick.time_msc < end):
        raise ReplayExecutionError("tick event quote is outside its closed bar window")
    expected_time = end // 1000 if event.kind == "price_mark" else tick.time_msc // 1000
    if event.virtual_time_utc != expected_time:
        raise ReplayExecutionError("tick event time differs from observed causal time")
    if event.kind in {"market_fill", "order_rejected", "protective_fill"}:
        side = d.get("side")
        if side not in {"BUY", "SELL"}:
            raise ReplayExecutionError("tick fill lacks its position side")
        quote = (tick.ask if side == "BUY" else tick.bid) if event.kind != "protective_fill" else (
            tick.bid if side == "BUY" else tick.ask)
        if _decimal(d.get("fill_price"), "tick fill", positive=True) != quote:
            raise ReplayExecutionError("tick fill differs from its observed broker side")
        if event.kind == "protective_fill":
            closed = ReplayOpenPosition.model_validate(d.get("closed_position"))
            stop_hit = quote <= closed.stop_loss if side == "BUY" else quote >= closed.stop_loss
            target_hit = quote >= closed.take_profit if side == "BUY" else quote <= closed.take_profit
            reason = "stop_loss" if stop_hit else "take_profit" if target_hit else None
            if (closed.side != side or closed.position_id != d.get("position_id")
                    or closed.source_operation_id != d.get("operation_id") or d.get("reason") != reason
                    or reason is None):
                raise ReplayExecutionError("tick closing fill does not match its observed protective trigger")
            realized, cost = _liquidation_pnl(closed, exit_bid=tick.bid, exit_ask=tick.ask,
                instrument=InstrumentSpec.from_mapping(snapshot.instrument_spec),
                cost_model=CostModel.from_mapping(snapshot.cost_model))
            if (_decimal(d.get("net_pnl"), "tick realized pnl") != realized
                    or d.get("cost_model_version") != cost["cost_model_version"]
                    or d.get("cost_breakdown") != cost):
                raise ReplayExecutionError("tick closing fill cost accounting differs from frozen assumptions")
    if event.kind == "price_mark" and (
            _decimal(d.get("bid_close"), "bid close") != tick.bid
            or _decimal(d.get("ask_close"), "ask close") != tick.ask
            or _decimal(d.get("quote_mid_close"), "quote mid close") != (tick.bid + tick.ask) / 2):
        raise ReplayExecutionError("tick close mark differs from its observed broker quote")
    return event


def advance_tick_execution(
    snapshot: ReplayTickExecutionSnapshot, *, ticks: Iterable[dict | BrokerReplayTick],
    bar: dict, cursor_index: int,
) -> ReplayTickExecutionAdvance:
    if type(cursor_index) is not int or cursor_index != snapshot.cursor_index + 1:
        raise ReplayExecutionError("execution cursor must advance exactly one bar")
    validate_ohlc_bar(bar)
    timestamp = bar["timestamp"]
    if type(timestamp) is not int or timestamp < 0:
        raise ReplayExecutionError("bar timestamp must be nonnegative unix seconds")
    start, end = timestamp * 1000, (timestamp + snapshot.timeframe_seconds) * 1000
    if snapshot.ledger and timestamp < snapshot.ledger[-1]["virtual_time_utc"]:
        raise ReplayExecutionError("tick bar precedes the canonical execution checkpoint")
    instrument = InstrumentSpec.from_mapping(snapshot.instrument_spec)
    costs = CostModel.from_mapping(snapshot.cost_model)
    if snapshot.spread_price != 0 or costs.spread_basis != "bid_ask_embedded":
        raise ReplayExecutionError("tick execution requires embedded broker spread")
    balance, position, pending = snapshot.balance, snapshot.position, snapshot.pending_market_order
    ledger = list(snapshot.ledger)
    events = []
    sequence = snapshot.event_sequence
    last_tick = None
    exposure = position is not None

    def floating(tick):
        if position is None:
            return Decimal("0")
        value, _ = _liquidation_pnl(position, exit_bid=tick.bid, exit_ask=tick.ask,
                                  instrument=instrument, cost_model=costs)
        return value

    def record(kind, tick, detail, *, mark=False):
        nonlocal sequence
        sequence += 1
        fp = floating(tick)
        event = ReplayExecutionEventV2(
            sequence=sequence, kind=kind, replay_session_id=snapshot.replay_session_id,
            branch_id=snapshot.branch_id, dataset_id=snapshot.dataset_id,
            dataset_sha256=snapshot.dataset_sha256, cursor_index=cursor_index,
            virtual_time_utc=end // 1000 if mark else tick.time_msc // 1000,
            balance=balance, floating_pl=fp, equity=balance + fp,
            open_positions=int(position is not None), pending_orders=int(pending is not None),
            details={"tick_snapshot_id": snapshot.tick_snapshot_id,
                     "tick_snapshot_sha256": snapshot.tick_snapshot_sha256,
                     "quote_source": snapshot.quote_source,
                     **tick.model_dump(mode="json"), "window_start_msc": start,
                     "window_end_msc": end,
                     "open_position": position.model_dump(mode="json") if position else None,
                     "pending_market_order": pending.model_dump(mode="json") if pending else None,
                     **detail},
        )
        validate_tick_execution_event(snapshot, event.model_dump(mode="json"))
        events.append(event)
        ledger.append(event.model_dump(mode="json"))

    for raw in ticks:
        tick = raw if isinstance(raw, BrokerReplayTick) else BrokerReplayTick.model_validate(raw)
        if not start <= tick.time_msc < end:
            raise ReplayExecutionError("tick is outside the closed bar window; no future quotes allowed")
        if last_tick is not None and (tick.time_msc, tick.sequence) <= (last_tick.time_msc, last_tick.sequence):
            raise ReplayExecutionError("broker tick order must be strictly increasing, including same-ms sequence")
        if any(quote / instrument.tick_size != (quote / instrument.tick_size).to_integral_value()
               for quote in (tick.bid, tick.ask)):
            raise ReplayExecutionError("broker tick price does not align with instrument tick size")
        last_tick = tick
        if pending is not None:
            order = pending
            entry_fill = tick.ask if order.side == "BUY" else tick.bid
            if order.submitted_cursor_index != snapshot.cursor_index:
                raise ReplayExecutionError("tick order must be submitted at the previous closed bar")
            if not (order.stop_loss < entry_fill < order.take_profit if order.side == "BUY"
                    else order.take_profit < entry_fill < order.stop_loss):
                raise ReplayExecutionError("tick market gap invalidates the submitted protection bracket")
            required = (entry_fill * order.quantity * instrument.contract_size
                        * costs.quote_to_account_rate / snapshot.research_margin.leverage)
            admission = ReplayMarginAdmission(**snapshot.research_margin.model_dump(),
                required_account=required, available_account=snapshot.starting_balance,
                submitted_cursor_index=order.submitted_cursor_index)
            pending = None
            detail = {"operation_id": order.operation_id, "side": order.side,
                      "quantity": str(order.quantity), "fill_price": str(entry_fill),
                      "margin_admission": admission.model_dump(mode="json")}
            if required > snapshot.starting_balance:
                record("order_rejected", tick, {**detail, "reason": "insufficient_research_margin"})
            else:
                position = ReplayOpenPosition(position_id=f"replay-pos-{sequence + 1}",
                    source_operation_id=order.operation_id, side=order.side, quantity=order.quantity,
                    entry_bid=tick.bid, entry_ask=tick.ask, entry_fill=entry_fill,
                    stop_loss=order.stop_loss, take_profit=order.take_profit,
                    opened_cursor_index=cursor_index, opened_time_utc=tick.time_msc // 1000)
                exposure = True
                record("market_fill", tick, {**detail, "position_id": position.position_id})
        if position is not None:
            quote = tick.bid if position.side == "BUY" else tick.ask
            stop_hit = quote <= position.stop_loss if position.side == "BUY" else quote >= position.stop_loss
            target_hit = quote >= position.take_profit if position.side == "BUY" else quote <= position.take_profit
            if stop_hit or target_hit:
                closed = position
                realized, cost = _liquidation_pnl(closed, exit_bid=tick.bid, exit_ask=tick.ask,
                                                instrument=instrument, cost_model=costs)
                balance += realized
                position = None
                record("protective_fill", tick, {"operation_id": closed.source_operation_id,
                    "position_id": closed.position_id, "side": closed.side,
                    "quantity": str(closed.quantity), "reason": "stop_loss" if stop_hit else "take_profit",
                    "fill_price": str(quote), "net_pnl": str(realized),
                    "cost_model_version": cost["cost_model_version"], "cost_breakdown": cost,
                    "closed_position": closed.model_dump(mode="json")})
    if last_tick is None:
        raise ReplayExecutionError("tick coverage is empty; OHLC fallback is disabled")
    record("price_mark", last_tick, {
        "mid_close": str(_decimal(bar["close"], "bar close", positive=True)),
        "quote_mid_close": str((last_tick.bid + last_tick.ask) / 2),
        "bid_close": str(last_tick.bid), "ask_close": str(last_tick.ask),
        # Prop currently evaluates close marks, not every tick's equity path.
        "intrabar_equity_coverage": "insufficient" if exposure else "complete",
        "open_position": position.model_dump(mode="json") if position else None,
        "pending_market_order": pending.model_dump(mode="json") if pending else None,
    }, mark=True)
    fp = floating(last_tick)
    return ReplayTickExecutionAdvance(snapshot=snapshot.model_copy(update={
        "balance": balance, "floating_pl": fp, "equity": balance + fp,
        "cursor_index": cursor_index, "event_sequence": sequence, "position": position,
        "pending_market_order": pending, "ledger": ledger,
        "last_bid": last_tick.bid, "last_ask": last_tick.ask,
    }), events=events)


def reconstruct_tick_execution_checkpoint(snapshot: ReplayTickExecutionSnapshot, *, cursor_index: int,
                                          event_sequence: int | None = None) -> ReplayTickExecutionSnapshot:
    checkpoint = reconstruct_replay_execution_checkpoint(snapshot, cursor_index=cursor_index,
                                                          event_sequence=event_sequence)
    if not checkpoint.ledger:
        return checkpoint.model_copy(update={"last_bid": None, "last_ask": None})
    quote_event = next((raw for raw in reversed(checkpoint.ledger) if "bid" in raw.get("details", {})), None)
    if quote_event is None:
        raise ReplayExecutionError("tick checkpoint lacks canonical broker quotes")
    return checkpoint.model_copy(update={"last_bid": _decimal(quote_event["details"]["bid"], "bid"),
                                          "last_ask": _decimal(quote_event["details"]["ask"], "ask")})


def change_tick_protection(snapshot: ReplayTickExecutionSnapshot, *, target_id: str, operation_id: str,
                           stop_loss, take_profit, mid_close, virtual_time_utc: int) -> ReplayTickExecutionSnapshot:
    from .replay_execution import change_replay_protection

    if snapshot.last_bid is None or snapshot.last_ask is None or not snapshot.ledger:
        raise ReplayExecutionError("protection amendment requires a canonical broker quote")
    quote_event = next((raw for raw in reversed(snapshot.ledger) if "bid" in raw.get("details", {})), None)
    if quote_event is None or virtual_time_utc != snapshot.ledger[-1]["virtual_time_utc"]:
        raise ReplayExecutionError("protection amendment must stay at the current canonical checkpoint")
    active = snapshot.position or snapshot.pending_market_order
    if active is None:
        raise ReplayExecutionError("there is no active replay order or position")
    quote = snapshot.last_bid if active.side == "BUY" else snapshot.last_ask
    updated = change_replay_protection(snapshot, target_id=target_id, operation_id=operation_id,
        stop_loss=stop_loss, take_profit=take_profit, mid_close=quote, virtual_time_utc=virtual_time_utc)
    raw = updated.ledger[-1]
    d = dict(raw["details"])
    d.update({key: quote_event["details"][key] for key in (
        "tick_snapshot_id", "tick_snapshot_sha256", "quote_source", "time_msc", "sequence", "bid", "ask")})
    d["mid_close"] = str(_decimal(mid_close, "mid close", positive=True))
    raw = {**raw, "details": d}
    validate_tick_execution_event(snapshot, raw)
    return updated.model_copy(update={"ledger": [*updated.ledger[:-1], raw]})
