from __future__ import annotations

import sys
import os
import tempfile
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
    TransitionIntent,
    apply_prop_lifecycle_command,
    evaluate_prop_lifecycle_event,
)
from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
from trading_workspace_v2.store import PostgresStore, PropIdempotencyConflict, PropPersistenceConflict
from fastapi.testclient import TestClient


def phase_spec(
    *,
    phase_index: int = 1,
    initial_capital: Decimal = Decimal("100000"),
    min_days: int = 0,
    max_days: int | None = 30,
    reset_order: str = "fees_then_reset",
    carry_policy: str = "reset",
    position_policy: str = "must_be_flat",
    overall_kind: str = "static",
    trailing_granularity: str | None = None,
    overall_basis: str = "equity",
    overall_amount: Decimal = Decimal("10000"),
    overall_comparator: str = "lt",
    profit_target_amount: Decimal = Decimal("10000"),
) -> PropPhaseSpec:
    return PropPhaseSpec(
        phase_index=phase_index,
        initial_capital=initial_capital,
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
        carry_policy=carry_policy,
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
        initial_balance=spec.initial_capital,
        balance=spec.initial_capital,
        floating_pl=Decimal("0"),
        equity=spec.initial_capital,
        high_water_mark=spec.initial_capital,
        daily_anchor=spec.initial_capital,
        qualifying_days=0,
        virtual_time_utc=datetime(2026, 1, 1, 12, tzinfo=timezone.utc),
        last_event_sequence=7,
        open_positions=0,
        pending_orders=0,
        evaluation_quality="full_for_declared_model",
    )
    return session, attempt, phase


def multi_phase_context(*, carry_policy: str, position_policy: str = "must_be_flat"):
    first = phase_spec(carry_policy=carry_policy, position_policy=position_policy)
    second = phase_spec(
        phase_index=2,
        initial_capital=Decimal("50000"),
        profit_target_amount=Decimal("5000"),
    )
    session, attempt, phase = context(first)
    profile = PropProfileSnapshot(
        **session.profile.model_dump(exclude={"phases"}),
        phases=[first, second],
    )
    return session.model_copy(update={"profile": profile}), attempt, phase


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


def transition_intent(
    attempt: ChallengeAttemptSnapshot,
    phase: PhaseStateSnapshot,
    action: str,
    *,
    intent_id: str | None = None,
) -> TransitionIntent:
    return TransitionIntent(
        workspace_id=attempt.workspace_id,
        session_id=attempt.session_id,
        attempt_id=attempt.attempt_id,
        profile_hash=attempt.profile_hash,
        intent_id=intent_id or f"intent-{uuid4().hex}",
        expected_revision=attempt.revision,
        event_sequence=phase.last_event_sequence,
        action=action,
    )


class Ps02PropLifecycleTests(unittest.TestCase):
    def test_direct_replay_bound_next_phase_requires_canonical_store_transition(self):
        session, attempt, phase = multi_phase_context(carry_policy="reset")
        attempt = attempt.model_copy(update={"status": "phase_passed", "revision": 4})
        session = session.model_copy(update={"status": "phase_passed"})
        with self.assertRaisesRegex(PropSessionContractError, "canonical replay phase transition"):
            apply_prop_lifecycle_command(
                session,
                attempt,
                phase,
                transition_intent(attempt, phase, "next_phase"),
                resume_state={
                    "replay_binding": {
                        "replay_session_id": "replay-1",
                        "branch_id": "root",
                        "dataset_id": "dataset-1",
                        "dataset_sha256": "a" * 64,
                        "last_replay_event_sequence": 7,
                    }
                },
            )

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

    def test_open_position_phase_pass_requires_carry_all_policy(self):
        for carry_policy in ("reset", "carry_balance"):
            with self.subTest(carry_policy=carry_policy):
                session, attempt, phase = multi_phase_context(
                    carry_policy=carry_policy,
                    position_policy="carry",
                )
                result = evaluate_prop_lifecycle_event(
                    session,
                    attempt,
                    phase,
                    event(balance_before_separate_costs=Decimal("111000"), open_positions=1),
                    resume_state={
                        "open_positions": [{"position_id": "pos-1"}],
                        "pending_orders": [],
                    },
                )
                self.assertFalse(result["objectives"]["positions_ready"])
                self.assertEqual(result["attempt"].status, "running")

        session, attempt, phase = multi_phase_context(
            carry_policy="carry_all",
            position_policy="carry",
        )
        carried = evaluate_prop_lifecycle_event(
            session,
            attempt,
            phase,
            event(balance_before_separate_costs=Decimal("111000"), open_positions=1),
            resume_state={"open_positions": [{"position_id": "pos-1"}], "pending_orders": []},
        )
        self.assertTrue(carried["objectives"]["positions_ready"])
        self.assertEqual(carried["attempt"].status, "phase_passed")

    def test_explicit_pause_resume_commands_do_not_advance_virtual_clock(self):
        session, attempt, phase = context()
        paused = apply_prop_lifecycle_command(
            session,
            attempt,
            phase,
            transition_intent(attempt, phase, "pause"),
            resume_state={"cursor": {"bar_index": 7, "timestamp_utc": "2026-01-01T12:00:00Z"}},
        )
        self.assertEqual(paused["attempt"].status, "paused")
        self.assertEqual(paused["phase"].virtual_time_utc, phase.virtual_time_utc)
        self.assertEqual(paused["phase"].last_event_sequence, phase.last_event_sequence)

        resumed = apply_prop_lifecycle_command(
            session.model_copy(update={"status": "paused"}),
            paused["attempt"],
            paused["phase"],
            transition_intent(paused["attempt"], paused["phase"], "resume"),
            resume_state=paused["resume_state"],
        )
        self.assertEqual(resumed["attempt"].status, "running")
        self.assertEqual(resumed["phase"].virtual_time_utc, phase.virtual_time_utc)

    def test_next_phase_reset_and_carry_balance_are_explicit(self):
        for carry_policy, expected_balance in (
            ("reset", Decimal("50000")),
            ("carry_balance", Decimal("111000")),
        ):
            with self.subTest(carry_policy=carry_policy):
                session, attempt, phase = multi_phase_context(carry_policy=carry_policy)
                attempt = attempt.model_copy(update={"status": "phase_passed", "revision": 4})
                phase = phase.model_copy(
                    update={
                        "balance": Decimal("111000"),
                        "equity": Decimal("111000"),
                        "high_water_mark": Decimal("111000"),
                    }
                )
                resume = {
                    "cursor": {"bar_index": 77, "timestamp_utc": "2026-01-01T13:00:00Z"},
                    "open_positions": [],
                    "pending_orders": [],
                }
                result = apply_prop_lifecycle_command(
                    session.model_copy(update={"status": "phase_passed"}),
                    attempt,
                    phase,
                    transition_intent(attempt, phase, "next_phase"),
                    resume_state=resume,
                )
                self.assertEqual(result["attempt"].status, "next_phase_ready")
                self.assertEqual(result["phase"].phase_index, 2)
                self.assertEqual(result["phase"].initial_balance, Decimal("50000"))
                self.assertEqual(result["phase"].balance, expected_balance)
                self.assertEqual(result["phase"].floating_pl, Decimal("0"))
                self.assertEqual(result["phase"].equity, expected_balance)
                self.assertEqual(result["phase"].qualifying_days, 0)
                self.assertEqual(result["phase"].virtual_time_utc, phase.virtual_time_utc)
                self.assertEqual(result["phase"].last_event_sequence, phase.last_event_sequence)
                self.assertEqual(result["resume_state"]["cursor"], resume["cursor"])
                self.assertEqual(result["resume_state"]["open_positions"], [])
                self.assertEqual(result["resume_state"]["pending_orders"], [])

    def test_next_phase_carry_all_preserves_live_simulator_state(self):
        session, attempt, phase = multi_phase_context(
            carry_policy="carry_all",
            position_policy="carry",
        )
        attempt = attempt.model_copy(update={"status": "phase_passed", "revision": 4})
        phase = phase.model_copy(
            update={
                "balance": Decimal("111000"),
                "floating_pl": Decimal("-250"),
                "equity": Decimal("110750"),
                "high_water_mark": Decimal("112000"),
                "daily_anchor": Decimal("109000"),
                "open_positions": 1,
            }
        )
        resume = {
            "cursor": {"bar_index": 77, "timestamp_utc": "2026-01-01T13:00:00Z"},
            "open_positions": [{"position_id": "pos-1", "side": "long"}],
            "pending_orders": [],
        }
        result = apply_prop_lifecycle_command(
            session.model_copy(update={"status": "phase_passed"}),
            attempt,
            phase,
            transition_intent(attempt, phase, "next_phase"),
            resume_state=resume,
        )
        self.assertEqual(result["phase"].phase_index, 2)
        self.assertEqual(result["phase"].balance, phase.balance)
        self.assertEqual(result["phase"].floating_pl, phase.floating_pl)
        self.assertEqual(result["phase"].equity, phase.equity)
        self.assertEqual(result["phase"].open_positions, 1)
        self.assertEqual(result["resume_state"]["open_positions"], resume["open_positions"])
        self.assertEqual(
            result["resume_state"]["prop_lifecycle"]["phase_transitions"][-1]["carry_policy"],
            "carry_all",
        )

    def test_next_phase_rejects_pending_orders_and_final_phase(self):
        session, attempt, phase = multi_phase_context(carry_policy="reset")
        attempt = attempt.model_copy(update={"status": "phase_passed", "revision": 4})
        pending_phase = phase.model_copy(update={"pending_orders": 1})
        with self.assertRaisesRegex(PropSessionContractError, "pending orders"):
            apply_prop_lifecycle_command(
                session.model_copy(update={"status": "phase_passed"}),
                attempt,
                pending_phase,
                transition_intent(attempt, pending_phase, "next_phase"),
                resume_state={"pending_orders": [{"order_id": "ord-1"}]},
            )

        final_phase = phase.model_copy(
            update={
                "phase_index": 2,
                "initial_balance": Decimal("50000"),
                "balance": Decimal("50000"),
                "equity": Decimal("50000"),
                "high_water_mark": Decimal("50000"),
                "daily_anchor": Decimal("50000"),
            }
        )
        with self.assertRaisesRegex(PropSessionContractError, "final frozen phase"):
            apply_prop_lifecycle_command(
                session.model_copy(update={"status": "phase_passed"}),
                attempt,
                final_phase,
                transition_intent(attempt, final_phase, "next_phase"),
            )

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

    def create_multiphase_bundle(self, *, carry_policy: str, position_policy: str = "must_be_flat"):
        suffix = uuid4().hex
        workspace_id = f"ps02-multi-{suffix}"
        session_id = f"session-{suffix}"
        attempt_id = f"attempt-{suffix}"
        base_session, base_attempt, base_phase = multi_phase_context(
            carry_policy=carry_policy,
            position_policy=position_policy,
        )
        session = base_session.model_copy(
            update={"workspace_id": workspace_id, "session_id": session_id, "status": "running"}
        )
        attempt = base_attempt.model_copy(
            update={
                "workspace_id": workspace_id,
                "session_id": session_id,
                "attempt_id": attempt_id,
                "revision": 1,
            }
        )
        phase = base_phase.model_copy(
            update={
                "workspace_id": workspace_id,
                "session_id": session_id,
                "attempt_id": attempt_id,
                "last_event_sequence": 0,
            }
        )
        resume = {
            "cursor": {"bar_index": 10, "timestamp_utc": "2026-01-01T12:00:00Z"},
            "open_positions": [],
            "pending_orders": [],
        }
        self.store.create_prop_session_bundle(session, attempt, phase, resume_state=resume)
        return session, attempt, phase, resume

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

    def test_late_duplicate_lifecycle_event_returns_matching_historical_session(self):
        blocked_event = self.lifecycle_event(
            operation_id=f"blocked-late-{uuid4().hex}",
            evaluation_quality="insufficient",
        )
        blocked_resume = {
            **self.resume,
            "cursor": {"bar_index": 99, "timestamp_utc": "2026-01-01T13:00:00Z"},
        }
        first = self.store.apply_prop_lifecycle_event(blocked_event, resume_state=blocked_resume)
        paused = self.store.apply_prop_transition_intent(
            transition_intent(first["attempt"], first["phase"], "pause")
        )
        self.assertEqual(paused["session"].status, "paused")

        duplicate = PostgresStore(self.dsn).apply_prop_lifecycle_event(
            blocked_event,
            resume_state=blocked_resume,
        )
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(duplicate["attempt"].revision, 2)
        self.assertEqual(duplicate["attempt"].status, "running")
        self.assertEqual(duplicate["session"].status, "running")

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

    def test_transition_store_is_idempotent_revision_fenced_and_syncs_session(self):
        intent_id = f"pause-{uuid4().hex}"
        pause = transition_intent(self.attempt, self.phase, "pause", intent_id=intent_id)
        first = self.store.apply_prop_transition_intent(pause)
        duplicate = PostgresStore(self.dsn).apply_prop_transition_intent(pause)

        self.assertFalse(first["duplicate"])
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(first["attempt"].status, "paused")
        self.assertEqual(first["attempt"].revision, 2)
        self.assertEqual(first["session"].status, "paused")
        self.assertEqual(first["session"].revision, 2)
        self.assertEqual(first["phase"].virtual_time_utc, self.phase.virtual_time_utc)
        self.assertEqual(first["resume_state"]["cursor"], self.resume["cursor"])

        tampered = pause.model_copy(update={"action": "abandon"})
        with self.assertRaises(PropIdempotencyConflict):
            self.store.apply_prop_transition_intent(tampered)

        stale = pause.model_copy(update={"intent_id": f"stale-{uuid4().hex}", "action": "resume"})
        with self.assertRaisesRegex(PropPersistenceConflict, "revision conflict"):
            self.store.apply_prop_transition_intent(stale)

        resumed = self.store.apply_prop_transition_intent(
            transition_intent(first["attempt"], first["phase"], "resume")
        )
        self.assertEqual(resumed["attempt"].status, "running")
        self.assertEqual(resumed["attempt"].revision, 3)
        self.assertEqual(resumed["session"].status, "running")
        self.assertEqual(resumed["phase"].virtual_time_utc, self.phase.virtual_time_utc)
        self.assertEqual(resumed["phase"].last_event_sequence, self.phase.last_event_sequence)

        late_duplicate = PostgresStore(self.dsn).apply_prop_transition_intent(pause)
        self.assertTrue(late_duplicate["duplicate"])
        self.assertEqual(late_duplicate["attempt"].status, "running")
        self.assertEqual(late_duplicate["session"].status, "running")
        self.assertEqual(late_duplicate["attempt"].revision, 3)

    def test_two_tabs_cannot_apply_two_distinct_transition_intents(self):
        intents = [
            transition_intent(self.attempt, self.phase, "pause", intent_id=f"tab-a-{uuid4().hex}"),
            transition_intent(self.attempt, self.phase, "pause", intent_id=f"tab-b-{uuid4().hex}"),
        ]

        def apply(item):
            try:
                return PostgresStore(self.dsn).apply_prop_transition_intent(item)
            except Exception as exc:
                return exc

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(apply, intents))

        successes = [value for value in outcomes if isinstance(value, dict)]
        conflicts = [value for value in outcomes if isinstance(value, PropPersistenceConflict)]
        self.assertEqual(len(successes), 1)
        self.assertEqual(len(conflicts), 1)
        restored = self.store.get_prop_resume_state(self.workspace_id, self.session_id, self.attempt_id)
        self.assertEqual(restored["attempt"].revision, 2)
        self.assertEqual(restored["attempt"].status, "paused")
        self.assertEqual(restored["session"].status, "paused")

    def test_multiphase_reset_carry_balance_and_carry_all_persist_without_hidden_drops(self):
        cases = (
            ("reset", "must_be_flat", 0, Decimal("50000"), Decimal("0")),
            ("carry_balance", "must_be_flat", 0, Decimal("111000"), Decimal("0")),
            ("carry_all", "carry", 1, Decimal("111000"), Decimal("-250")),
        )
        for carry_policy, position_policy, open_positions, expected_balance, floating_pl in cases:
            with self.subTest(carry_policy=carry_policy):
                session, attempt, phase, resume = self.create_multiphase_bundle(
                    carry_policy=carry_policy,
                    position_policy=position_policy,
                )
                next_resume = {
                    **resume,
                    "cursor": {"bar_index": 11, "timestamp_utc": "2026-01-01T13:00:00Z"},
                    "open_positions": ([{"position_id": "pos-1"}] if open_positions else []),
                }
                passed = self.store.apply_prop_lifecycle_event(
                    PropLifecycleEvent(
                        workspace_id=session.workspace_id,
                        session_id=session.session_id,
                        attempt_id=attempt.attempt_id,
                        profile_hash=attempt.profile_hash,
                        operation_id=f"pass-{uuid4().hex}",
                        expected_revision=1,
                        event_sequence=1,
                        virtual_time_utc=datetime(2026, 1, 1, 13, tzinfo=timezone.utc),
                        balance_before_separate_costs=Decimal("111000"),
                        floating_pl=floating_pl,
                        open_positions=open_positions,
                        pending_orders=0,
                        evaluation_quality="full_for_declared_model",
                    ),
                    resume_state=next_resume,
                )
                self.assertEqual(passed["attempt"].status, "phase_passed")
                self.assertEqual(passed["session"].status, "phase_passed")

                advanced = self.store.apply_prop_transition_intent(
                    transition_intent(passed["attempt"], passed["phase"], "next_phase")
                )
                self.assertEqual(advanced["attempt"].status, "next_phase_ready")
                self.assertEqual(advanced["session"].status, "next_phase_ready")
                self.assertEqual(advanced["phase"].phase_index, 2)
                self.assertEqual(advanced["phase"].initial_balance, Decimal("50000"))
                self.assertEqual(advanced["phase"].balance, expected_balance)
                self.assertEqual(advanced["phase"].floating_pl, floating_pl)
                self.assertEqual(advanced["phase"].open_positions, open_positions)
                self.assertEqual(advanced["resume_state"]["cursor"], next_resume["cursor"])
                self.assertEqual(len(advanced["resume_state"]["open_positions"]), open_positions)

                with self.store.connect() as conn:
                    previous = conn.execute(
                        """
                        SELECT phase_json FROM prop_attempt_revisions
                        WHERE workspace_id=%s AND session_id=%s AND attempt_id=%s AND revision=2
                        """,
                        (session.workspace_id, session.session_id, attempt.attempt_id),
                    ).fetchone()
                self.assertEqual(previous["phase_json"]["phase_index"], 1)

    def test_next_phase_rejects_incompatible_persisted_open_position_without_mutation(self):
        session, attempt, phase, resume = self.create_multiphase_bundle(carry_policy="reset")
        phase_passed = phase.model_copy(update={"open_positions": 1})
        attempt_passed = attempt.model_copy(update={"status": "phase_passed"})
        session_passed = session.model_copy(update={"status": "phase_passed"})

        suffix = uuid4().hex
        session_passed = session_passed.model_copy(update={"session_id": f"invalid-session-{suffix}"})
        attempt_passed = attempt_passed.model_copy(
            update={"session_id": session_passed.session_id, "attempt_id": f"invalid-attempt-{suffix}"}
        )
        phase_passed = phase_passed.model_copy(
            update={"session_id": session_passed.session_id, "attempt_id": attempt_passed.attempt_id}
        )
        invalid_resume = {
            **resume,
            "open_positions": [{"position_id": "pos-1"}],
        }
        self.store.create_prop_session_bundle(
            session_passed,
            attempt_passed,
            phase_passed,
            resume_state=invalid_resume,
        )
        with self.assertRaisesRegex(PropSessionContractError, "requires flat positions"):
            self.store.apply_prop_transition_intent(
                transition_intent(attempt_passed, phase_passed, "next_phase")
            )
        restored = self.store.get_prop_resume_state(
            session_passed.workspace_id,
            session_passed.session_id,
            attempt_passed.attempt_id,
        )
        self.assertEqual(restored["attempt"].revision, 1)
        self.assertEqual(restored["phase"].phase_index, 1)
        self.assertEqual(restored["phase"].open_positions, 1)

    def test_next_phase_rejects_replay_binding_when_canonical_replay_record_is_missing(self):
        session, attempt, phase, resume = self.create_multiphase_bundle(carry_policy="reset")
        attempt_passed = attempt.model_copy(update={"status": "phase_passed"})
        session_passed = session.model_copy(update={"status": "phase_passed"})
        replay_resume = {
            **resume,
            "replay_binding": {
                "replay_session_id": "replay-1",
                "branch_id": "root",
                "last_replay_event_sequence": 7,
            },
        }
        suffix = uuid4().hex
        session_passed = session_passed.model_copy(update={"session_id": f"replay-bound-session-{suffix}"})
        attempt_passed = attempt_passed.model_copy(
            update={"session_id": session_passed.session_id, "attempt_id": f"replay-bound-attempt-{suffix}"}
        )
        phase = phase.model_copy(
            update={"session_id": session_passed.session_id, "attempt_id": attempt_passed.attempt_id}
        )
        self.store.create_prop_session_bundle(
            session_passed,
            attempt_passed,
            phase,
            resume_state=replay_resume,
        )
        with self.assertRaisesRegex(PropPersistenceConflict, "canonical replay session not found"):
            self.store.apply_prop_transition_intent(
                transition_intent(attempt_passed, phase, "next_phase")
            )
        restored = self.store.get_prop_resume_state(
            session_passed.workspace_id,
            session_passed.session_id,
            attempt_passed.attempt_id,
        )
        self.assertEqual(restored["attempt"].revision, 1)
        self.assertEqual(restored["phase"].phase_index, 1)

    def test_transition_api_is_tenant_scoped_and_remains_simulation_only(self):
        authorization = LocalWorkspaceAuthorization.for_local_owner([self.workspace_id])
        with tempfile.TemporaryDirectory(prefix="ps02-transition-api-") as artifact_root:
            with TestClient(
                create_app(
                    dsn=self.dsn,
                    artifact_root=artifact_root,
                    authorization=authorization,
                    learn_roots={},
                )
            ) as client:
                headers = {"X-Workspace-Id": self.workspace_id}
                body = transition_intent(self.attempt, self.phase, "pause").model_dump(mode="json")
                response = client.post(
                    f"/api/v2/prop/sessions/{self.session_id}/attempts/{self.attempt_id}/transitions",
                    headers=headers,
                    json=body,
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["attempt"]["mode"], "simulation")
                self.assertEqual(response.json()["attempt"]["status"], "paused")
                self.assertEqual(response.json()["session"]["status"], "paused")
                self.assertFalse(client.get("/health").json()["execution_capability"])

                denied_body = {**body, "workspace_id": f"other-{self.workspace_id}", "intent_id": uuid4().hex}
                denied = client.post(
                    f"/api/v2/prop/sessions/{self.session_id}/attempts/{self.attempt_id}/transitions",
                    headers=headers,
                    json=denied_body,
                )
                self.assertEqual(denied.status_code, 403)
                self.assertEqual(denied.json()["detail"], "prop_workspace_mismatch")

    def test_store_event_cannot_cross_workspace_scope(self):
        foreign = self.lifecycle_event(
            workspace_id=f"other-{self.workspace_id}",
            operation_id=f"foreign-{uuid4().hex}",
        )
        with self.assertRaises(LookupError):
            self.store.apply_prop_lifecycle_event(foreign)


if __name__ == "__main__":
    unittest.main()
