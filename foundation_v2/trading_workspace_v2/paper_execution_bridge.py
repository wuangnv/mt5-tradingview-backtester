"""Pure bridge from offline paper accounting into execution receipts.

The paper account and execution-intent reducers intentionally have separate
responsibilities.  This module binds them for the offline paper adapter only:
one paper observation is applied to the account projection and projected into
the matching execution ledger as one append-only event.  It cannot handle a
live intent, create a broker request, or grant a capability.

Admission is intentionally upstream: the caller must evaluate the exact
``ExecutionIntent`` with ``AITradeMode``/``RiskBudget`` before creating the
ledger. The bridge preserves that intent, including ``capability_epoch``, but
does not re-evaluate or widen the capability contract. Expiry gates sending;
an observation after expiry may settle only an already in-flight ledger whose
``send_started`` event was accepted before expiry.

Paper receipts report *delta* fill quantities while execution receipts report
cumulative filled and remaining quantities.  The bridge derives the latter
from the post-application paper intent record, so retries cannot accidentally
double-count a partial fill.
"""

from __future__ import annotations

import hashlib
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .execution_intent_contract import (
    ExecutionEvent,
    ExecutionLedger,
    ExecutionReceipt,
    apply_execution_event,
)
from .paper_accounting import (
    PaperAccountState,
    PaperAccountingError,
    PaperFillReceipt,
    PaperOrderIntent,
    apply_paper_receipt,
)


PAPER_BRIDGE_SCHEMA = "paper-execution-bridge-v1"


class PaperExecutionBridgeError(ValueError):
    """Raised when paper and execution projections cannot be bound safely."""


class PaperExecutionProjection(BaseModel):
    """Atomic result of one paper observation across both local reducers."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["paper-execution-bridge-v1"] = PAPER_BRIDGE_SCHEMA
    account_state: PaperAccountState
    execution_ledger: ExecutionLedger
    execution_event: ExecutionEvent
    execution_receipt: ExecutionReceipt | None = None
    paper_receipt_fingerprint: str = Field(min_length=8, max_length=128)

    @model_validator(mode="after")
    def validate_projection_binding(self) -> "PaperExecutionProjection":
        event = self.execution_event
        if event not in self.execution_ledger.events:
            raise ValueError("execution_event is not present in execution_ledger")
        if event.intent_id != self.execution_ledger.intent.intent_id:
            raise ValueError("execution_event intent_id does not match execution_ledger")
        if event.intent_fingerprint != self.execution_ledger.intent_fingerprint:
            raise ValueError("execution_event fingerprint does not match execution_ledger")
        if event.evidence_hash != self.paper_receipt_fingerprint:
            raise ValueError("execution_event evidence does not match paper receipt fingerprint")
        if self.account_state.account_id != self.execution_ledger.intent.account_id:
            raise ValueError("account state scope does not match execution ledger")
        if event.event_type == "receipt_observed":
            if event.receipt is None or self.execution_receipt is None:
                raise ValueError("receipt_observed projection requires an execution receipt")
            if event.receipt != self.execution_receipt:
                raise ValueError("execution receipt does not match execution event receipt")
            if self.execution_receipt.intent_fingerprint != self.execution_ledger.intent_fingerprint:
                raise ValueError("execution receipt fingerprint does not match execution ledger")
        elif event.event_type == "send_unknown":
            if event.receipt is not None or self.execution_receipt is not None:
                raise ValueError("send_unknown projection cannot carry an execution receipt")
        else:
            raise ValueError("unsupported event type in paper execution projection")
        return self


def _stable_event_id(receipt_id: str) -> str:
    """Keep the deterministic retry key within the execution-event limit."""

    digest = hashlib.sha256(receipt_id.encode("utf-8")).hexdigest()[:32]
    return f"paper-receipt:{digest}"


def _validate_binding(
    ledger: ExecutionLedger,
    state: PaperAccountState,
    intent: PaperOrderIntent,
    receipt: PaperFillReceipt,
) -> None:
    execution_intent = ledger.intent
    if execution_intent.mode != "paper":
        raise PaperExecutionBridgeError("paper_bridge_requires_paper_execution_mode")
    if state.account_id != intent.account_id or state.account_id != execution_intent.account_id:
        raise PaperExecutionBridgeError("account_scope_mismatch")
    if intent.intent_id != execution_intent.intent_id or receipt.intent_id != intent.intent_id:
        raise PaperExecutionBridgeError("intent_id_mismatch")
    if intent.account_id != receipt.account_id or execution_intent.account_id != receipt.account_id:
        raise PaperExecutionBridgeError("receipt_account_scope_mismatch")
    if intent.symbol != execution_intent.symbol or intent.symbol != receipt.symbol:
        raise PaperExecutionBridgeError("symbol_scope_mismatch")
    if execution_intent.action not in {"open", "close"}:
        raise PaperExecutionBridgeError("paper_bridge_action_not_supported")
    if intent.side != ("buy" if execution_intent.action == "open" else "sell"):
        raise PaperExecutionBridgeError("side_action_mismatch")
    if execution_intent.quantity != intent.quantity:
        raise PaperExecutionBridgeError("intent_quantity_mismatch")
    if execution_intent.risk_budget_hash != intent.risk_budget_hash:
        raise PaperExecutionBridgeError("risk_budget_hash_mismatch")
    if (
        execution_intent.strategy_id != intent.strategy_id
        or execution_intent.strategy_version != intent.strategy_version
    ):
        raise PaperExecutionBridgeError("strategy_identity_mismatch")
    if (
        execution_intent.created_at_utc != intent.created_at_utc
        or execution_intent.expires_at_utc != intent.expires_at_utc
    ):
        raise PaperExecutionBridgeError("intent_time_window_mismatch")
    if receipt.intent_fingerprint != intent.fingerprint():
        raise PaperExecutionBridgeError("paper_intent_fingerprint_mismatch")


def _record_for_intent(state: PaperAccountState, intent_id: str):
    for record in state.intents:
        if record.intent_id == intent_id:
            return record
    raise PaperExecutionBridgeError("paper_intent_record_missing")


def _existing_projection(
    ledger: ExecutionLedger,
    state: PaperAccountState,
    receipt: PaperFillReceipt,
) -> PaperExecutionProjection | None:
    """Return a prior bridge result when the exact paper receipt was replayed."""

    if receipt.receipt_id not in state.applied_receipt_ids:
        return None
    entry = next(item for item in state.entries if item.receipt_id == receipt.receipt_id)
    if entry.receipt_fingerprint != receipt.fingerprint():
        raise PaperExecutionBridgeError("receipt_id_reused_with_different_content")
    linked = [event for event in ledger.events if event.evidence_hash == receipt.fingerprint()]
    if len(linked) != 1:
        raise PaperExecutionBridgeError("paper_receipt_missing_execution_event")
    event = linked[0]
    execution_receipt = event.receipt
    return PaperExecutionProjection(
        account_state=state,
        execution_ledger=ledger,
        execution_event=event,
        execution_receipt=execution_receipt,
        paper_receipt_fingerprint=receipt.fingerprint(),
    )


def apply_paper_observation(
    ledger: ExecutionLedger,
    state: PaperAccountState,
    intent: PaperOrderIntent,
    receipt: PaperFillReceipt,
    *,
    event_id: str | None = None,
    actor: str = "paper-bridge",
    reason: str = "paper receipt projected into execution ledger",
) -> PaperExecutionProjection:
    """Apply one paper receipt atomically to accounting and execution ledgers.

    ``event_id`` defaults to a stable receipt-derived identifier, making a
    retry of the same receipt idempotent across both projections.  The caller
    receives both updated immutable states and must persist them together.
    """

    _validate_binding(ledger, state, intent, receipt)
    stable_event_id = event_id or _stable_event_id(receipt.receipt_id)
    prior = _existing_projection(ledger, state, receipt)
    if prior is not None:
        return prior
    if receipt.source == "reconciliation" and intent.intent_id not in state.pending_unknown_intent_ids:
        raise PaperExecutionBridgeError("reconciliation_requires_pending_unknown")
    if ledger.status == "prepared":
        raise PaperExecutionBridgeError("paper_receipt_requires_send_started")

    try:
        next_state = apply_paper_receipt(state, intent, receipt)
    except PaperAccountingError as exc:
        raise PaperExecutionBridgeError(str(exc)) from exc

    event_at = receipt.observed_at_utc
    execution_receipt: ExecutionReceipt | None = None
    if receipt.status == "unknown":
        if ledger.status != "sending":
            raise PaperExecutionBridgeError("unknown_receipt_requires_sending_ledger")
        event_type = "send_unknown"
    else:
        if receipt.source == "reconciliation" and ledger.status != "unknown":
            raise PaperExecutionBridgeError("reconciliation_receipt_requires_unknown_ledger")
        record = _record_for_intent(next_state, intent.intent_id)
        remaining = intent.quantity - record.filled_quantity
        if receipt.status == "partial" and remaining <= 0:
            raise PaperExecutionBridgeError("partial_receipt_has_no_remaining_quantity")
        execution_receipt = ExecutionReceipt(
            intent_id=ledger.intent.intent_id,
            intent_fingerprint=ledger.intent_fingerprint,
            account_id=ledger.intent.account_id,
            mode="paper",
            symbol=ledger.intent.symbol,
            status=receipt.status,
            filled_quantity=record.filled_quantity,
            remaining_quantity=remaining,
            evidence_hash=receipt.evidence_hash,
            source=receipt.source,
            observed_at_utc=receipt.observed_at_utc,
        )
        event_type = "receipt_observed"

    event = ExecutionEvent(
        event_id=stable_event_id,
        sequence=ledger.event_sequence + 1,
        intent_id=ledger.intent.intent_id,
        intent_fingerprint=ledger.intent_fingerprint,
        event_type=event_type,
        actor=actor,
        reason=reason,
        at_utc=event_at,
        receipt=execution_receipt,
        evidence_hash=receipt.fingerprint(),
    )
    try:
        next_ledger = apply_execution_event(ledger, event)
    except ValueError as exc:
        raise PaperExecutionBridgeError(str(exc)) from exc
    return PaperExecutionProjection(
        account_state=next_state,
        execution_ledger=next_ledger,
        execution_event=event,
        execution_receipt=execution_receipt,
        paper_receipt_fingerprint=receipt.fingerprint(),
    )


__all__ = [
    "PAPER_BRIDGE_SCHEMA",
    "PaperExecutionBridgeError",
    "PaperExecutionProjection",
    "apply_paper_observation",
]
