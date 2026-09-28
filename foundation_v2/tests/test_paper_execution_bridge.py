from __future__ import annotations
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib

import pytest

from trading_workspace_v2.execution_intent_contract import (
    ExecutionEvent,
    ExecutionIntent,
    apply_execution_event,
    prepare_execution_intent,
)
from trading_workspace_v2.paper_accounting import (
    PaperAccountState,
    PaperFillReceipt,
    PaperOrderIntent,
)
from trading_workspace_v2.paper_execution_bridge import (
    PaperExecutionBridgeError,
    apply_paper_observation,
)


UTC = timezone.utc
BASE = datetime(2026, 9, 28, 12, 0, tzinfo=UTC)


def paper_intent(*, side: str = "buy", quantity: str = "3") -> PaperOrderIntent:
    return PaperOrderIntent(
        intent_id="paper-i-1",
        account_id="paper-account",
        symbol="BTCUSDT",
        side=side,
        quantity=Decimal(quantity),
        strategy_id="fvg-v1",
        strategy_version="r1",
        risk_budget_hash="budget-v1",
        created_at_utc=BASE,
        expires_at_utc=BASE + timedelta(minutes=10),
    )


def execution_ledger(
    intent: PaperOrderIntent,
    *,
    mode: str = "paper",
    action: str | None = None,
):
    execution_intent = ExecutionIntent(
        intent_id=intent.intent_id,
        account_id=intent.account_id,
        mode=mode,
        symbol=intent.symbol,
        action=action or ("open" if intent.side == "buy" else "close"),
        quantity=intent.quantity,
        risk_budget_hash=intent.risk_budget_hash,
        capability_epoch="epoch-1",
        actor="offline-test",
        strategy_id=intent.strategy_id,
        strategy_version=intent.strategy_version,
        created_at_utc=intent.created_at_utc,
        expires_at_utc=intent.expires_at_utc,
    )
    prepared = prepare_execution_intent(execution_intent)
    started = ExecutionEvent(
        event_id="send-started",
        sequence=1,
        intent_id=prepared.intent.intent_id,
        intent_fingerprint=prepared.intent_fingerprint,
        event_type="send_started",
        actor="offline-test",
        reason="paper adapter start",
        at_utc=BASE,
    )
    return apply_execution_event(prepared, started)


def paper_receipt(
    intent: PaperOrderIntent,
    receipt_id: str,
    *,
    status: str,
    quantity: str,
    at: datetime,
    source: str = "adapter_response",
) -> PaperFillReceipt:
    return PaperFillReceipt(
        receipt_id=receipt_id,
        intent_id=intent.intent_id,
        intent_fingerprint=intent.fingerprint(),
        account_id=intent.account_id,
        symbol=intent.symbol,
        side=intent.side,
        status=status,
        filled_quantity=Decimal(quantity),
        fill_price=None if status == "unknown" else Decimal("100"),
        fee=Decimal("0"),
        source=source,
        evidence_hash="evidence-" + hashlib.sha256(receipt_id.encode()).hexdigest(),
        observed_at_utc=at,
    )


def test_partial_delta_becomes_cumulative_execution_receipt_and_retry_is_atomic() -> None:
    intent = paper_intent()
    ledger = execution_ledger(intent)
    state = PaperAccountState(account_id=intent.account_id, cash=Decimal("1000"))
    first = apply_paper_observation(
        ledger,
        state,
        intent,
        paper_receipt(intent, "r-1", status="partial", quantity="1", at=BASE + timedelta(seconds=1)),
    )
    assert first.execution_ledger.status == "partial"
    assert first.execution_receipt is not None
    assert first.execution_receipt.filled_quantity == Decimal("1")
    assert first.execution_receipt.remaining_quantity == Decimal("2")
    assert first.account_state.intents[0].filled_quantity == Decimal("1")

    replay = apply_paper_observation(
        first.execution_ledger,
        first.account_state,
        intent,
        paper_receipt(intent, "r-1", status="partial", quantity="1", at=BASE + timedelta(seconds=1)),
    )
    assert replay.execution_ledger == first.execution_ledger
    assert replay.account_state == first.account_state


def test_default_retry_key_handles_max_length_receipt_ids() -> None:
    intent = paper_intent(quantity="1")
    ledger = execution_ledger(intent)
    state = PaperAccountState(account_id=intent.account_id, cash=Decimal("1000"))
    receipt = paper_receipt(
        intent,
        "r" * 128,
        status="filled",
        quantity="1",
        at=BASE + timedelta(seconds=1),
    )
    projection = apply_paper_observation(ledger, state, intent, receipt)
    assert len(projection.execution_event.event_id) <= 128


def test_unknown_then_reconciliation_fill_links_both_ledgers() -> None:
    intent = paper_intent(quantity="2")
    ledger = execution_ledger(intent)
    state = PaperAccountState(account_id=intent.account_id, cash=Decimal("1000"))
    unknown = apply_paper_observation(
        ledger,
        state,
        intent,
        paper_receipt(intent, "r-unknown", status="unknown", quantity="0", at=BASE + timedelta(seconds=1)),
    )
    assert unknown.execution_ledger.status == "unknown"
    assert unknown.execution_receipt is None
    assert unknown.account_state.pending_unknown_intent_ids == (intent.intent_id,)

    settled = apply_paper_observation(
        unknown.execution_ledger,
        unknown.account_state,
        intent,
        paper_receipt(
            intent,
            "r-settled",
            status="filled",
            quantity="2",
            source="reconciliation",
            at=BASE + timedelta(seconds=2),
        ),
    )
    assert settled.execution_ledger.status == "filled"
    assert settled.execution_receipt is not None
    assert settled.execution_receipt.source == "reconciliation"
    assert settled.execution_receipt.filled_quantity == Decimal("2")
    assert settled.account_state.pending_unknown_intent_ids == ()


def test_bridge_rejects_live_and_unbound_or_unexpected_reconciliation() -> None:
    intent = paper_intent()
    ledger = execution_ledger(intent)
    state = PaperAccountState(account_id=intent.account_id, cash=Decimal("1000"))
    reconciliation = paper_receipt(
        intent,
        "r-reconcile",
        status="filled",
        quantity="3",
        source="reconciliation",
        at=BASE + timedelta(seconds=1),
    )
    with pytest.raises(PaperExecutionBridgeError, match="reconciliation_requires_pending_unknown"):
        apply_paper_observation(ledger, state, intent, reconciliation)

    live_ledger = execution_ledger(intent, mode="live")
    with pytest.raises(PaperExecutionBridgeError, match="paper_execution_mode"):
        apply_paper_observation(
            live_ledger,
            state,
            intent,
            paper_receipt(intent, "r-live", status="filled", quantity="3", at=BASE + timedelta(seconds=1)),
        )

    cancel_ledger = execution_ledger(intent, action="cancel")
    with pytest.raises(PaperExecutionBridgeError, match="action_not_supported"):
        apply_paper_observation(
            cancel_ledger,
            state,
            intent,
            paper_receipt(intent, "r-cancel", status="filled", quantity="3", at=BASE + timedelta(seconds=1)),
        )


def test_reconciliation_receipt_cannot_bypass_unknown_execution_state() -> None:
    intent = paper_intent(quantity="1")
    ledger = execution_ledger(intent)
    state = PaperAccountState(account_id=intent.account_id, cash=Decimal("1000"))
    with pytest.raises(PaperExecutionBridgeError, match="reconciliation_requires_pending_unknown"):
        apply_paper_observation(
            ledger,
            state,
            intent,
            paper_receipt(
                intent,
                "r-reconcile",
                status="filled",
                quantity="1",
                source="reconciliation",
                at=BASE + timedelta(seconds=1),
            ),
        )

