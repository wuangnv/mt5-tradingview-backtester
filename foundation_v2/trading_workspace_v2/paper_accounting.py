"""Deterministic paper-account accounting and reconciliation contracts.

This module is deliberately local and side-effect free.  It projects explicit
paper fill observations into cash and long-only spot positions.  It does not
import a broker, provider, transport, clock service, or database.  An unknown
receipt never changes financial state; only a later reconciliation receipt may
settle it.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


PAPER_INTENT_SCHEMA = "paper-order-intent-v1"
PAPER_RECEIPT_SCHEMA = "paper-fill-receipt-v1"
PAPER_ACCOUNT_SCHEMA = "paper-account-state-v1"
PAPER_ENTRY_SCHEMA = "paper-ledger-entry-v1"
PAPER_RECONCILIATION_SCHEMA = "paper-reconciliation-receipt-v1"

PaperSide = Literal["buy", "sell"]
PaperReceiptStatus = Literal["partial", "filled", "rejected", "unknown"]
PaperReceiptSource = Literal["adapter_response", "reconciliation"]


class PaperAccountingError(ValueError):
    """Raised when a paper accounting event is unsafe or inconsistent."""


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime, field_name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must include a timezone")
    return value


def _fingerprint(value: BaseModel) -> str:
    payload = json.dumps(
        value.model_dump(mode="json"),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(payload).hexdigest()


class PaperOrderIntent(BaseModel):
    """Immutable long-only spot intent used by the offline paper adapter."""

    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    schema_version: Literal["paper-order-intent-v1"] = PAPER_INTENT_SCHEMA
    intent_id: str = Field(min_length=1, max_length=128)
    account_id: str = Field(min_length=1, max_length=128)
    symbol: str = Field(min_length=1, max_length=64)
    side: PaperSide
    quantity: Decimal = Field(gt=0)
    strategy_id: str | None = Field(default=None, min_length=1, max_length=128)
    strategy_version: str | None = Field(default=None, min_length=1, max_length=128)
    risk_budget_hash: str = Field(min_length=1, max_length=128)
    created_at_utc: datetime = Field(default_factory=_utc_now)
    expires_at_utc: datetime

    @model_validator(mode="after")
    def validate_intent(self) -> PaperOrderIntent:
        _aware(self.created_at_utc, "created_at_utc")
        _aware(self.expires_at_utc, "expires_at_utc")
        if self.expires_at_utc <= self.created_at_utc:
            raise ValueError("expires_at_utc must be after created_at_utc")
        if (self.strategy_id is None) != (self.strategy_version is None):
            raise ValueError("strategy_id and strategy_version must be provided together")
        return self

    def fingerprint(self) -> str:
        """Hash immutable intent content; receipt/status is outside the hash."""

        return _fingerprint(self)


class PaperFillReceipt(BaseModel):
    """One adapter or reconciliation observation.

    ``filled_quantity`` is a delta for this receipt, not a cumulative total.
    This makes partial-fill and out-of-order handling explicit and prevents a
    retry from silently applying the same cumulative quantity twice.
    """

    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    schema_version: Literal["paper-fill-receipt-v1"] = PAPER_RECEIPT_SCHEMA
    receipt_id: str = Field(min_length=1, max_length=128)
    intent_id: str = Field(min_length=1, max_length=128)
    intent_fingerprint: str = Field(min_length=8, max_length=128)
    account_id: str = Field(min_length=1, max_length=128)
    symbol: str = Field(min_length=1, max_length=64)
    side: PaperSide
    status: PaperReceiptStatus
    filled_quantity: Decimal = Field(default=Decimal("0"), ge=0)
    fill_price: Decimal | None = Field(default=None, gt=0)
    fee: Decimal = Field(default=Decimal("0"), ge=0)
    source: PaperReceiptSource
    evidence_hash: str = Field(min_length=8, max_length=128)
    observed_at_utc: datetime = Field(default_factory=_utc_now)

    @model_validator(mode="after")
    def validate_receipt(self) -> PaperFillReceipt:
        _aware(self.observed_at_utc, "observed_at_utc")
        if self.status in {"partial", "filled"}:
            if self.filled_quantity <= 0:
                raise ValueError(f"{self.status} receipt requires positive filled_quantity")
            if self.fill_price is None:
                raise ValueError(f"{self.status} receipt requires fill_price")
        elif self.status in {"rejected", "unknown"}:
            if self.filled_quantity != 0:
                raise ValueError(f"{self.status} receipt cannot report a fill")
            if self.fill_price is not None:
                raise ValueError(f"{self.status} receipt cannot report fill_price")
            if self.fee != 0:
                raise ValueError(f"{self.status} receipt cannot report a fee")
        if self.status == "unknown" and self.source != "adapter_response":
            raise ValueError("unknown receipt must originate from adapter_response")
        if self.source == "reconciliation" and self.status == "rejected":
            raise ValueError("reconciliation may settle an unknown only with a fill")
        return self

    def fingerprint(self) -> str:
        return _fingerprint(self)


class PaperPosition(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    symbol: str = Field(min_length=1, max_length=64)
    quantity: Decimal = Field(gt=0)
    average_cost: Decimal = Field(gt=0)


class PaperIntentRecord(BaseModel):
    """Durable identity and cumulative fill projection for one intent."""

    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    intent_id: str = Field(min_length=1, max_length=128)
    intent_fingerprint: str = Field(min_length=8, max_length=128)
    account_id: str = Field(min_length=1, max_length=128)
    symbol: str = Field(min_length=1, max_length=64)
    side: PaperSide
    requested_quantity: Decimal = Field(gt=0)
    filled_quantity: Decimal = Field(default=Decimal("0"), ge=0)
    terminal_status: Literal["open", "rejected", "filled"] = "open"

    @model_validator(mode="after")
    def validate_fill_total(self) -> PaperIntentRecord:
        if self.filled_quantity > self.requested_quantity:
            raise ValueError("filled_quantity cannot exceed requested_quantity")
        if self.terminal_status == "filled" and self.filled_quantity != self.requested_quantity:
            raise ValueError("filled intent must have complete filled_quantity")
        if self.terminal_status == "rejected" and self.filled_quantity != 0:
            raise ValueError("rejected intent cannot retain a fill")
        return self


class PaperLedgerEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    schema_version: Literal["paper-ledger-entry-v1"] = PAPER_ENTRY_SCHEMA
    sequence: int = Field(ge=1, strict=True)
    receipt_id: str = Field(min_length=1, max_length=128)
    receipt_fingerprint: str = Field(min_length=8, max_length=128)
    intent_id: str = Field(min_length=1, max_length=128)
    symbol: str = Field(min_length=1, max_length=64)
    side: PaperSide
    status: PaperReceiptStatus
    quantity: Decimal = Field(default=Decimal("0"), ge=0)
    price: Decimal | None = Field(default=None, gt=0)
    fee: Decimal = Field(default=Decimal("0"), ge=0)
    cash_delta: Decimal = Decimal("0")
    observed_at_utc: datetime

    @model_validator(mode="after")
    def validate_entry(self) -> PaperLedgerEntry:
        _aware(self.observed_at_utc, "observed_at_utc")
        if self.status in {"partial", "filled"} and (self.quantity <= 0 or self.price is None):
            raise ValueError("filled ledger entries require quantity and price")
        if self.status in {"rejected", "unknown"} and (self.quantity != 0 or self.price is not None):
            raise ValueError("rejected/unknown ledger entries cannot contain fills")
        return self


class PaperAccountState(BaseModel):
    """Immutable account projection suitable for atomic snapshot/restart."""

    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    schema_version: Literal["paper-account-state-v1"] = PAPER_ACCOUNT_SCHEMA
    account_id: str = Field(min_length=1, max_length=128)
    cash: Decimal = Field(ge=0)
    positions: tuple[PaperPosition, ...] = ()
    intents: tuple[PaperIntentRecord, ...] = ()
    entries: tuple[PaperLedgerEntry, ...] = ()
    applied_receipt_ids: tuple[str, ...] = ()
    pending_unknown_intent_ids: tuple[str, ...] = ()
    sequence: int = Field(default=0, ge=0, strict=True)
    execution_capability: Literal[False] = False
    updated_at_utc: datetime = Field(default_factory=_utc_now)

    @model_validator(mode="after")
    def validate_state(self) -> PaperAccountState:
        _aware(self.updated_at_utc, "updated_at_utc")
        symbols = [position.symbol for position in self.positions]
        if symbols != sorted(symbols) or len(symbols) != len(set(symbols)):
            raise ValueError("positions must be sorted uniquely by symbol")
        intent_ids = [item.intent_id for item in self.intents]
        if intent_ids != sorted(intent_ids) or len(intent_ids) != len(set(intent_ids)):
            raise ValueError("intents must be sorted uniquely by intent_id")
        if self.sequence != len(self.entries):
            raise ValueError("sequence must equal ledger entry count")
        if len(self.applied_receipt_ids) != len(set(self.applied_receipt_ids)):
            raise ValueError("applied_receipt_ids must be unique")
        entry_receipts = [entry.receipt_id for entry in self.entries]
        if entry_receipts != list(self.applied_receipt_ids):
            raise ValueError("entry receipt IDs must match applied receipt IDs")
        if [entry.sequence for entry in self.entries] != list(range(1, len(self.entries) + 1)):
            raise ValueError("ledger entry sequence must be contiguous")
        if any(
            self.entries[index].observed_at_utc < self.entries[index - 1].observed_at_utc
            for index in range(1, len(self.entries))
        ):
            raise ValueError("ledger entries must be chronological")
        if len(self.pending_unknown_intent_ids) != len(set(self.pending_unknown_intent_ids)):
            raise ValueError("pending_unknown_intent_ids must be unique")
        if any(item.intent_id in self.pending_unknown_intent_ids for item in self.intents if item.terminal_status != "open"):
            raise ValueError("terminal intents cannot remain pending unknown")
        return self


class PaperReconciliationReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    schema_version: Literal["paper-reconciliation-receipt-v1"] = PAPER_RECONCILIATION_SCHEMA
    account_id: str = Field(min_length=1, max_length=128)
    result: Literal["matched", "mismatch"]
    expected_cash: Decimal = Field(ge=0)
    observed_cash: Decimal = Field(ge=0)
    expected_positions: tuple[PaperPosition, ...] = ()
    observed_positions: tuple[PaperPosition, ...] = ()
    mismatches: tuple[str, ...] = ()
    checked_at_utc: datetime = Field(default_factory=_utc_now)
    execution_capability: Literal[False] = False

    @model_validator(mode="after")
    def validate_reconciliation(self) -> PaperReconciliationReceipt:
        _aware(self.checked_at_utc, "checked_at_utc")
        for label, values in (("expected_positions", self.expected_positions), ("observed_positions", self.observed_positions)):
            symbols = [position.symbol for position in values]
            if len(symbols) != len(set(symbols)):
                raise ValueError(f"{label} must not contain duplicate symbols")
        if self.result == "matched" and self.mismatches:
            raise ValueError("matched reconciliation cannot contain mismatches")
        if self.result == "mismatch" and not self.mismatches:
            raise ValueError("mismatch reconciliation requires mismatch details")
        return self


def _position_map(state: PaperAccountState) -> dict[str, PaperPosition]:
    return {item.symbol: item for item in state.positions}


def _intent_map(state: PaperAccountState) -> dict[str, PaperIntentRecord]:
    return {item.intent_id: item for item in state.intents}


def _canonical_positions(values: dict[str, PaperPosition]) -> tuple[PaperPosition, ...]:
    return tuple(values[symbol] for symbol in sorted(values))


def _replace_intent(
    state: PaperAccountState,
    updated: PaperIntentRecord,
) -> tuple[PaperIntentRecord, ...]:
    values = _intent_map(state)
    values[updated.intent_id] = updated
    return tuple(values[key] for key in sorted(values))


def _with_pending_unknown(state: PaperAccountState, intent_id: str) -> tuple[str, ...]:
    return tuple(sorted(set(state.pending_unknown_intent_ids) | {intent_id}))


def _without_pending_unknown(state: PaperAccountState, intent_id: str) -> tuple[str, ...]:
    return tuple(item for item in state.pending_unknown_intent_ids if item != intent_id)


def apply_paper_receipt(
    state: PaperAccountState,
    intent: PaperOrderIntent,
    receipt: PaperFillReceipt,
) -> PaperAccountState:
    """Apply exactly one receipt, preserving idempotency and unknown safety."""

    if state.account_id != intent.account_id or receipt.account_id != intent.account_id:
        raise PaperAccountingError("account_scope_mismatch")
    if receipt.intent_id != intent.intent_id:
        raise PaperAccountingError("receipt_intent_id_mismatch")
    if receipt.intent_fingerprint != intent.fingerprint():
        raise PaperAccountingError("receipt_intent_fingerprint_mismatch")
    if receipt.symbol != intent.symbol or receipt.side != intent.side:
        raise PaperAccountingError("receipt_instrument_scope_mismatch")
    if receipt.observed_at_utc < intent.created_at_utc:
        raise PaperAccountingError("receipt_predates_intent")
    if state.entries and receipt.observed_at_utc < state.updated_at_utc:
        raise PaperAccountingError("stale_paper_receipt")
    if receipt.source == "reconciliation" and intent.intent_id not in _intent_map(state):
        raise PaperAccountingError("reconciliation_requires_prepared_intent")
    if receipt.receipt_id in state.applied_receipt_ids:
        previous = next(entry for entry in state.entries if entry.receipt_id == receipt.receipt_id)
        if previous.receipt_fingerprint != receipt.fingerprint():
            raise PaperAccountingError("receipt_id_reused_with_different_content")
        return state

    intent_values = _intent_map(state)
    existing = intent_values.get(intent.intent_id)
    fingerprint = intent.fingerprint()
    if existing is not None:
        if existing.intent_fingerprint != fingerprint:
            raise PaperAccountingError("intent_id_reused_with_different_content")
        if existing.terminal_status != "open":
            raise PaperAccountingError("terminal_intent_cannot_receive_new_receipt")
        if intent.quantity != existing.requested_quantity:
            raise PaperAccountingError("intent_quantity_changed")
    else:
        existing = PaperIntentRecord(
            intent_id=intent.intent_id,
            intent_fingerprint=fingerprint,
            account_id=intent.account_id,
            symbol=intent.symbol,
            side=intent.side,
            requested_quantity=intent.quantity,
        )

    if receipt.source == "adapter_response" and intent.intent_id in state.pending_unknown_intent_ids:
        raise PaperAccountingError("unknown_intent_requires_reconciliation")

    positions = _position_map(state)
    cash = state.cash
    filled_total = existing.filled_quantity
    terminal_status: Literal["open", "rejected", "filled"] = existing.terminal_status
    quantity = receipt.filled_quantity
    cash_delta = Decimal("0")

    if receipt.status in {"partial", "filled"}:
        assert receipt.fill_price is not None
        filled_total += quantity
        if filled_total > intent.quantity:
            raise PaperAccountingError("cumulative_fill_exceeds_intent")
        if receipt.status == "filled" and filled_total != intent.quantity:
            raise PaperAccountingError("filled_receipt_does_not_complete_intent")
        if receipt.status == "partial" and filled_total >= intent.quantity:
            raise PaperAccountingError("partial_receipt_must_leave_quantity")
        notional = quantity * receipt.fill_price
        cash_delta = notional + receipt.fee if intent.side == "buy" else -(notional - receipt.fee)
        if intent.side == "buy":
            if cash < cash_delta:
                raise PaperAccountingError("insufficient_cash")
            current = positions.get(intent.symbol)
            if current is None:
                positions[intent.symbol] = PaperPosition(
                    symbol=intent.symbol,
                    quantity=quantity,
                    average_cost=receipt.fill_price,
                )
            else:
                total_quantity = current.quantity + quantity
                average_cost = (
                    current.quantity * current.average_cost + quantity * receipt.fill_price
                ) / total_quantity
                positions[intent.symbol] = PaperPosition(
                    symbol=intent.symbol,
                    quantity=total_quantity,
                    average_cost=average_cost,
                )
            cash -= cash_delta
        else:
            current = positions.get(intent.symbol)
            if current is None or current.quantity < quantity:
                raise PaperAccountingError("insufficient_position")
            if cash + notional - receipt.fee < 0:
                raise PaperAccountingError("insufficient_cash_for_fee")
            remaining = current.quantity - quantity
            if remaining == 0:
                del positions[intent.symbol]
            else:
                positions[intent.symbol] = current.model_copy(update={"quantity": remaining})
            cash += -(cash_delta)
        if receipt.status == "filled":
            terminal_status = "filled"
    elif receipt.status == "rejected":
        if existing.filled_quantity != 0:
            raise PaperAccountingError("partially_filled_intent_cannot_be_rejected")
        terminal_status = "rejected"
    elif receipt.status == "unknown":
        # Unknown is durable evidence of uncertainty, never a fill or a reject.
        pass

    updated_intent = existing.model_copy(
        update={"filled_quantity": filled_total, "terminal_status": terminal_status}
    )
    entry = PaperLedgerEntry(
        sequence=state.sequence + 1,
        receipt_id=receipt.receipt_id,
        receipt_fingerprint=receipt.fingerprint(),
        intent_id=intent.intent_id,
        symbol=intent.symbol,
        side=intent.side,
        status=receipt.status,
        quantity=quantity,
        price=receipt.fill_price,
        fee=receipt.fee,
        cash_delta=-cash_delta if receipt.status in {"partial", "filled"} else Decimal("0"),
        observed_at_utc=receipt.observed_at_utc,
    )
    pending = (
        _with_pending_unknown(state, intent.intent_id)
        if receipt.status == "unknown"
        else _without_pending_unknown(state, intent.intent_id)
    )
    return state.model_copy(
        update={
            "cash": cash,
            "positions": _canonical_positions(positions),
            "intents": _replace_intent(state, updated_intent),
            "entries": state.entries + (entry,),
            "applied_receipt_ids": state.applied_receipt_ids + (receipt.receipt_id,),
            "pending_unknown_intent_ids": pending,
            "sequence": state.sequence + 1,
            "updated_at_utc": receipt.observed_at_utc,
        }
    )


def reconcile_paper_account(
    state: PaperAccountState,
    *,
    observed_cash: Decimal,
    observed_positions: tuple[PaperPosition, ...] = (),
    checked_at_utc: datetime | None = None,
) -> PaperReconciliationReceipt:
    """Compare an observed paper snapshot without mutating the account."""

    expected = {item.symbol: item for item in state.positions}
    observed = {item.symbol: item for item in observed_positions}
    mismatches: list[str] = []
    if observed_cash != state.cash:
        mismatches.append("cash_mismatch")
    if set(expected) != set(observed):
        mismatches.append("position_symbols_mismatch")
    for symbol in sorted(set(expected) & set(observed)):
        if expected[symbol].quantity != observed[symbol].quantity:
            mismatches.append(f"{symbol}.quantity_mismatch")
        if expected[symbol].average_cost != observed[symbol].average_cost:
            mismatches.append(f"{symbol}.average_cost_mismatch")
    return PaperReconciliationReceipt(
        account_id=state.account_id,
        result="matched" if not mismatches else "mismatch",
        expected_cash=state.cash,
        observed_cash=observed_cash,
        expected_positions=state.positions,
        observed_positions=tuple(observed_positions),
        mismatches=tuple(mismatches),
        checked_at_utc=checked_at_utc or _utc_now(),
    )


class FakePaperAdapter:
    """Deterministic in-memory adapter used only by offline tests."""

    def __init__(self) -> None:
        self._receipts: dict[str, PaperFillReceipt] = {}

    def submit(
        self,
        intent: PaperOrderIntent,
        *,
        status: PaperReceiptStatus = "filled",
        fill_price: Decimal | None = None,
        filled_quantity: Decimal | None = None,
        fee: Decimal = Decimal("0"),
        observed_at_utc: datetime | None = None,
    ) -> PaperFillReceipt:
        """Return the same receipt for duplicate intent submissions."""

        if intent.intent_id in self._receipts:
            prior = self._receipts[intent.intent_id]
            if prior.intent_fingerprint != intent.fingerprint():
                raise PaperAccountingError("intent_id_reused_with_different_content")
            return prior
        quantity = (
            intent.quantity
            if status == "filled" and filled_quantity is None
            else Decimal("0") if status in {"unknown", "rejected"} else filled_quantity
        )
        if quantity is None:
            raise PaperAccountingError("filled_quantity_required")
        receipt_id = "paper-" + hashlib.sha256(intent.fingerprint().encode("ascii")).hexdigest()[:24]
        receipt = PaperFillReceipt(
            receipt_id=receipt_id,
            intent_id=intent.intent_id,
            intent_fingerprint=intent.fingerprint(),
            account_id=intent.account_id,
            symbol=intent.symbol,
            side=intent.side,
            status=status,
            filled_quantity=quantity,
            fill_price=fill_price,
            fee=fee,
            source="adapter_response",
            evidence_hash=receipt_id,
            observed_at_utc=observed_at_utc or intent.created_at_utc,
        )
        self._receipts[intent.intent_id] = receipt
        return receipt


__all__ = [
    "FakePaperAdapter",
    "PaperAccountState",
    "PaperAccountingError",
    "PaperFillReceipt",
    "PaperIntentRecord",
    "PaperLedgerEntry",
    "PaperOrderIntent",
    "PaperPosition",
    "PaperReconciliationReceipt",
    "apply_paper_receipt",
    "reconcile_paper_account",
]
