from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import unittest

from pydantic import ValidationError

from trading_workspace_v2.paper_accounting import (
    FakePaperAdapter,
    PaperAccountState,
    PaperAccountingError,
    PaperFillReceipt,
    PaperOrderIntent,
    PaperPosition,
    apply_paper_receipt,
    reconcile_paper_account,
)


UTC = timezone.utc
BASE = datetime(2026, 9, 28, 12, 0, tzinfo=UTC)


def intent(
    intent_id: str = "i-1",
    *,
    side: str = "buy",
    quantity: str = "2",
    account_id: str = "paper-1",
) -> PaperOrderIntent:
    return PaperOrderIntent(
        intent_id=intent_id,
        account_id=account_id,
        symbol="BTCUSDT",
        side=side,
        quantity=Decimal(quantity),
        risk_budget_hash="risk-hash",
        created_at_utc=BASE,
        expires_at_utc=BASE + timedelta(hours=1),
    )


def receipt(
    order: PaperOrderIntent,
    receipt_id: str,
    *,
    status: str = "filled",
    quantity: str = "2",
    price: str | None = "100",
    fee: str = "1",
    source: str = "adapter_response",
    at: datetime = BASE + timedelta(minutes=1),
) -> PaperFillReceipt:
    return PaperFillReceipt(
        receipt_id=receipt_id,
        intent_id=order.intent_id,
        intent_fingerprint=order.fingerprint(),
        account_id=order.account_id,
        symbol=order.symbol,
        side=order.side,
        status=status,
        filled_quantity=Decimal(quantity),
        fill_price=None if price is None else Decimal(price),
        fee=Decimal(fee),
        source=source,
        evidence_hash=f"evidence-{receipt_id}",
        observed_at_utc=at,
    )


class PaperAccountingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.state = PaperAccountState(account_id="paper-1", cash=Decimal("1000"))

    def test_buy_sell_and_average_cost_are_deterministic(self):
        buy = intent(quantity="2")
        current = apply_paper_receipt(self.state, buy, receipt(buy, "r-buy"))
        self.assertEqual(current.cash, Decimal("799"))
        self.assertEqual(current.positions[0].quantity, Decimal("2"))
        self.assertEqual(current.positions[0].average_cost, Decimal("100"))

        sell = intent("i-sell", side="sell", quantity="1")
        current = apply_paper_receipt(
            current,
            sell,
            receipt(sell, "r-sell", quantity="1", price="120", fee="2"),
        )
        self.assertEqual(current.cash, Decimal("917"))
        self.assertEqual(current.positions[0].quantity, Decimal("1"))
        self.assertEqual(current.entries[-1].cash_delta, Decimal("118"))

    def test_partial_then_filled_uses_delta_quantities(self):
        order = intent(quantity="3")
        current = apply_paper_receipt(
            self.state,
            order,
            receipt(order, "r-partial", status="partial", quantity="1", fee="0"),
        )
        self.assertEqual(current.intents[0].filled_quantity, Decimal("1"))
        filled = receipt(order, "r-filled", status="filled", quantity="2", fee="0")
        current = apply_paper_receipt(current, order, filled)
        self.assertEqual(current.intents[0].terminal_status, "filled")
        self.assertEqual(current.intents[0].filled_quantity, Decimal("3"))
        self.assertEqual(current.positions[0].quantity, Decimal("3"))

    def test_unknown_does_not_mutate_money_and_reconciliation_may_settle(self):
        order = intent()
        unknown = receipt(order, "r-unknown", status="unknown", quantity="0", price=None, fee="0")
        current = apply_paper_receipt(self.state, order, unknown)
        self.assertEqual(current.cash, Decimal("1000"))
        self.assertEqual(current.positions, ())
        self.assertEqual(current.pending_unknown_intent_ids, (order.intent_id,))

        settled = receipt(
            order,
            "r-settled",
            status="filled",
            source="reconciliation",
            at=BASE + timedelta(minutes=2),
        )
        current = apply_paper_receipt(current, order, settled)
        self.assertEqual(current.cash, Decimal("799"))
        self.assertEqual(current.pending_unknown_intent_ids, ())

    def test_duplicate_receipt_is_idempotent_and_conflicting_terminal_is_rejected(self):
        order = intent()
        applied = apply_paper_receipt(self.state, order, receipt(order, "r-1"))
        self.assertIs(apply_paper_receipt(applied, order, receipt(order, "r-1")), applied)
        with self.assertRaisesRegex(PaperAccountingError, "receipt_id_reused"):
            apply_paper_receipt(applied, order, receipt(order, "r-1", price="101"))
        conflicting = receipt(order, "r-2", price="101")
        with self.assertRaisesRegex(PaperAccountingError, "terminal_intent"):
            apply_paper_receipt(applied, order, conflicting)

    def test_rejects_insufficient_cash_and_position_without_mutation(self):
        expensive = intent(quantity="11")
        with self.assertRaisesRegex(PaperAccountingError, "insufficient_cash"):
            apply_paper_receipt(
                self.state,
                expensive,
                receipt(expensive, "r-expensive", quantity="11", price="100", fee="1"),
            )
        sell = intent("i-sell", side="sell", quantity="1")
        with self.assertRaisesRegex(PaperAccountingError, "insufficient_position"):
            apply_paper_receipt(self.state, sell, receipt(sell, "r-short", quantity="1", price="100", fee="0"))
        self.assertEqual(self.state.sequence, 0)

    def test_sell_fee_cannot_make_cash_negative(self):
        buy = intent(quantity="2")
        current = apply_paper_receipt(self.state, buy, receipt(buy, "r-buy", fee="0"))
        sell = intent("i-sell", side="sell", quantity="1")
        with self.assertRaisesRegex(PaperAccountingError, "insufficient_cash_for_fee"):
            apply_paper_receipt(
                current,
                sell,
                receipt(sell, "r-fee", quantity="1", price="1", fee="1000"),
            )
        self.assertEqual(current.cash, Decimal("800"))
        self.assertEqual(current.positions[0].quantity, Decimal("2"))

    def test_partial_intent_cannot_be_marked_rejected(self):
        order = intent(quantity="3")
        current = apply_paper_receipt(
            self.state,
            order,
            receipt(order, "r-partial", status="partial", quantity="1", fee="0"),
        )
        with self.assertRaisesRegex(PaperAccountingError, "partially_filled_intent"):
            apply_paper_receipt(
                current,
                order,
                receipt(order, "r-rejected", status="rejected", quantity="0", price=None, fee="0"),
            )

    def test_restart_snapshot_and_reconciliation_are_canonical(self):
        order = intent()
        current = apply_paper_receipt(self.state, order, receipt(order, "r-1"))
        restored = PaperAccountState.model_validate_json(current.model_dump_json())
        self.assertEqual(restored, current)
        matched = reconcile_paper_account(
            restored,
            observed_cash=Decimal("799"),
            observed_positions=(PaperPosition(symbol="BTCUSDT", quantity=Decimal("2"), average_cost=Decimal("100")),),
            checked_at_utc=BASE + timedelta(minutes=2),
        )
        self.assertEqual(matched.result, "matched")
        mismatched = reconcile_paper_account(restored, observed_cash=Decimal("798"), checked_at_utc=BASE + timedelta(minutes=3))
        self.assertEqual(mismatched.result, "mismatch")
        self.assertIn("cash_mismatch", mismatched.mismatches)

    def test_fake_adapter_replays_the_same_receipt_for_duplicate_intent(self):
        adapter = FakePaperAdapter()
        order = intent()
        first = adapter.submit(order, fill_price=Decimal("100"), fee=Decimal("1"))
        second = adapter.submit(order, fill_price=Decimal("999"), fee=Decimal("99"))
        self.assertEqual(first, second)
        self.assertEqual(first.filled_quantity, order.quantity)
        with self.assertRaisesRegex(PaperAccountingError, "intent_id_reused"):
            adapter.submit(order.model_copy(update={"risk_budget_hash": "different"}), fill_price=Decimal("100"))

    def test_contract_rejects_naive_times_and_invalid_unknown_fill(self):
        with self.assertRaises(ValidationError):
            PaperOrderIntent(
                intent_id="bad",
                account_id="paper-1",
                symbol="BTCUSDT",
                side="buy",
                quantity=Decimal("1"),
                risk_budget_hash="x",
                created_at_utc=datetime(2026, 9, 28, 12, 0),
                expires_at_utc=BASE + timedelta(hours=1),
            )
        order = intent()
        with self.assertRaises(ValidationError):
            receipt(order, "bad", status="unknown", quantity="1", price=None)


if __name__ == "__main__":
    unittest.main()
