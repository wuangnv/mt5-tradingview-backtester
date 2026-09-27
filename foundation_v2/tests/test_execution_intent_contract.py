from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from pydantic import ValidationError

from trading_workspace_v2.execution_intent_contract import (
    ExecutionContractError,
    ExecutionEvent,
    ExecutionReceipt,
    ExecutionIntent,
    apply_execution_event,
    evaluate_execution_intent,
    execution_intent_fingerprint,
    prepare_execution_intent,
    quarantine_execution,
)
from trading_workspace_v2.risk_promotion_contracts import AITradeMode, RiskBudget


UTC = timezone.utc
BASE_TIME = datetime(2026, 9, 28, 12, 0, tzinfo=UTC)


def intent(**overrides) -> ExecutionIntent:
    payload = {
        "intent_id": "intent-1",
        "account_id": "paper-account",
        "mode": "paper",
        "symbol": "TEST",
        "action": "open",
        "quantity": Decimal("2"),
        "risk_budget_hash": "budget-v1",
        "capability_epoch": "epoch-1",
        "actor": "offline-test",
        "created_at_utc": BASE_TIME,
        "expires_at_utc": BASE_TIME + timedelta(minutes=10),
    }
    payload.update(overrides)
    return ExecutionIntent(**payload)


def event(ledger, event_type, *, event_id="event-1", at=None, receipt=None, reason="fixture"):
    return ExecutionEvent(
        event_id=event_id,
        sequence=ledger.event_sequence + 1,
        intent_id=ledger.intent.intent_id,
        intent_fingerprint=ledger.intent_fingerprint,
        event_type=event_type,
        actor="offline-test",
        reason=reason,
        at_utc=at or BASE_TIME,
        receipt=receipt,
        evidence_hash="sha256:evidence" if event_type == "quarantine" else None,
    )


def receipt(ledger, status, *, source="adapter_response", filled="0", remaining="2", observed=None):
    return ExecutionReceipt(
        intent_id=ledger.intent.intent_id,
        intent_fingerprint=ledger.intent_fingerprint,
        account_id=ledger.intent.account_id,
        mode=ledger.intent.mode,
        symbol=ledger.intent.symbol,
        status=status,
        filled_quantity=Decimal(filled),
        remaining_quantity=Decimal(remaining),
        evidence_hash="sha256:receipt",
        source=source,
        observed_at_utc=observed or BASE_TIME,
    )


def test_prepare_fingerprint_is_immutable_and_scoped() -> None:
    prepared = prepare_execution_intent(intent())
    assert prepared.status == "prepared"
    assert prepared.event_sequence == 0
    assert prepared.intent_fingerprint == execution_intent_fingerprint(prepared.intent)
    with pytest.raises(ValidationError, match="quantity is required"):
        intent(action="open", quantity=None)


def test_unknown_send_cannot_be_sent_again_and_reconciles_once() -> None:
    prepared = prepare_execution_intent(intent())
    sending = apply_execution_event(prepared, event(prepared, "send_started"))
    unknown = apply_execution_event(
        sending,
        event(sending, "send_unknown", event_id="event-2", at=BASE_TIME + timedelta(seconds=1)),
    )
    assert unknown.status == "unknown"
    with pytest.raises(ExecutionContractError, match="prepared intent"):
        apply_execution_event(
            unknown,
            event(unknown, "send_started", event_id="event-3", at=BASE_TIME + timedelta(seconds=2)),
        )
    reconciled = apply_execution_event(
        unknown,
        event(
            unknown,
            "receipt_observed",
            event_id="event-3",
            at=BASE_TIME + timedelta(seconds=3),
            receipt=receipt(
                unknown,
                "accepted",
                source="reconciliation",
                observed=BASE_TIME + timedelta(seconds=3),
            ),
        ),
    )
    assert reconciled.status == "accepted"
    assert reconciled.event_sequence == 3


@pytest.mark.parametrize("offset", [timedelta(minutes=10), timedelta(minutes=11)])
def test_send_started_at_or_after_expiry_is_denied(offset: timedelta) -> None:
    prepared = prepare_execution_intent(intent())
    with pytest.raises(ExecutionContractError, match="intent expiry"):
        apply_execution_event(
            prepared,
            event(prepared, "send_started", at=BASE_TIME + offset),
        )


def test_unknown_requires_reconciliation_source_and_scope_match() -> None:
    prepared = prepare_execution_intent(intent())
    sending = apply_execution_event(prepared, event(prepared, "send_started"))
    unknown = apply_execution_event(
        sending,
        event(sending, "send_unknown", event_id="event-2", at=BASE_TIME + timedelta(seconds=1)),
    )
    with pytest.raises(ExecutionContractError, match="reconciliation receipt"):
        apply_execution_event(
            unknown,
            event(
                unknown,
                "receipt_observed",
                event_id="event-3",
                at=BASE_TIME + timedelta(seconds=2),
                receipt=receipt(
                    unknown,
                    "accepted",
                    source="adapter_response",
                    observed=BASE_TIME + timedelta(seconds=2),
                ),
            ),
        )
    bad = receipt(
        unknown,
        "accepted",
        source="reconciliation",
        observed=BASE_TIME + timedelta(seconds=2),
    ).model_copy(update={"symbol": "OTHER"})
    with pytest.raises(ExecutionContractError, match="instrument scope"):
        apply_execution_event(
            unknown,
            event(unknown, "receipt_observed", event_id="event-3", at=BASE_TIME + timedelta(seconds=2), receipt=bad),
        )


def test_partial_then_filled_is_monotonic_and_quantities_are_bound() -> None:
    prepared = prepare_execution_intent(intent())
    sending = apply_execution_event(prepared, event(prepared, "send_started"))
    partial = apply_execution_event(
        sending,
        event(
            sending,
            "receipt_observed",
            event_id="event-2",
            at=BASE_TIME + timedelta(seconds=1),
            receipt=receipt(
                sending,
                "partial",
                filled="1",
                remaining="1",
                observed=BASE_TIME + timedelta(seconds=1),
            ),
        ),
    )
    assert partial.status == "partial"
    filled = apply_execution_event(
        partial,
        event(
            partial,
            "receipt_observed",
            event_id="event-3",
            at=BASE_TIME + timedelta(seconds=2),
            receipt=receipt(
                partial,
                "filled",
                filled="2",
                remaining="0",
                observed=BASE_TIME + timedelta(seconds=2),
            ),
        ),
    )
    assert filled.status == "filled"
    with pytest.raises(ExecutionContractError, match="invalid from filled"):
        apply_execution_event(
            filled,
            event(
                filled,
                "receipt_observed",
                event_id="event-4",
                at=BASE_TIME + timedelta(seconds=3),
                receipt=receipt(
                    filled,
                    "filled",
                    filled="2",
                    remaining="0",
                    observed=BASE_TIME + timedelta(seconds=3),
                ),
            ),
        )


def test_duplicate_event_is_idempotent_but_conflicting_reuse_is_rejected() -> None:
    prepared = prepare_execution_intent(intent())
    started = event(prepared, "send_started")
    sending = apply_execution_event(prepared, started)
    assert apply_execution_event(sending, started) == sending
    conflict = started.model_copy(update={"reason": "changed"})
    with pytest.raises(ExecutionContractError, match="different content"):
        apply_execution_event(sending, conflict)


def test_quarantine_is_explicit_and_terminal() -> None:
    prepared = prepare_execution_intent(intent())
    sending = apply_execution_event(prepared, event(prepared, "send_started"))
    unknown = apply_execution_event(
        sending,
        event(sending, "send_unknown", event_id="event-2", at=BASE_TIME + timedelta(seconds=1)),
    )
    quarantined = quarantine_execution(
        unknown,
        event_id="event-3",
        actor="reconciler",
        reason="reconciliation evidence conflicted",
        evidence_hash="sha256:conflict",
        at_utc=BASE_TIME + timedelta(seconds=2),
    )
    assert quarantined.status == "quarantined"
    assert quarantined.quarantine_reason == "reconciliation evidence conflicted"
    with pytest.raises(ExecutionContractError, match="prepared intent"):
        apply_execution_event(
            quarantined,
            event(quarantined, "send_started", event_id="event-4", at=BASE_TIME + timedelta(seconds=3)),
        )


def _ready_budget() -> RiskBudget:
    return RiskBudget(
        currency="VND",
        capital_scope_vnd=Decimal("100000000"),
        reserve_floor_vnd=Decimal("90000000"),
        risk_per_trade_vnd=Decimal("100000"),
        max_open_risk_vnd=Decimal("500000"),
        max_daily_loss_vnd=Decimal("1000000"),
        max_weekly_loss_vnd=Decimal("3000000"),
        max_drawdown_vnd=Decimal("5000000"),
        max_position_notional_vnd=Decimal("10000000"),
        max_turnover_vnd=Decimal("50000000"),
        max_symbol_exposure_pct=Decimal("10"),
        max_strategy_exposure_pct=Decimal("25"),
        max_orders_per_day=10,
        max_slippage_bps=Decimal("20"),
        stale_data_max_seconds=60,
        allowed_instruments=("TEST",),
        effective_from_utc=BASE_TIME - timedelta(hours=1),
        expires_at_utc=BASE_TIME + timedelta(days=1),
        config_hash="budget-v1",
        approved_by="owner-fixture",
    )


def test_execution_admission_requires_capability_epoch_and_exact_budget() -> None:
    budget = _ready_budget()
    capability = AITradeMode(
        mode="paper",
        account_id="paper-account",
        allowed_symbols=("TEST",),
        allowed_actions=("open",),
        risk_budget_hash="budget-v1",
        effective_from_utc=BASE_TIME - timedelta(hours=1),
        expires_at_utc=BASE_TIME + timedelta(days=1),
        kill_switch_active=False,
        reconciliation_state="ready",
    )
    allowed = evaluate_execution_intent(
        intent(), capability, budget, active_capability_epoch="epoch-1", now=BASE_TIME
    )
    assert allowed.decision == "allow"
    denied = evaluate_execution_intent(
        intent(capability_epoch="old-epoch"), capability, budget, active_capability_epoch="epoch-1", now=BASE_TIME
    )
    assert denied.decision == "deny"
    assert "capability_epoch_mismatch" in denied.blockers
