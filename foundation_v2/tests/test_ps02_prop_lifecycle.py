from __future__ import annotations

import sys
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(V2) not in sys.path:
    sys.path.insert(0, str(V2))

from trading_workspace_v2.prop_session import (
    ChallengeAttemptSnapshot,
    LossRule,
    OverallDrawdownRule,
    PhaseStateSnapshot,
    ProfitTargetRule,
    PropLifecycleEvent,
    PropPhaseSpec,
    PropProfileSnapshot,
    PropSessionContractError,
    PropSessionSnapshot,
    ThresholdValue,
    evaluate_prop_lifecycle_event,
)
from trading_workspace_v2.store import PostgresStore, PropPersistenceConflict


def phase_spec(
    *,
    min_days: int = 0,
    max_days: int | None = 30,
    reset_order: str = "fees_then_reset",
    position_policy: str = "must_be_flat",
    overall_kind: str = "static",
    trailing_granularity: str | None = None,
    overall_basis: str = "equity",
    overall_amount: Decimal = Decimal("10000"),
    overall_comparator: str = "lt",
    profit_target_amount: Decimal = Decimal("10000"),
) -> PropPhaseSpec:
    return PropPhaseSpec(
        phase_index=1,
        initial_capital=Decimal("100000"),
        currency="USD",
        profit_target=ProfitTargetRule(
            threshold=ThresholdValue(amount=profit_target_amount),
            basis="balance",
            comparator="gte",
        ),
        daily_loss=LossRule(
            threshold=ThresholdValue(amount=Decimal("5000")),
            basis="equity",
            comparator="lt",
        ),
        overall_drawdown=OverallDrawdownRule(
            threshold=ThresholdValue(amount=overall_amount),
            basis=overall_basis,
            comparator=overall_comparator,
            kind=overall_kind,
            trailing_granularity=trailing_granularity,
        ),
        reset_timezone="UTC",
        reset_order=reset_order,
        min_qualifying_days=min_days,
        max_calendar_days=max_days,
        position_policy=position_policy,
    )


def context(spec: PropPhaseSpec | None = None):
    spec = spec or phase_spec()
    profile = PropProfileSnapshot(
        profile_id="ps02-fixture",
        terms_version="2026-09-25",
        profile_hash="sha256:ps02-fixture",
        effective_from=date(2026, 9, 25),
        source_kind="generic",
        supported_rule_flags=["daily_loss", "overall_drawdown", "profit_target"],
        phases=[spec],
    )
    session = PropSessionSnapshot(
        workspace_id="tenant-a",
        session_id="session-1",
        profile=profile,
        status="running",
    )
    attempt = ChallengeAttemptSnapshot(
        workspace_id="tenant-a",
        session_id="session-1",
        attempt_id="attempt-1",
        profile_id=profile.profile_id,
        terms_version=profile.terms_version,
        profile_hash=profile.profile_hash,
        data_version="fixture-data-v1",
        cost_version="cost-v1",
        engine_version="replay-v1",
        status="running",
        revision=3,
        virtual_start_utc=datetime(2026, 1, 1, 12, tzinfo=timezone.utc),
        virtual_cutoff_utc=datetime(2026, 1, 31, 12, tzinfo=timezone.utc),
    )
    phase = PhaseStateSnapshot(
        workspace_id="tenant-a",
        session_id="session-1",
        attempt_id="attempt-1",
        profile_hash=profile.profile_hash,
        phase_index=1,
        initial_balance=Decimal("100000"),
        balance=Decimal("100000"),
        floating_pl=Decimal("0"),
        equity=Decimal("100000"),
        high_water_mark=Decimal("100000"),
        daily_anchor=Decimal("100000"),
        qualifying_days=0,
        virtual_time_utc=datetime(2026, 1, 1, 12, tzinfo=timezone.utc),
        last_event_sequence=7,
        open_positions=0,
        pending_orders=0,
        evaluation_quality="full_for_declared_model",
    )
    return session, attempt, phase


def event(**overrides) -> PropLifecycleEvent:
    payload = {
        "workspace_id": "tenant-a",
        "session_id": "session-1",
        "attempt_id": "attempt-1",
        "profile_hash": "sha256:ps02-fixture",
        "operation_id": "event-8",
        "expected_revision": 3,
        "event_sequence": 8,
        "kind": "simulation_snapshot",
        "virtual_time_utc": datetime(2026, 1, 1, 13, tzinfo=timezone.utc),
        "balance_before_separate_costs": Decimal("100000"),
        "floating_pl": Decimal("0"),
        "open_positions": 0,
        "pending_orders": 0,
        "evaluation_quality": "full_for_declared_model",
    }
    payload.update(overrides)
    return PropLifecycleEvent(**payload)


class Ps02PropLifecycleTests(unittest.TestCase):
    def test_breach_wins_when_profit_target_and_loss_breach_share_one_event(self):
        session, attempt, phase = context()
        result = evaluate_prop_lifecycle_event(
            session,
            attempt,
            phase,
            event(
                balance_before_separate_costs=Decimal("110000"),
                floating_pl=Decimal("-20000.01"),
            ),
        )
        self.assertTrue(result["objectives"]["money"]["profit_target"]["hit"])
        self.assertEqual(result["objectives"]["terminal_action"], "breach")
        self.assertEqual(result["attempt"].status, "failed_breach")
        self.assertEqual(result["attempt"].revision, 4)

    def test_incomplete_quality_blocks_false_pass_and_preserves_objective_evidence(self):
        session, attempt, phase = context()
        result = evaluate_prop_lifecycle_event(
            session,
            attempt,
            phase,
            event(
                balance_before_separate_costs=Decimal("111000"),
                evaluation_quality="insufficient",
            ),
        )
        self.assertIsNone(result["objectives"]["money"])
        self.assertEqual(result["objectives"]["technical_status"], "blocked_by_data")
        self.assertFalse(result["objectives"]["pass_ready"])
        self.assertIsNone(result["objectives"]["terminal_action"])
        self.assertEqual(result["attempt"].status, "running")
        self.assertEqual(result["attempt"].revision, 4)
        self.assertEqual(result["phase"].last_event_sequence, phase.last_event_sequence)
        self.assertEqual(result["phase"].virtual_time_utc, phase.virtual_time_utc)
        self.assertEqual(result["phase"].balance, phase.balance)

    def test_target_requires_minimum_days_and_position_policy(self):
        session, attempt, phase = context(phase_spec(min_days=1))
        not_ready = evaluate_prop_lifecycle_event(
            session,
            attempt,
            phase,
            event(
                balance_before_separate_costs=Decimal("111000"),
                qualifying_day=True,
                open_positions=1,
            ),
            resume_state={"open_positions": [{"position_id": "pos-1"}], "pending_orders": []},
        )
        self.assertEqual(not_ready["phase"].qualifying_days, 1)
        self.assertFalse(not_ready["objectives"]["positions_ready"])
        self.assertEqual(not_ready["attempt"].status, "running")

        carry_session, carry_attempt, carry_phase = context(
            phase_spec(min_days=1, position_policy="carry")
        )
        still_open = evaluate_prop_lifecycle_event(
            carry_session,
            carry_attempt,
            carry_phase,
            event(
                balance_before_separate_costs=Decimal("111000"),
                qualifying_day=True,
                open_positions=1,
            ),
            resume_state={"open_positions": [{"position_id": "pos-1"}], "pending_orders": []},
        )
        self.assertFalse(still_open["objectives"]["positions_ready"])
        self.assertEqual(still_open["attempt"].status, "running")

        ready = evaluate_prop_lifecycle_event(
            carry_session,
            carry_attempt,
            carry_phase,
            event(balance_before_separate_costs=Decimal("111000"), qualifying_day=True),
        )
        self.assertTrue(ready["objectives"]["positions_ready"])
        self.assertEqual(ready["attempt"].status, "completed_pass")

    def test_calendar_boundary_is_explicit_and_fees_then_reset_updates_anchor_after_cost(self):
        session, attempt, phase = context(phase_spec(reset_order="fees_then_reset"))
        crossing = event(
            virtual_time_utc=datetime(2026, 1, 2, 0, tzinfo=timezone.utc),
            balance_before_separate_costs=Decimal("100000"),
        )
        with self.assertRaisesRegex(PropSessionContractError, "calendar boundary must be processed explicitly"):
            evaluate_prop_lifecycle_event(session, attempt, phase, crossing)

        boundary = crossing.model_copy(
            update={
                "kind": "calendar_boundary",
                "fees": Decimal("100"),
                "accounting": "costs_separate",
            }
        )
        result = evaluate_prop_lifecycle_event(session, attempt, phase, boundary)
        self.assertEqual(result["phase"].balance, Decimal("99900"))
        self.assertEqual(result["phase"].daily_anchor, Decimal("99900"))
        self.assertEqual(result["objectives"]["money"]["daily_loss"]["floor"], "94900")

    def test_end_of_day_trailing_ignores_intraday_peak_until_boundary(self):
        session, attempt, phase = context(
            phase_spec(overall_kind="trailing", trailing_granularity="end_of_day")
        )
        peak = evaluate_prop_lifecycle_event(
            session,
            attempt,
            phase,
            event(
                balance_before_separate_costs=Decimal("100000"),
                floating_pl=Decimal("10000"),
            ),
        )
        self.assertEqual(peak["phase"].high_water_mark, Decimal("100000"))
        self.assertEqual(peak["objectives"]["money"]["overall_drawdown"]["floor"], "90000")
        PhaseStateSnapshot.model_validate(peak["phase"].model_dump(mode="json"))

        next_attempt = peak["attempt"]
        next_phase = peak["phase"]
        pullback = evaluate_prop_lifecycle_event(
            session,
            next_attempt,
            next_phase,
            event(
                operation_id="event-9",
                expected_revision=4,
                event_sequence=9,
                virtual_time_utc=datetime(2026, 1, 1, 14, tzinfo=timezone.utc),
                balance_before_separate_costs=Decimal("99000"),
            ),
            resume_state=peak["resume_state"],
        )
        self.assertEqual(pullback["attempt"].status, "running")
        self.assertEqual(pullback["phase"].high_water_mark, Decimal("100000"))
        self.assertEqual(pullback["objectives"]["money"]["overall_drawdown"]["floor"], "90000")

    def test_end_of_day_trailing_updates_hwm_at_explicit_boundary(self):
        session, attempt, phase = context(
            phase_spec(overall_kind="trailing", trailing_granularity="end_of_day")
        )
        result = evaluate_prop_lifecycle_event(
            session,
            attempt,
            phase,
            event(
                kind="calendar_boundary",
                virtual_time_utc=datetime(2026, 1, 2, 0, tzinfo=timezone.utc),
                balance_before_separate_costs=Decimal("110000"),
            ),
        )
        self.assertEqual(result["phase"].high_water_mark, Decimal("110000"))
        self.assertEqual(result["objectives"]["money"]["overall_drawdown"]["reference"], "110000")
        self.assertEqual(result["objectives"]["money"]["overall_drawdown"]["floor"], "100000")

    def test_intraday_trailing_still_tightens_hwm_on_snapshot(self):
        session, attempt, phase = context(
            phase_spec(overall_kind="trailing", trailing_granularity="intraday")
        )
        result = evaluate_prop_lifecycle_event(
            session,
            attempt,
            phase,
            event(
                balance_before_separate_costs=Decimal("100000"),
                floating_pl=Decimal("10000"),
            ),
        )
        self.assertEqual(result["phase"].high_water_mark, Decimal("110000"))
        self.assertEqual(result["objectives"]["money"]["overall_drawdown"]["floor"], "100000")

    def test_intraday_trailing_hwm_follows_declared_balance_basis(self):
        session, attempt, phase = context(
            phase_spec(
                overall_kind="trailing",
                trailing_granularity="intraday",
                overall_basis="balance",
            )
        )
        result = evaluate_prop_lifecycle_event(
            session,
            attempt,
            phase,
            event(
                balance_before_separate_costs=Decimal("100000"),
                floating_pl=Decimal("20000"),
            ),
        )
        self.assertEqual(result["phase"].high_water_mark, Decimal("100000"))
        self.assertEqual(result["objectives"]["money"]["overall_drawdown"]["reference"], "100000")
        self.assertEqual(result["attempt"].status, "running")

    def test_eod_boundary_uses_final_money_for_breach_precedence(self):
        session, attempt, phase = context(
            phase_spec(
                overall_kind="trailing",
                trailing_granularity="end_of_day",
                overall_amount=Decimal("0"),
                overall_comparator="lte",
            )
        )
        result = evaluate_prop_lifecycle_event(
            session,
            attempt,
            phase,
            event(
                kind="calendar_boundary",
                virtual_time_utc=datetime(2026, 1, 2, 0, tzinfo=timezone.utc),
                balance_before_separate_costs=Decimal("110000"),
            ),
        )
        self.assertTrue(result["objectives"]["money"]["profit_target"]["hit"])
        self.assertTrue(result["objectives"]["money"]["overall_drawdown"]["breached"])
        self.assertEqual(result["objectives"]["terminal_action"], "breach")
        self.assertEqual(result["attempt"].status, "failed_breach")

    def test_revision_sequence_cutoff_and_paused_attempt_fail_closed(self):
        session, attempt, phase = context()
        with self.assertRaisesRegex(PropSessionContractError, "revision conflict"):
            evaluate_prop_lifecycle_event(session, attempt, phase, event(expected_revision=2))
        with self.assertRaisesRegex(PropSessionContractError, "sequence"):
            evaluate_prop_lifecycle_event(session, attempt, phase, event(event_sequence=9))
        with self.assertRaisesRegex(PropSessionContractError, "cutoff"):
            evaluate_prop_lifecycle_event(
                session,
                attempt,
                phase,
                event(virtual_time_utc=datetime(2026, 2, 1, tzinfo=timezone.utc)),
            )
        with self.assertRaisesRegex(PropSessionContractError, "running attempt"):
            evaluate_prop_lifecycle_event(
                session,
                attempt.model_copy(update={"status": "paused"}),
                phase,
                event(),
            )


class Ps02PropLifecyclePersistenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        dsn = os.getenv("TW_V2_DATABASE_URL")
        if not dsn:
            raise unittest.SkipTest("TW_V2_DATABASE_URL is required for PS-02 persistence tests")
        cls.dsn = dsn
        cls.store = PostgresStore(dsn)
        cls.store.initialize()

    def setUp(self):
        suffix = uuid4().hex
        self.workspace_id = f"ps02-{suffix}"
        self.session_id = f"session-{suffix}"
        self.attempt_id = f"attempt-{suffix}"
        base_session, base_attempt, base_phase = context()
        self.session = base_session.model_copy(
            update={"workspace_id": self.workspace_id, "session_id": self.session_id}
        )
        self.attempt = base_attempt.model_copy(
            update={
                "workspace_id": self.workspace_id,
                "session_id": self.session_id,
                "attempt_id": self.attempt_id,
                "revision": 1,
            }
        )
        self.phase = base_phase.model_copy(
            update={
                "workspace_id": self.workspace_id,
                "session_id": self.session_id,
                "attempt_id": self.attempt_id,
                "last_event_sequence": 0,
            }
        )
        self.resume = {"cursor": {"bar_index": 10, "timestamp_utc": "2026-01-01T12:00:00Z"}, "open_positions": [], "pending_orders": []}
        self.store.create_prop_session_bundle(
            self.session,
            self.attempt,
            self.phase,
            resume_state=self.resume,
        )

    def lifecycle_event(self, **overrides) -> PropLifecycleEvent:
        payload = {
            "workspace_id": self.workspace_id,
            "session_id": self.session_id,
            "attempt_id": self.attempt_id,
            "profile_hash": self.session.profile.profile_hash,
            "operation_id": f"lifecycle-{uuid4().hex}",
            "expected_revision": 1,
            "event_sequence": 1,
            "kind": "simulation_snapshot",
            "virtual_time_utc": datetime(2026, 1, 1, 13, tzinfo=timezone.utc),
            "balance_before_separate_costs": Decimal("111000"),
            "floating_pl": Decimal("0"),
            "open_positions": 0,
            "pending_orders": 0,
            "evaluation_quality": "full_for_declared_model",
        }
        payload.update(overrides)
        return PropLifecycleEvent(**payload)

    def test_store_event_is_atomic_idempotent_and_restorable(self):
        lifecycle_event = self.lifecycle_event()
        resume = {
            **self.resume,
            "cursor": {"bar_index": 11, "timestamp_utc": "2026-01-01T13:00:00Z"},
        }
        first = self.store.apply_prop_lifecycle_event(lifecycle_event, resume_state=resume)
        duplicate = self.store.apply_prop_lifecycle_event(lifecycle_event, resume_state=resume)
        restored = self.store.get_prop_resume_state(
            self.workspace_id, self.session_id, self.attempt_id
        )

        self.assertFalse(first["duplicate"])
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(first["attempt"].revision, 2)
        self.assertEqual(first["attempt"].status, "completed_pass")
        self.assertEqual(restored["attempt"].revision, 2)
        self.assertEqual(restored["resume_state"]["cursor"]["bar_index"], 11)
        self.assertEqual(
            restored["resume_state"]["prop_lifecycle"]["last_objectives"]["terminal_action"],
            "complete_pass",
        )

    def test_blocked_quality_does_not_consume_event_sequence_and_can_be_retried(self):
        blocked_event = self.lifecycle_event(
            operation_id=f"blocked-{uuid4().hex}",
            evaluation_quality="insufficient",
        )
        blocked = self.store.apply_prop_lifecycle_event(
            blocked_event,
            resume_state={
                **self.resume,
                "cursor": {"bar_index": 99, "timestamp_utc": "2026-01-01T13:00:00Z"},
            },
        )
        self.assertEqual(blocked["attempt"].revision, 2)
        self.assertEqual(blocked["attempt"].status, "running")
        self.assertEqual(blocked["phase"].last_event_sequence, 0)
        self.assertEqual(blocked["phase"].virtual_time_utc, self.phase.virtual_time_utc)
        self.assertEqual(blocked["objectives"]["technical_status"], "blocked_by_data")
        self.assertEqual(blocked["resume_state"]["cursor"]["bar_index"], 10)

        recovered_event = self.lifecycle_event(
            operation_id=f"recovered-{uuid4().hex}",
            expected_revision=2,
        )
        recovered = self.store.apply_prop_lifecycle_event(recovered_event)
        self.assertEqual(recovered["attempt"].revision, 3)
        self.assertEqual(recovered["attempt"].status, "completed_pass")
        self.assertEqual(recovered["phase"].last_event_sequence, 1)

    def test_two_tabs_with_same_revision_cannot_apply_two_distinct_events(self):
        events = [
            self.lifecycle_event(operation_id=f"tab-a-{uuid4().hex}"),
            self.lifecycle_event(operation_id=f"tab-b-{uuid4().hex}"),
        ]

        def apply(item):
            try:
                return self.store.apply_prop_lifecycle_event(item)
            except Exception as exc:  # captured for deterministic assertion below
                return exc

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(apply, events))

        successes = [value for value in outcomes if isinstance(value, dict)]
        conflicts = [value for value in outcomes if isinstance(value, PropPersistenceConflict)]
        self.assertEqual(len(successes), 1)
        self.assertEqual(len(conflicts), 1)
        restored = self.store.get_prop_resume_state(self.workspace_id, self.session_id, self.attempt_id)
        self.assertEqual(restored["attempt"].revision, 2)

    def test_store_event_cannot_cross_workspace_scope(self):
        foreign = self.lifecycle_event(
            workspace_id=f"other-{self.workspace_id}",
            operation_id=f"foreign-{uuid4().hex}",
        )
        with self.assertRaises(LookupError):
            self.store.apply_prop_lifecycle_event(foreign)


if __name__ == "__main__":
    unittest.main()
