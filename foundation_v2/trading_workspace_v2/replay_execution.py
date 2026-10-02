from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .execution_semantics import (
    IntrabarAmbiguityError,
    protective_exit_for_bar,
    quote_from_mid,
    validate_ohlc_bar,
)
from .retained import CostModel, InstrumentSpec, calculate_round_trip_cost


class ReplayExecutionError(ValueError):
    pass


def _decimal(value, label: str, *, positive: bool = False) -> Decimal:
    try:
        result = Decimal(str(value))
    except Exception as exc:
        raise ReplayExecutionError(f"{label} must be decimal") from exc
    if not result.is_finite() or (positive and result <= 0):
        raise ReplayExecutionError(f"{label} must be finite{' and positive' if positive else ''}")
    return result


class ReplayQueuedMarketOrder(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_id: str = Field(min_length=1, max_length=128)
    side: Literal["BUY", "SELL"]
    quantity: Decimal = Field(gt=0)
    stop_loss: Decimal = Field(gt=0)
    take_profit: Decimal = Field(gt=0)
    submitted_cursor_index: int = Field(ge=0, strict=True)


class ReplayOpenPosition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    position_id: str = Field(min_length=1, max_length=128)
    source_operation_id: str = Field(min_length=1, max_length=128)
    side: Literal["BUY", "SELL"]
    quantity: Decimal = Field(gt=0)
    entry_bid: Decimal = Field(gt=0)
    entry_ask: Decimal = Field(gt=0)
    entry_fill: Decimal = Field(gt=0)
    stop_loss: Decimal = Field(gt=0)
    take_profit: Decimal = Field(gt=0)
    opened_cursor_index: int = Field(ge=0, strict=True)
    opened_time_utc: int = Field(ge=0, strict=True)


class ReplayExecutionSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["replay-execution-v1"] = "replay-execution-v1"
    replay_session_id: str = Field(min_length=1, max_length=128)
    branch_id: str = Field(min_length=1, max_length=128)
    dataset_id: str = Field(min_length=1, max_length=128)
    dataset_sha256: str = Field(min_length=8, max_length=128)
    instrument_spec: dict
    cost_model: dict
    spread_price: Decimal = Field(ge=0)
    timeframe_seconds: int = Field(gt=0, strict=True)
    starting_balance: Decimal = Field(gt=0)
    phase_index: int = Field(default=1, ge=1, strict=True)
    phase_initial_balance: Decimal | None = Field(default=None, gt=0)
    balance: Decimal
    floating_pl: Decimal = Decimal("0")
    equity: Decimal
    cursor_index: int = Field(ge=0, strict=True)
    event_sequence: int = Field(default=0, ge=0, strict=True)
    pending_market_order: ReplayQueuedMarketOrder | None = None
    position: ReplayOpenPosition | None = None
    ledger: list[dict] = Field(default_factory=list)
    evaluation_quality: Literal["full_for_declared_model", "insufficient"] = "full_for_declared_model"

    @model_validator(mode="after")
    def money_is_consistent(self):
        if self.equity != self.balance + self.floating_pl:
            raise ValueError("equity must equal balance plus floating_pl")
        return self


class ReplayExecutionEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sequence: int = Field(ge=1, strict=True)
    kind: Literal["market_fill", "protective_fill", "price_mark", "phase_transition"]
    replay_session_id: str = Field(min_length=1, max_length=128)
    branch_id: str = Field(min_length=1, max_length=128)
    dataset_id: str = Field(min_length=1, max_length=128)
    dataset_sha256: str = Field(min_length=8, max_length=128)
    cursor_index: int = Field(ge=0, strict=True)
    virtual_time_utc: int = Field(ge=0, strict=True)
    balance: Decimal
    floating_pl: Decimal
    equity: Decimal
    open_positions: int = Field(ge=0, le=1, strict=True)
    pending_orders: int = Field(ge=0, le=1, strict=True)
    evaluation_quality: Literal["full_for_declared_model"] = "full_for_declared_model"
    details: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def money_is_consistent(self):
        if self.equity != self.balance + self.floating_pl:
            raise ValueError("event equity must equal balance plus floating_pl")
        return self


class ReplayExecutionAdvance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    snapshot: ReplayExecutionSnapshot
    events: list[ReplayExecutionEvent]


class ReplayPhaseTransition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    snapshot: ReplayExecutionSnapshot
    event: ReplayExecutionEvent


def reconstruct_replay_execution_checkpoint(
    snapshot: ReplayExecutionSnapshot,
    *,
    cursor_index: int,
) -> ReplayExecutionSnapshot:
    """Rebuild an immutable bar-close execution checkpoint from the canonical ledger."""

    if isinstance(cursor_index, bool) or not isinstance(cursor_index, int) or cursor_index < 0:
        raise ReplayExecutionError("checkpoint cursor_index must be a nonnegative integer")
    if cursor_index > snapshot.cursor_index:
        raise ReplayExecutionError("checkpoint cursor cannot exceed the replay execution cursor")
    if cursor_index == snapshot.cursor_index:
        return snapshot

    selected: ReplayExecutionEvent | None = None
    prefix: list[ReplayExecutionEvent] = []
    expected_sequence = 1
    phase_index = 1
    phase_initial_balance = snapshot.starting_balance
    for raw in snapshot.ledger:
        event = ReplayExecutionEvent.model_validate(raw)
        if event.sequence != expected_sequence:
            raise ReplayExecutionError("replay execution ledger sequence is not contiguous")
        expected_sequence += 1
        if (
            event.replay_session_id != snapshot.replay_session_id
            or event.branch_id != snapshot.branch_id
            or event.dataset_id != snapshot.dataset_id
            or event.dataset_sha256 != snapshot.dataset_sha256
        ):
            raise ReplayExecutionError("replay execution ledger lineage is inconsistent")
        if event.cursor_index > snapshot.cursor_index:
            raise ReplayExecutionError("replay execution ledger cursor exceeds the snapshot cursor")
        if event.cursor_index > cursor_index:
            break
        prefix.append(event)
        if event.kind == "phase_transition":
            details = event.details or {}
            from_phase = int(details.get("from_phase_index") or 0)
            to_phase = int(details.get("to_phase_index") or 0)
            if from_phase != phase_index or to_phase != from_phase + 1:
                raise ReplayExecutionError("replay phase-transition ledger is inconsistent")
            phase_index = to_phase
            phase_initial_balance = _decimal(
                details.get("next_phase_initial_balance"),
                "next_phase_initial_balance",
                positive=True,
            )
        # A phase transition can follow the bar's price mark without advancing
        # the cursor. Preserve that entire checkpoint before the next bar.
        if event.kind in {"price_mark", "phase_transition"} and event.cursor_index == cursor_index:
            selected = event

    if selected is None:
        raise ReplayExecutionError("execution branch cursor has no canonical checkpoint")

    details = selected.details or {}
    raw_position = details.get("open_position")
    raw_pending = details.get("pending_market_order")
    position = ReplayOpenPosition.model_validate(raw_position) if raw_position is not None else None
    pending = ReplayQueuedMarketOrder.model_validate(raw_pending) if raw_pending is not None else None
    if selected.open_positions != (1 if position is not None else 0):
        raise ReplayExecutionError("replay checkpoint position state is inconsistent")
    if selected.pending_orders != (1 if pending is not None else 0):
        raise ReplayExecutionError("replay checkpoint pending-order state is inconsistent")

    ledger = [event.model_dump(mode="json") for event in prefix]
    return snapshot.model_copy(
        update={
            "phase_index": phase_index,
            "phase_initial_balance": phase_initial_balance,
            "balance": selected.balance,
            "floating_pl": selected.floating_pl,
            "equity": selected.equity,
            "cursor_index": cursor_index,
            "event_sequence": selected.sequence,
            "pending_market_order": pending,
            "position": position,
            "ledger": ledger,
        }
    )


def fork_replay_execution_checkpoint(
    snapshot: ReplayExecutionSnapshot,
    *,
    replay_session_id: str,
    branch_id: str,
) -> ReplayExecutionSnapshot:
    """Fork a canonical checkpoint onto a new Replay session/branch lineage."""

    if snapshot.event_sequence != len(snapshot.ledger):
        raise ReplayExecutionError("replay execution ledger length does not match event_sequence")
    remapped_ledger: list[dict] = []
    for expected_sequence, raw in enumerate(snapshot.ledger, start=1):
        event = ReplayExecutionEvent.model_validate(raw)
        if event.sequence != expected_sequence:
            raise ReplayExecutionError("replay execution ledger sequence is not contiguous")
        if (
            event.replay_session_id != snapshot.replay_session_id
            or event.branch_id != snapshot.branch_id
            or event.dataset_id != snapshot.dataset_id
            or event.dataset_sha256 != snapshot.dataset_sha256
        ):
            raise ReplayExecutionError("replay execution ledger lineage is inconsistent")
        remapped_ledger.append(
            event.model_copy(
                update={"replay_session_id": replay_session_id, "branch_id": branch_id}
            ).model_dump(mode="json")
        )
    return snapshot.model_copy(
        update={
            "replay_session_id": replay_session_id,
            "branch_id": branch_id,
            "ledger": remapped_ledger,
        }
    )


def _instrument_mapping(instrument: InstrumentSpec) -> dict:
    return {
        "instrument_id": instrument.instrument_id,
        "asset_class": instrument.asset_class,
        "base_ccy": instrument.base_ccy,
        "quote_ccy": instrument.quote_ccy,
        "account_ccy": instrument.account_ccy,
        "tick_size": str(instrument.tick_size),
        "pip_size": str(instrument.pip_size),
        "contract_size": str(instrument.contract_size),
        "quantity_min": str(instrument.quantity_min),
        "quantity_step": str(instrument.quantity_step),
        "effective_from_utc": instrument.effective_from_utc,
        "effective_to_utc": instrument.effective_to_utc,
    }


def _cost_mapping(cost_model: CostModel) -> dict:
    return {
        "version": cost_model.version,
        "spread_basis": cost_model.spread_basis,
        "commission_per_side_account": str(cost_model.commission_per_side_account),
        "minimum_fee_account": str(cost_model.minimum_fee_account),
        "slippage_price_per_side": str(cost_model.slippage_price_per_side),
        "financing_account": str(cost_model.financing_account),
        "quote_to_account_rate": str(cost_model.quote_to_account_rate),
        "account_ccy": cost_model.account_ccy,
        "rounding_decimals": cost_model.rounding_decimals,
    }


def initialize_replay_execution(
    *,
    replay_session_id: str,
    branch_id: str,
    dataset_id: str,
    dataset_sha256: str,
    instrument_spec: dict,
    cost_model: dict,
    spread_price,
    timeframe_seconds: int,
    starting_balance,
    cursor_index: int,
) -> ReplayExecutionSnapshot:
    balance = _decimal(starting_balance, "starting_balance", positive=True)
    instrument = InstrumentSpec.from_mapping(instrument_spec)
    costs = CostModel.from_mapping(cost_model)
    if instrument.account_ccy != costs.account_ccy:
        raise ReplayExecutionError("instrument and cost model account currency mismatch")
    spread = _decimal(spread_price, "spread_price")
    if spread < 0:
        raise ReplayExecutionError("spread_price must be nonnegative")
    if isinstance(timeframe_seconds, bool) or not isinstance(timeframe_seconds, int) or timeframe_seconds <= 0:
        raise ReplayExecutionError("timeframe_seconds must be a positive integer")
    return ReplayExecutionSnapshot(
        replay_session_id=replay_session_id,
        branch_id=branch_id,
        dataset_id=dataset_id,
        dataset_sha256=dataset_sha256,
        instrument_spec=_instrument_mapping(instrument),
        cost_model=_cost_mapping(costs),
        spread_price=spread,
        timeframe_seconds=timeframe_seconds,
        starting_balance=balance,
        phase_index=1,
        phase_initial_balance=balance,
        balance=balance,
        equity=balance,
        cursor_index=cursor_index,
    )


def _validate_quantity(quantity: Decimal, instrument: InstrumentSpec) -> None:
    if quantity < instrument.quantity_min:
        raise ReplayExecutionError("quantity is below instrument minimum")
    steps = quantity / instrument.quantity_step
    if steps != steps.to_integral_value():
        raise ReplayExecutionError("quantity does not align with instrument step")


def queue_market_order(
    snapshot: ReplayExecutionSnapshot,
    *,
    operation_id: str,
    side: Literal["BUY", "SELL"],
    quantity,
    stop_loss,
    take_profit,
) -> ReplayExecutionSnapshot:
    if snapshot.position is not None or snapshot.pending_market_order is not None:
        raise ReplayExecutionError("initial replay execution core supports one active or queued position")
    if any((item.get("details") or {}).get("operation_id") == operation_id for item in snapshot.ledger):
        raise ReplayExecutionError("operation_id was already consumed")
    instrument = InstrumentSpec.from_mapping(snapshot.instrument_spec)
    qty = _decimal(quantity, "quantity", positive=True)
    _validate_quantity(qty, instrument)
    order = ReplayQueuedMarketOrder(
        operation_id=operation_id,
        side=side,
        quantity=qty,
        stop_loss=_decimal(stop_loss, "stop_loss", positive=True),
        take_profit=_decimal(take_profit, "take_profit", positive=True),
        submitted_cursor_index=snapshot.cursor_index,
    )
    return snapshot.model_copy(update={"pending_market_order": order})


def transition_replay_phase(
    snapshot: ReplayExecutionSnapshot,
    *,
    intent_id: str,
    intent_fingerprint: str,
    from_phase_index: int,
    to_phase_index: int,
    carry_policy: Literal["reset", "carry_balance", "carry_all"],
    position_policy: Literal["must_be_flat", "carry", "close_by_simulator"],
    next_phase_initial_balance,
    virtual_time_utc: int,
) -> ReplayPhaseTransition:
    """Record a zero-time canonical account transition between Prop phases."""

    if snapshot.pending_market_order is not None:
        raise ReplayExecutionError("phase transition requires zero pending replay orders")
    if snapshot.phase_index != from_phase_index:
        raise ReplayExecutionError("replay phase transition does not match the canonical replay phase")
    if to_phase_index != from_phase_index + 1:
        raise ReplayExecutionError("replay phase transition must advance exactly one phase")
    next_initial = _decimal(next_phase_initial_balance, "next_phase_initial_balance", positive=True)
    if virtual_time_utc < 0:
        raise ReplayExecutionError("phase transition virtual_time_utc must be nonnegative")

    position = snapshot.position
    if position is not None and position_policy == "close_by_simulator":
        raise ReplayExecutionError("close_by_simulator with an open replay position is not supported yet")
    if carry_policy in {"reset", "carry_balance"} and position is not None:
        raise ReplayExecutionError("reset/carry_balance phase transition requires a flat replay account")
    if position is not None and not (carry_policy == "carry_all" and position_policy == "carry"):
        raise ReplayExecutionError("open replay position is incompatible with the frozen phase carry policy")

    if carry_policy == "reset":
        balance = next_initial
        floating = Decimal("0")
        position = None
    elif carry_policy == "carry_balance":
        balance = snapshot.balance
        floating = Decimal("0")
        position = None
    else:
        balance = snapshot.balance
        floating = snapshot.floating_pl

    event = ReplayExecutionEvent(
        sequence=snapshot.event_sequence + 1,
        kind="phase_transition",
        replay_session_id=snapshot.replay_session_id,
        branch_id=snapshot.branch_id,
        dataset_id=snapshot.dataset_id,
        dataset_sha256=snapshot.dataset_sha256,
        cursor_index=snapshot.cursor_index,
        virtual_time_utc=virtual_time_utc,
        balance=balance,
        floating_pl=floating,
        equity=balance + floating,
        open_positions=1 if position is not None else 0,
        pending_orders=0,
        details={
            "intent_id": intent_id,
            "intent_fingerprint": intent_fingerprint,
            "from_phase_index": from_phase_index,
            "to_phase_index": to_phase_index,
            "carry_policy": carry_policy,
            "position_policy": position_policy,
            "next_phase_initial_balance": str(next_initial),
            "from_balance": str(snapshot.balance),
            "from_floating_pl": str(snapshot.floating_pl),
            "from_equity": str(snapshot.equity),
            "to_balance": str(balance),
            "to_floating_pl": str(floating),
            "to_equity": str(balance + floating),
            "open_position": position.model_dump(mode="json") if position is not None else None,
        },
    )
    ledger = [dict(item) for item in snapshot.ledger]
    ledger.append(event.model_dump(mode="json"))
    updated = snapshot.model_copy(
        update={
            "phase_index": to_phase_index,
            "phase_initial_balance": next_initial,
            "balance": balance,
            "floating_pl": floating,
            "equity": balance + floating,
            "event_sequence": event.sequence,
            "pending_market_order": None,
            "position": position,
            "ledger": ledger,
        }
    )
    return ReplayPhaseTransition(snapshot=updated, event=event)


def _liquidation_pnl(
    position: ReplayOpenPosition,
    *,
    exit_bid: Decimal,
    exit_ask: Decimal,
    instrument: InstrumentSpec,
    cost_model: CostModel,
) -> tuple[Decimal, dict]:
    cost = calculate_round_trip_cost(
        cost_model,
        position.side,
        position.quantity,
        instrument.contract_size,
        position.entry_bid,
        position.entry_ask,
        exit_bid,
        exit_ask,
    )
    return Decimal(str(cost["net_account"])), cost


def advance_replay_execution(
    snapshot: ReplayExecutionSnapshot,
    *,
    bar: dict,
    cursor_index: int,
) -> ReplayExecutionAdvance:
    """Advance exactly one immutable replay bar and produce canonical account state."""

    if cursor_index != snapshot.cursor_index + 1:
        raise ReplayExecutionError("execution cursor must advance exactly one bar")
    validate_ohlc_bar(bar)
    timestamp = int(bar["timestamp"])
    if timestamp < 0:
        raise ReplayExecutionError("bar timestamp must be nonnegative unix seconds")
    instrument = InstrumentSpec.from_mapping(snapshot.instrument_spec)
    cost_model = CostModel.from_mapping(snapshot.cost_model)
    spread = snapshot.spread_price
    timeframe_seconds = snapshot.timeframe_seconds
    ledger = [dict(item) for item in snapshot.ledger]
    balance = snapshot.balance
    position = snapshot.position
    pending = snapshot.pending_market_order
    opened_now = False
    had_position_exposure = position is not None
    events: list[ReplayExecutionEvent] = []
    next_sequence = snapshot.event_sequence

    def record_event(kind: Literal["market_fill", "protective_fill", "price_mark"], virtual_time_utc: int, details: dict) -> None:
        nonlocal next_sequence
        next_sequence += 1
        event = ReplayExecutionEvent(
            sequence=next_sequence,
            kind=kind,
            replay_session_id=snapshot.replay_session_id,
            branch_id=snapshot.branch_id,
            dataset_id=snapshot.dataset_id,
            dataset_sha256=snapshot.dataset_sha256,
            cursor_index=cursor_index,
            virtual_time_utc=virtual_time_utc,
            balance=balance,
            floating_pl=floating_for_state(),
            equity=balance + floating_for_state(),
            open_positions=1 if position is not None else 0,
            pending_orders=1 if pending is not None else 0,
            details=details,
        )
        events.append(event)
        ledger.append(event.model_dump(mode="json"))

    def floating_for_state(*, at_bid: Decimal | None = None, at_ask: Decimal | None = None) -> Decimal:
        if position is None:
            return Decimal("0")
        if at_bid is None or at_ask is None:
            at_bid, at_ask = quote_from_mid(
                bar["open"], spread_price=spread, tick_size=instrument.tick_size
            )
        value, _ = _liquidation_pnl(
            position,
            exit_bid=at_bid,
            exit_ask=at_ask,
            instrument=instrument,
            cost_model=cost_model,
        )
        return value

    if pending is not None:
        entry_bid, entry_ask = quote_from_mid(
            bar["open"], spread_price=spread, tick_size=instrument.tick_size
        )
        entry_fill = entry_ask if pending.side == "BUY" else entry_bid
        if pending.side == "BUY" and not pending.stop_loss < entry_fill < pending.take_profit:
            raise ReplayExecutionError("BUY bracket must satisfy stop < fill < take-profit")
        if pending.side == "SELL" and not pending.take_profit < entry_fill < pending.stop_loss:
            raise ReplayExecutionError("SELL bracket must satisfy take-profit < fill < stop")
        position = ReplayOpenPosition(
            position_id=f"replay-pos-{snapshot.event_sequence + 1}",
            source_operation_id=pending.operation_id,
            side=pending.side,
            quantity=pending.quantity,
            entry_bid=entry_bid,
            entry_ask=entry_ask,
            entry_fill=entry_fill,
            stop_loss=pending.stop_loss,
            take_profit=pending.take_profit,
            opened_cursor_index=cursor_index,
            opened_time_utc=timestamp,
        )
        pending = None
        had_position_exposure = True
        record_event(
            "market_fill",
            timestamp,
            {
                "operation_id": position.source_operation_id,
                "position_id": position.position_id,
                "side": position.side,
                "quantity": str(position.quantity),
                "fill_price": str(position.entry_fill),
            },
        )
        opened_now = True

    if position is not None:
        try:
            protective = protective_exit_for_bar(
                side=position.side,
                bar=bar,
                stop_loss=position.stop_loss,
                take_profit=position.take_profit,
                spread_price=spread,
                tick_size=instrument.tick_size,
                allow_open_gap=not opened_now,
            )
        except IntrabarAmbiguityError:
            raise
        if protective is not None:
            exit_price = protective["exit_price"]
            realized, cost = _liquidation_pnl(
                position,
                exit_bid=exit_price,
                exit_ask=exit_price,
                instrument=instrument,
                cost_model=cost_model,
            )
            balance += realized
            closed_position = position
            position = None
            fill_time = timestamp if protective["at_open"] else timestamp + timeframe_seconds
            record_event(
                "protective_fill",
                fill_time,
                {
                    "operation_id": closed_position.source_operation_id,
                    "position_id": closed_position.position_id,
                    "reason": protective["reason"],
                    "fill_price": str(exit_price),
                    "net_pnl": str(realized),
                    "cost_model_version": cost["cost_model_version"],
                },
            )

    floating = Decimal("0")
    if position is not None:
        close_bid, close_ask = quote_from_mid(
            bar["close"], spread_price=spread, tick_size=instrument.tick_size
        )
        floating, _ = _liquidation_pnl(
            position,
            exit_bid=close_bid,
            exit_ask=close_ask,
            instrument=instrument,
            cost_model=cost_model,
        )

    mark_time = timestamp + timeframe_seconds
    next_sequence += 1
    mark_event = ReplayExecutionEvent(
        sequence=next_sequence,
        kind="price_mark",
        replay_session_id=snapshot.replay_session_id,
        branch_id=snapshot.branch_id,
        dataset_id=snapshot.dataset_id,
        dataset_sha256=snapshot.dataset_sha256,
        cursor_index=cursor_index,
        virtual_time_utc=mark_time,
        balance=balance,
        floating_pl=floating,
        equity=balance + floating,
        open_positions=1 if position is not None else 0,
        pending_orders=1 if pending is not None else 0,
        details={
            "mid_close": str(_decimal(bar["close"], "close", positive=True)),
            "intrabar_equity_coverage": "insufficient" if had_position_exposure else "complete",
            "open_position": position.model_dump(mode="json") if position is not None else None,
            "pending_market_order": pending.model_dump(mode="json") if pending is not None else None,
        },
    )
    events.append(mark_event)
    ledger.append(mark_event.model_dump(mode="json"))

    return ReplayExecutionAdvance(
        snapshot=ReplayExecutionSnapshot(
            replay_session_id=snapshot.replay_session_id,
            branch_id=snapshot.branch_id,
            dataset_id=snapshot.dataset_id,
            dataset_sha256=snapshot.dataset_sha256,
            instrument_spec=snapshot.instrument_spec,
            cost_model=snapshot.cost_model,
            spread_price=snapshot.spread_price,
            timeframe_seconds=snapshot.timeframe_seconds,
            starting_balance=snapshot.starting_balance,
            phase_index=snapshot.phase_index,
            phase_initial_balance=snapshot.phase_initial_balance,
            balance=balance,
            floating_pl=floating,
            equity=balance + floating,
            cursor_index=cursor_index,
            event_sequence=next_sequence,
            pending_market_order=pending,
            position=position,
            ledger=ledger,
            evaluation_quality="full_for_declared_model",
        ),
        events=events,
    )
