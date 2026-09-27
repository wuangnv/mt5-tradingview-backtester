from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import unittest

from pydantic import ValidationError

from trading_workspace_v2.risk_promotion_contracts import (
    AITradeMode,
    PromotionEvent,
    PromotionSnapshot,
    PromotionTransitionError,
    RiskBudget,
    evaluate_promotion,
    fail_closed_decision,
    reduce_promotion,
)


UTC = timezone.utc
BASE_TIME = datetime(2026, 9, 27, 12, 0, tzinfo=UTC)


def event(event_type: str, at: datetime, **overrides: object) -> PromotionEvent:
    payload: dict[str, object] = {
        "event_type": event_type,
        "actor": "offline-test",
        "reason": f"fixture: {event_type}",
        "request_id": f"request-{event_type}-{at.isoformat()}",
        "at_utc": at,
    }
    payload.update(overrides)
    return PromotionEvent.model_validate(payload)


def ready_budget() -> RiskBudget:
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
        config_hash="risk-config-hash-v1",
        approved_by="owner-fixture",
    )


def paper_mode() -> AITradeMode:
    return AITradeMode(
        mode="paper",
        account_id="paper-account",
        allowed_symbols=("TEST",),
        allowed_actions=("open", "close", "cancel", "modify"),
        risk_budget_hash="risk-config-hash-v1",
        effective_from_utc=BASE_TIME - timedelta(hours=1),
        expires_at_utc=BASE_TIME + timedelta(days=1),
        kill_switch_active=False,
        reconciliation_state="ready",
    )


def live_mode() -> AITradeMode:
    return AITradeMode(
        mode="live",
        account_id="live-account",
        allowed_symbols=("TEST",),
        allowed_actions=("open", "close", "cancel", "modify"),
        risk_budget_hash="risk-config-hash-v1",
        effective_from_utc=BASE_TIME - timedelta(hours=1),
        expires_at_utc=BASE_TIME + timedelta(days=1),
        kill_switch_active=False,
        reconciliation_state="ready",
        owner_approved=True,
    )


class RiskBudgetTests(unittest.TestCase):
    def test_missing_budget_is_not_live_ready(self):
        budget = RiskBudget()
        blockers = budget.live_blockers(BASE_TIME)
        self.assertIn("capital_scope_vnd", blockers)
        self.assertIn("expires_at_utc", blockers)
        self.assertFalse(budget.is_live_ready(BASE_TIME))

    def test_budget_relationships_and_time_are_checked(self):
        with self.assertRaisesRegex(ValidationError, "reserve_floor_vnd"):
            RiskBudget(capital_scope_vnd=Decimal("10"), reserve_floor_vnd=Decimal("11"))
        with self.assertRaisesRegex(ValidationError, "after effective_from_utc"):
            RiskBudget(
                effective_from_utc=BASE_TIME,
                expires_at_utc=BASE_TIME,
            )
        self.assertTrue(ready_budget().is_live_ready(BASE_TIME))

    def test_currency_and_holdout_are_strict(self):
        with self.assertRaises(ValidationError):
            RiskBudget(currency="vnd")
        with self.assertRaises(ValidationError):
            PromotionSnapshot.model_validate(
                {
                    "strategy_id": "s1",
                    "strategy_version": "v1",
                    "holdout_locked": False,
                }
            )


class AITradeModeTests(unittest.TestCase):
    def test_default_mode_is_explicit_deny(self):
        mode = AITradeMode()
        self.assertEqual(mode.mode, "configured_deny")
        self.assertIn("ai_trade_mode_configured_deny", mode.readiness_blockers(None, BASE_TIME))

    def test_paper_mode_requires_exact_scope(self):
        mode = paper_mode()
        self.assertEqual(
            mode.execution_blockers(
                adapter_mode="paper",
                account_id="paper-account",
                symbol="TEST",
                action="open",
                budget=ready_budget(),
                now=BASE_TIME,
            ),
            (),
        )
        blockers = mode.execution_blockers(
            adapter_mode="paper",
            account_id="other-account",
            symbol="OTHER",
            action="withdraw",
            budget=ready_budget(),
            now=BASE_TIME,
        )
        self.assertIn("account_scope_mismatch", blockers)
        self.assertIn("symbol_scope_mismatch", blockers)
        self.assertIn("action_scope_mismatch", blockers)

    def test_live_mode_needs_reconciliation_and_expiry(self):
        mode = live_mode().model_copy(update={"reconciliation_state": "unknown", "expires_at_utc": None})
        blockers = mode.execution_blockers(
            adapter_mode="live",
            account_id="live-account",
            symbol="TEST",
            action="open",
            budget=ready_budget(),
            now=BASE_TIME,
        )
        self.assertIn("reconciliation_not_ready", blockers)
        self.assertIn("ai_mode_expiry_missing", blockers)


class PromotionReducerTests(unittest.TestCase):
    def setUp(self):
        self.snapshot = PromotionSnapshot(
            strategy_id="strategy-1",
            strategy_version="rules-v1",
            risk_budget=ready_budget(),
            ai_trade_mode=paper_mode(),
            updated_at_utc=BASE_TIME,
        )

    def test_reducer_allows_only_the_evidenced_order(self):
        current = reduce_promotion(
            self.snapshot,
            event("backtest_passed", BASE_TIME + timedelta(minutes=1), evidence_refs=("backtest.json",)),
        )
        self.assertEqual(current.state, "backtest_pass")
        current = reduce_promotion(
            current,
            event("paper_started", BASE_TIME + timedelta(minutes=2), evidence_refs=("paper.json",)),
        )
        current = reduce_promotion(
            current,
            event("demo_started", BASE_TIME + timedelta(minutes=3), evidence_refs=("demo.json",)),
        )
        # Live mode is an explicit capability change; it is never inferred from
        # reaching demo or from an AI suggestion.
        current = current.model_copy(update={"ai_trade_mode": live_mode()})
        current = reduce_promotion(
            current,
            event(
                "limited_live_approved",
                BASE_TIME + timedelta(minutes=4),
                evidence_refs=("canary-plan.json",),
                owner_approved=True,
                risk_budget_hash="risk-config-hash-v1",
            ),
        )
        current = reduce_promotion(
            current,
            event(
                "canary_passed",
                BASE_TIME + timedelta(minutes=5),
                evidence_refs=("canary-receipt.json",),
                owner_approved=True,
                risk_budget_hash="risk-config-hash-v1",
            ),
        )
        self.assertEqual(current.state, "live_monitored")
        self.assertEqual(current.revision, 5)
        self.assertTrue(current.holdout_locked)

    def test_live_promotion_denies_without_owner_budget_or_evidence(self):
        current = self.snapshot.model_copy(update={"state": "limited_live"})
        decision = evaluate_promotion(
            current,
            event("canary_passed", BASE_TIME + timedelta(minutes=1)),
        )
        self.assertEqual(decision.decision, "deny")
        self.assertIn("owner_approval_required", decision.blockers)
        self.assertIn("ai_trade_mode_live_required", decision.blockers)
        self.assertIn("evidence_required", decision.blockers)
        with self.assertRaises(PromotionTransitionError):
            reduce_promotion(current, event("canary_passed", BASE_TIME + timedelta(minutes=1)))

    def test_illegal_and_stale_events_fail_closed(self):
        illegal = evaluate_promotion(
            self.snapshot,
            event("paper_started", BASE_TIME + timedelta(minutes=1), evidence_refs=("x",)),
        )
        self.assertEqual(illegal.decision, "deny")
        self.assertIn("illegal_transition", illegal.blockers)
        stale = evaluate_promotion(
            self.snapshot,
            event("backtest_passed", BASE_TIME - timedelta(seconds=1), evidence_refs=("x",)),
        )
        self.assertEqual(stale.decision, "deny")
        self.assertIn("stale_event", stale.blockers)

    def test_kill_switch_is_allowed_without_evidence_but_requires_reason(self):
        current = self.snapshot.model_copy(update={"state": "live_monitored"})
        killed = reduce_promotion(
            current,
            event("kill_switch_triggered", BASE_TIME + timedelta(minutes=1)),
        )
        self.assertEqual(killed.state, "killed")
        self.assertEqual(killed.revision, 1)
        with self.assertRaises(ValidationError):
            event("kill_switch_triggered", BASE_TIME + timedelta(minutes=2), reason="")

    def test_unknown_state_and_unknown_target_default_to_deny(self):
        unknown_snapshot = PromotionSnapshot.model_construct(
            strategy_id="s1",
            strategy_version="v1",
            state="future_state",
            revision=0,
            holdout_locked=True,
            evidence_refs=(),
            risk_budget=None,
            updated_at_utc=BASE_TIME,
        )
        decision = evaluate_promotion(
            unknown_snapshot,
            event("kill_switch_triggered", BASE_TIME + timedelta(minutes=1)),
        )
        self.assertEqual(decision.decision, "deny")
        self.assertIn("unknown_current_state", decision.blockers)
        self.assertEqual(fail_closed_decision(["bad"]).target_state, "killed")
        self.assertEqual(fail_closed_decision("not-a-state").decision, "deny")


if __name__ == "__main__":
    unittest.main()
