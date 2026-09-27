"""Pure execution-intent and reconciliation contracts for the foundation.

This module is a preparation seam only.  It does not import a broker, a
provider, a database, or a transport and it cannot send an order.  A future
adapter may use the reducer after it has acquired an explicit capability, but
an uncertain send is deliberately a one-way boundary: the only valid next
step is reconciliation or quarantine, never an automatic resend.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .risk_promotion_contracts import AITradeMode, RiskBudget


EXECUTION_INTENT_SCHEMA = "execution-intent-v1"
EXECUTION_EVENT_SCHEMA = "execution-event-v1"
EXECUTION_RECEIPT_SCHEMA = "execution-receipt-v1"
EXECUTION_LEDGER_SCHEMA = "execution-ledger-v1"
EXECUTION_DECISION_SCHEMA = "execution-decision-v1"

IntentAction = Literal["open", "close", "cancel", "modify"]
AdapterMode = Literal["paper", "live"]
ExecutionStatus = Literal[
    "prepared",
    "sending",
    "unknown",
    "accepted",
    "partial",
    "filled",
    "rejected",
    "canceled",
    "quarantined",
]
ReceiptStatus = Literal["accepted", "partial", "filled", "rejected", "canceled"]

_TERMINAL = frozenset({"filled", "rejected", "canceled", "quarantined"})
_ALLOWED_RECEIPTS: dict[str, frozenset[str]] = {
    "sending": frozenset({"accepted", "partial", "filled", "rejected", "canceled"}),
    "unknown": frozenset({"accepted", "partial", "filled", "rejected", "canceled"}),
    "accepted": frozenset({"accepted", "partial", "filled", "rejected", "canceled"}),
    "partial": frozenset({"partial", "filled", "canceled"}),
}


class ExecutionContractError(ValueError):
    """Raised when an immutable intent or ledger event is unsafe."""


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime, field_name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must include a timezone")
    return value


def _canonical_hash(value: dict) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


class ExecutionIntent(BaseModel):
    """Immutable, scoped request that may later be handed to an adapter."""

    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    schema_version: Literal["execution-intent-v1"] = EXECUTION_INTENT_SCHEMA
    intent_id: str = Field(min_length=1, max_length=128)
    account_id: str = Field(min_length=1, max_length=128)
    mode: AdapterMode
    symbol: str = Field(min_length=1, max_length=64)
    action: IntentAction
    quantity: Decimal | None = Field(default=None, gt=0)
    risk_budget_hash: str = Field(min_length=1, max_length=128)
    capability_epoch: str = Field(min_length=1, max_length=128)
    actor: str = Field(min_length=1, max_length=128)
    strategy_id: str | None = Field(default=None, min_length=1, max_length=128)
    strategy_version: str | None = Field(default=None, min_length=1, max_length=128)
    created_at_utc: datetime = Field(default_factory=_utc_now)
    expires_at_utc: datetime = Field()

    @model_validator(mode="after")
    def validate_intent(self) -> "ExecutionIntent":
        _aware(self.created_at_utc, "created_at_utc")
        _aware(self.expires_at_utc, "expires_at_utc")
        if self.expires_at_utc <= self.created_at_utc:
            raise ValueError("expires_at_utc must be after created_at_utc")
        if self.action in {"open", "close"} and self.quantity is None:
            raise ValueError(f"quantity is required for {self.action} intents")
        if (self.strategy_id is None) != (self.strategy_version is None):
            raise ValueError("strategy_id and strategy_version must be provided together")
        return self


def execution_intent_fingerprint(intent: ExecutionIntent) -> str:
    """Hash only immutable intent content; status/events are outside the hash."""

    return _canonical_hash(intent.model_dump(mode="json"))


class ExecutionReceipt(BaseModel):
    """An adapter/reconciliation observation bound to one exact intent."""

    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    schema_version: Literal["execution-receipt-v1"] = EXECUTION_RECEIPT_SCHEMA
    intent_id: str = Field(min_length=1, max_length=128)
    intent_fingerprint: str = Field(min_length=8, max_length=128)
    account_id: str = Field(min_length=1, max_length=128)
    mode: AdapterMode
    symbol: str = Field(min_length=1, max_length=64)
    status: ReceiptStatus
    filled_quantity: Decimal = Field(default=Decimal("0"), ge=0)
    remaining_quantity: Decimal = Field(default=Decimal("0"), ge=0)
    broker_order_id: str | None = Field(default=None, min_length=1, max_length=128)
    broker_position_id: str | None = Field(default=None, min_length=1, max_length=128)
    evidence_hash: str = Field(min_length=8, max_length=128)
    source: Literal["adapter_response", "reconciliation"]
    observed_at_utc: datetime = Field(default_factory=_utc_now)

    @model_validator(mode="after")
    def validate_receipt(self) -> "ExecutionReceipt":
        _aware(self.observed_at_utc, "observed_at_utc")
        if self.status == "accepted" and (self.filled_quantity != 0 or self.remaining_quantity <= 0):
            raise ValueError("accepted receipt must have zero filled and positive remaining quantity")
        if self.status == "partial" and (self.filled_quantity <= 0 or self.remaining_quantity <= 0):
            raise ValueError("partial receipt must have positive filled and remaining quantities")
        if self.status == "filled" and (self.filled_quantity <= 0 or self.remaining_quantity != 0):
            raise ValueError("filled receipt must have positive filled and zero remaining quantity")
        if self.status == "rejected" and self.filled_quantity != 0:
            raise ValueError("rejected receipt cannot report a fill")
        return self


class ExecutionEvent(BaseModel):
    """One append-only reducer input."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["execution-event-v1"] = EXECUTION_EVENT_SCHEMA
    event_id: str = Field(min_length=1, max_length=128)
    sequence: int = Field(ge=1, strict=True)
    intent_id: str = Field(min_length=1, max_length=128)
    intent_fingerprint: str = Field(min_length=8, max_length=128)
    event_type: Literal["send_started", "send_unknown", "receipt_observed", "quarantine"]
    actor: str = Field(min_length=1, max_length=128)
    reason: str = Field(min_length=1, max_length=2_000)
    at_utc: datetime = Field(default_factory=_utc_now)
    receipt: ExecutionReceipt | None = None
    evidence_hash: str | None = Field(default=None, min_length=8, max_length=128)

    @model_validator(mode="after")
    def validate_event(self) -> "ExecutionEvent":
        _aware(self.at_utc, "at_utc")
        if self.event_type == "receipt_observed" and self.receipt is None:
            raise ValueError("receipt_observed requires a receipt")
        if self.event_type != "receipt_observed" and self.receipt is not None:
            raise ValueError("only receipt_observed may carry a receipt")
        if self.event_type == "quarantine" and self.evidence_hash is None:
            raise ValueError("quarantine requires evidence_hash")
        return self


def execution_event_fingerprint(event: ExecutionEvent) -> str:
    return _canonical_hash(event.model_dump(mode="json"))


class ExecutionLedger(BaseModel):
    """Immutable projection of one intent and its append-only event stream."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["execution-ledger-v1"] = EXECUTION_LEDGER_SCHEMA
    intent: ExecutionIntent
    intent_fingerprint: str = Field(min_length=8, max_length=128)
    status: ExecutionStatus = "prepared"
    event_sequence: int = Field(default=0, ge=0, strict=True)
    events: tuple[ExecutionEvent, ...] = ()
    updated_at_utc: datetime = Field(default_factory=_utc_now)
    quarantine_reason: str | None = Field(default=None, max_length=2_000)

    @model_validator(mode="after")
    def validate_ledger(self) -> "ExecutionLedger":
        _aware(self.updated_at_utc, "updated_at_utc")
        if self.intent_fingerprint != execution_intent_fingerprint(self.intent):
            raise ValueError("intent_fingerprint does not match immutable intent")
        if self.event_sequence != len(self.events):
            raise ValueError("event_sequence must equal event count")
        projected_status: ExecutionStatus = "prepared"
        projected_updated_at = self.intent.created_at_utc
        for expected, event in enumerate(self.events, start=1):
            if event.sequence != expected:
                raise ValueError("execution event sequence is not contiguous")
            if event.intent_id != self.intent.intent_id or event.intent_fingerprint != self.intent_fingerprint:
                raise ValueError("execution event identity does not match intent")
            if event.at_utc < projected_updated_at:
                raise ValueError("execution events must be chronological")
            if event.event_type == "send_started" and event.at_utc >= self.intent.expires_at_utc:
                raise ValueError("send_started occurs after intent expiry")
            if event.event_type == "send_started":
                if projected_status != "prepared":
                    raise ValueError("send_started is invalid for the persisted ledger state")
                projected_status = "sending"
            elif event.event_type == "send_unknown":
                if projected_status != "sending":
                    raise ValueError("send_unknown is invalid for the persisted ledger state")
                projected_status = "unknown"
            elif event.event_type == "receipt_observed":
                projected = self.model_copy(
                    update={"status": projected_status, "updated_at_utc": projected_updated_at}
                )
                try:
                    projected_status = _receipt_status(projected, event)  # type: ignore[assignment]
                except ExecutionContractError as exc:
                    raise ValueError(str(exc)) from exc
            else:
                if projected_status not in {"sending", "unknown", "accepted", "partial"}:
                    raise ValueError("quarantine is invalid for the persisted ledger state")
                projected_status = "quarantined"
            projected_updated_at = event.at_utc
        if self.status != projected_status:
            raise ValueError("persisted ledger status does not match its event stream")
        if self.updated_at_utc != projected_updated_at:
            raise ValueError("persisted ledger timestamp does not match its event stream")
        if self.status == "quarantined" and not self.quarantine_reason:
            raise ValueError("quarantined ledger requires quarantine_reason")
        return self


def prepare_execution_intent(intent: ExecutionIntent) -> ExecutionLedger:
    """Create a durable-preparation projection without any side effect."""

    return ExecutionLedger(
        intent=intent,
        intent_fingerprint=execution_intent_fingerprint(intent),
        updated_at_utc=intent.created_at_utc,
    )


class ExecutionDecision(BaseModel):
    """Fail-closed capability/risk admission projection; never a send command."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["execution-decision-v1"] = EXECUTION_DECISION_SCHEMA
    intent_id: str = Field(min_length=1, max_length=128)
    decision: Literal["allow", "deny"] = "deny"
    blockers: tuple[str, ...] = ()
    evaluated_at_utc: datetime = Field(default_factory=_utc_now)

    @model_validator(mode="after")
    def validate_decision(self) -> "ExecutionDecision":
        _aware(self.evaluated_at_utc, "evaluated_at_utc")
        if self.decision == "allow" and self.blockers:
            raise ValueError("an allowed decision cannot contain blockers")
        if self.decision == "deny" and not self.blockers:
            raise ValueError("a denied decision must explain its blockers")
        if len(set(self.blockers)) != len(self.blockers):
            raise ValueError("blockers must be unique")
        return self


def evaluate_execution_intent(
    intent: ExecutionIntent,
    capability: AITradeMode,
    budget: RiskBudget | None,
    *,
    active_capability_epoch: str | None,
    now: datetime | None = None,
) -> ExecutionDecision:
    """Evaluate one exact request against current offline capability evidence."""

    now_value = _aware(now or _utc_now(), "now")
    blockers = list(
        capability.execution_blockers(
            adapter_mode=intent.mode,
            account_id=intent.account_id,
            symbol=intent.symbol,
            action=intent.action,
            budget=budget,
            now=now_value,
        )
    )
    if budget is None:
        blockers.append("risk_budget_missing")
    elif intent.risk_budget_hash != budget.config_hash:
        blockers.append("intent_risk_budget_hash_mismatch")
    if active_capability_epoch is None:
        blockers.append("capability_epoch_unknown")
    elif intent.capability_epoch != active_capability_epoch:
        blockers.append("capability_epoch_mismatch")
    if intent.expires_at_utc <= now_value:
        blockers.append("intent_expired")
    blockers = list(dict.fromkeys(blockers))
    return ExecutionDecision(
        intent_id=intent.intent_id,
        decision="deny" if blockers else "allow",
        blockers=tuple(blockers),
        evaluated_at_utc=now_value,
    )


def _receipt_status(ledger: ExecutionLedger, event: ExecutionEvent) -> str:
    assert event.receipt is not None
    receipt = event.receipt
    if receipt.observed_at_utc < ledger.updated_at_utc:
        raise ExecutionContractError("receipt observation is older than the ledger state")
    if receipt.observed_at_utc > event.at_utc:
        raise ExecutionContractError("receipt observation occurs after its event")
    if receipt.intent_id != ledger.intent.intent_id:
        raise ExecutionContractError("receipt intent_id does not match ledger")
    if receipt.intent_fingerprint != ledger.intent_fingerprint:
        raise ExecutionContractError("receipt intent_fingerprint does not match ledger")
    if receipt.account_id != ledger.intent.account_id:
        raise ExecutionContractError("receipt account scope does not match ledger")
    if receipt.mode != ledger.intent.mode or receipt.symbol != ledger.intent.symbol:
        raise ExecutionContractError("receipt instrument scope does not match ledger")
    if ledger.intent.quantity is not None:
        total = receipt.filled_quantity + receipt.remaining_quantity
        if total > ledger.intent.quantity:
            raise ExecutionContractError("receipt quantity exceeds immutable intent quantity")
        if receipt.status == "filled" and receipt.filled_quantity != ledger.intent.quantity:
            raise ExecutionContractError("filled receipt quantity does not match intent quantity")
        if receipt.status == "accepted" and receipt.remaining_quantity != ledger.intent.quantity:
            raise ExecutionContractError("accepted receipt remaining quantity does not match intent quantity")
    if ledger.status == "unknown" and receipt.source != "reconciliation":
        raise ExecutionContractError("unknown intent requires a reconciliation receipt")
    if receipt.status not in _ALLOWED_RECEIPTS.get(ledger.status, frozenset()):
        raise ExecutionContractError(f"receipt status {receipt.status} is invalid from {ledger.status}")
    return receipt.status


def apply_execution_event(ledger: ExecutionLedger, event: ExecutionEvent) -> ExecutionLedger:
    """Apply one event, rejecting stale, conflicting, or resend-shaped input."""

    for previous in ledger.events:
        if previous.event_id == event.event_id:
            if execution_event_fingerprint(previous) == execution_event_fingerprint(event):
                return ledger
            raise ExecutionContractError("event_id was already used with different content")
    if event.sequence != ledger.event_sequence + 1:
        raise ExecutionContractError("execution event sequence must advance exactly once")
    if event.intent_id != ledger.intent.intent_id or event.intent_fingerprint != ledger.intent_fingerprint:
        raise ExecutionContractError("event identity does not match ledger")
    if event.at_utc < ledger.updated_at_utc:
        raise ExecutionContractError("stale execution event")

    next_status: ExecutionStatus
    quarantine_reason = ledger.quarantine_reason
    if event.event_type == "send_started":
        if ledger.status != "prepared":
            raise ExecutionContractError("send_started is allowed only for a prepared intent")
        if event.at_utc >= ledger.intent.expires_at_utc:
            raise ExecutionContractError("send_started occurs after intent expiry")
        next_status = "sending"
    elif event.event_type == "send_unknown":
        if ledger.status != "sending":
            raise ExecutionContractError("send_unknown is allowed only after send_started")
        next_status = "unknown"
    elif event.event_type == "receipt_observed":
        next_status = _receipt_status(ledger, event)  # type: ignore[assignment]
    else:
        if ledger.status not in {"sending", "unknown", "accepted", "partial"}:
            raise ExecutionContractError("only unresolved execution may be quarantined")
        next_status = "quarantined"
        quarantine_reason = event.reason

    updated_events = ledger.events + (event,)
    return ledger.model_copy(
        update={
            "status": next_status,
            "event_sequence": event.sequence,
            "events": updated_events,
            "updated_at_utc": event.at_utc,
            "quarantine_reason": quarantine_reason,
        }
    )


def quarantine_execution(
    ledger: ExecutionLedger,
    *,
    event_id: str,
    actor: str,
    reason: str,
    evidence_hash: str,
    at_utc: datetime | None = None,
) -> ExecutionLedger:
    """Persist an explicit quarantine instead of silently discarding uncertainty."""

    event = ExecutionEvent(
        event_id=event_id,
        sequence=ledger.event_sequence + 1,
        intent_id=ledger.intent.intent_id,
        intent_fingerprint=ledger.intent_fingerprint,
        event_type="quarantine",
        actor=actor,
        reason=reason,
        evidence_hash=evidence_hash,
        at_utc=at_utc or _utc_now(),
    )
    return apply_execution_event(ledger, event)
