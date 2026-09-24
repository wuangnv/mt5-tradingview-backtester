from __future__ import annotations

import ast
import sys
import unittest
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

from pydantic import ValidationError


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(V2) not in sys.path:
    sys.path.insert(0, str(V2))

from trading_workspace_v2.prop_session import (
    ChallengeAttemptSnapshot,
    MoneyOracleInput,
    OverallDrawdownRule,
    ProfitTargetRule,
    PropPhaseSpec,
    PropProfileSnapshot,
    PropSessionContractError,
    PropSessionSnapshot,
    PhaseStateSnapshot,
    ThresholdValue,
    TransitionIntent,
    apply_transition_intent,
    calendar_oracle,
    evaluate_with_retained_prop_profile,
    money_oracle,
    validate_attempt_against_session,
)
from trading_workspace_v2.prop_session import LossRule


def fixed_threshold(amount: str, base: str = "initial_capital") -> ThresholdValue:
    return ThresholdValue(amount=Decimal(amount), percent_base=base)


def phase(
    *,
    overall_kind: str = "static",
    loss_comparator: str = "lt",
    reset_timezone: str = "Europe/Prague",
    max_calendar_days: int | None = 30,
) -> PropPhaseSpec:
    return PropPhaseSpec(
        phase_index=1,
        initial_capital=Decimal("100000"),
        currency="USD",
        profit_target=ProfitTargetRule(
            threshold=fixed_threshold("10000"), basis="balance", comparator="gte"
        ),
        daily_loss=LossRule(
            threshold=fixed_threshold("5000"), basis="equity", comparator=loss_comparator
        ),
        overall_drawdown=OverallDrawdownRule(
            threshold=fixed_threshold("10000"),
            basis="equity",
            comparator=loss_comparator,
            kind=overall_kind,
            trailing_granularity="intraday" if overall_kind == "trailing" else None,
        ),
        reset_timezone=reset_timezone,
        min_qualifying_days=3,
        max_calendar_days=max_calendar_days,
    )


def profile(spec: PropPhaseSpec | None = None) -> PropProfileSnapshot:
    return PropProfileSnapshot(
        profile_id="generic-fixture",
        terms_version="2026-09-25-fixture",
        profile_hash="sha256:fixture-v1",
        effective_from=date(2026, 9, 25),
        source_kind="generic",
        supported_rule_flags=["daily_loss", "overall_drawdown", "profit_target"],
        phases=[spec or phase()],
    )


def attempt() -> ChallengeAttemptSnapshot:
    return ChallengeAttemptSnapshot(
        workspace_id="tenant-a",
        session_id="session-1",
        attempt_id="attempt-1",
        profile_id="generic-fixture",
        terms_version="2026-09-25-fixture",
        profile_hash="sha256:fixture-v1",
        data_version="fixture-data-sha256:1",
        cost_version="cost-v1",
        engine_version="replay-v1",
        status="running",
        revision=7,
        virtual_start_utc=datetime(2026, 3, 27, tzinfo=timezone.utc),
        virtual_cutoff_utc=datetime(2026, 4, 5, tzinfo=timezone.utc),
    )


class Ps00DomainContractTests(unittest.TestCase):
    def test_contract_is_simulation_only_and_profile_snapshot_is_versioned(self):
        session = PropSessionSnapshot(
            workspace_id="tenant-a",
            session_id="session-1",
            profile=profile(),
        )
        self.assertEqual(session.mode, "simulation")
        self.assertEqual(session.profile.terms_version, "2026-09-25-fixture")
        self.assertEqual(session.revision, 1)

        with self.assertRaises(ValidationError):
            PropSessionSnapshot(
                workspace_id="tenant-a",
                session_id="session-1",
                mode="live",
                profile=profile(),
            )

    def test_profile_rejects_gapped_phases_and_invalid_timezone(self):
        second = phase().model_copy(update={"phase_index": 3})
        with self.assertRaises(ValidationError):
            PropProfileSnapshot(
                profile_id="bad",
                terms_version="v1",
                profile_hash="sha256:bad",
                effective_from=date(2026, 1, 1),
                phases=[phase(), second],
            )
        with self.assertRaises(ValidationError):
            phase(reset_timezone="Mars/Olympus_Mons")
        with self.assertRaises(ValidationError):
            profile().model_copy(update={"source_kind": "named_provider"}).model_validate(
                {
                    **profile().model_dump(mode="json"),
                    "source_kind": "named_provider",
                    "source_url": None,
                }
            )

    def test_attempt_and_phase_state_must_match_frozen_scope_and_money_path(self):
        session = PropSessionSnapshot(
            workspace_id="tenant-a",
            session_id="session-1",
            profile=profile(),
            status="running",
        )
        current = attempt()
        validate_attempt_against_session(session, current)
        with self.assertRaisesRegex(PropSessionContractError, "workspace mismatch"):
            validate_attempt_against_session(
                session,
                current.model_copy(update={"workspace_id": "tenant-b"}),
            )

        state = PhaseStateSnapshot(
            workspace_id="tenant-a",
            session_id="session-1",
            attempt_id="attempt-1",
            profile_hash="sha256:fixture-v1",
            phase_index=1,
            initial_balance=Decimal("100000"),
            balance=Decimal("101000"),
            floating_pl=Decimal("-250"),
            equity=Decimal("100750"),
            high_water_mark=Decimal("102000"),
            daily_anchor=Decimal("101500"),
            qualifying_days=1,
            virtual_time_utc=datetime(2026, 3, 28, tzinfo=timezone.utc),
            last_event_sequence=9,
            open_positions=1,
            pending_orders=0,
            evaluation_quality="full_for_declared_model",
        )
        self.assertEqual(state.equity, Decimal("100750"))
        with self.assertRaises(ValidationError):
            PhaseStateSnapshot.model_validate(
                {**state.model_dump(mode="json"), "equity": "100751"}
            )

    def test_transition_is_tenant_scoped_revisioned_and_idempotent(self):
        current = attempt()
        intent = TransitionIntent(
            workspace_id="tenant-a",
            session_id="session-1",
            attempt_id="attempt-1",
            profile_hash=current.profile_hash,
            intent_id="intent-pause-1",
            expected_revision=7,
            event_sequence=44,
            action="pause",
        )
        first = apply_transition_intent(current, intent, {})
        self.assertEqual(first.attempt.status, "paused")
        self.assertEqual(first.attempt.revision, 8)
        self.assertFalse(first.duplicate)

        duplicate = apply_transition_intent(
            first.attempt,
            intent,
            {intent.intent_id: first.intent_fingerprint},
        )
        self.assertTrue(duplicate.duplicate)
        self.assertEqual(duplicate.attempt.revision, 8)

        cross_tenant = intent.model_copy(update={"workspace_id": "tenant-b", "intent_id": "cross"})
        with self.assertRaisesRegex(PropSessionContractError, "workspace mismatch"):
            apply_transition_intent(current, cross_tenant, {})

        stale = intent.model_copy(update={"expected_revision": 6, "intent_id": "stale"})
        with self.assertRaisesRegex(PropSessionContractError, "revision conflict"):
            apply_transition_intent(current, stale, {})

        wrong_profile = intent.model_copy(update={"profile_hash": "sha256:other", "intent_id": "profile"})
        with self.assertRaisesRegex(PropSessionContractError, "profile version mismatch"):
            apply_transition_intent(current, wrong_profile, {})

    def test_reusing_intent_id_with_different_action_is_rejected(self):
        current = attempt()
        original = TransitionIntent(
            workspace_id=current.workspace_id,
            session_id=current.session_id,
            attempt_id=current.attempt_id,
            profile_hash=current.profile_hash,
            intent_id="same-id",
            expected_revision=current.revision,
            event_sequence=2,
            action="pause",
        )
        first = apply_transition_intent(current, original, {})
        tampered = original.model_copy(update={"action": "breach"})
        with self.assertRaisesRegex(PropSessionContractError, "different content"):
            apply_transition_intent(
                first.attempt,
                tampered,
                {original.intent_id: first.intent_fingerprint},
            )

    def test_terminal_attempt_cannot_be_rewritten_to_pass(self):
        failed = attempt().model_copy(update={"status": "failed_breach", "revision": 8})
        intent = TransitionIntent(
            workspace_id=failed.workspace_id,
            session_id=failed.session_id,
            attempt_id=failed.attempt_id,
            profile_hash=failed.profile_hash,
            intent_id="rewrite-failed",
            expected_revision=8,
            event_sequence=45,
            action="complete_pass",
        )
        with self.assertRaisesRegex(PropSessionContractError, "invalid from failed_breach"):
            apply_transition_intent(failed, intent, {})


class Ps00MoneyOracleTests(unittest.TestCase):
    def test_money_oracle_rejects_initial_capital_drift_from_frozen_phase(self):
        spec = phase()
        with self.assertRaisesRegex(PropSessionContractError, "frozen phase spec"):
            money_oracle(
                spec,
                MoneyOracleInput(
                    initial_capital=Decimal("99999"),
                    daily_anchor=Decimal("100000"),
                    balance_before_separate_costs=Decimal("100000"),
                    high_water_mark=Decimal("100000"),
                ),
            )

    def test_static_daily_boundary_open_pl_costs_swap_and_conversion(self):
        spec = phase(loss_comparator="lt")
        result = money_oracle(
            spec,
            MoneyOracleInput(
                initial_capital=Decimal("100000"),
                daily_anchor=Decimal("102000"),
                balance_before_separate_costs=Decimal("102000"),
                floating_pl=Decimal("-4999.01"),
                high_water_mark=Decimal("106000"),
                fees=Decimal("0.50"),
                swap=Decimal("0.50"),
                conversion_adjustment=Decimal("0.01"),
                accounting="costs_separate",
            ),
        )
        self.assertEqual(result["balance"], Decimal("101999.01"))
        self.assertEqual(result["equity"], Decimal("97000.00"))
        self.assertEqual(result["daily_loss"]["floor"], Decimal("97000"))
        self.assertFalse(result["daily_loss"]["breached"])

        breached = money_oracle(
            spec,
            MoneyOracleInput(
                initial_capital=Decimal("100000"),
                daily_anchor=Decimal("102000"),
                balance_before_separate_costs=Decimal("102000"),
                floating_pl=Decimal("-4999.02"),
                high_water_mark=Decimal("106000"),
                fees=Decimal("0.50"),
                swap=Decimal("0.50"),
                conversion_adjustment=Decimal("0.01"),
                accounting="costs_separate",
            ),
        )
        self.assertEqual(breached["equity"], Decimal("96999.99"))
        self.assertTrue(breached["daily_loss"]["breached"])

    def test_trailing_floor_and_target_precedence_are_independent(self):
        spec = phase(overall_kind="trailing")
        result = money_oracle(
            spec,
            MoneyOracleInput(
                initial_capital=Decimal("100000"),
                daily_anchor=Decimal("112000"),
                balance_before_separate_costs=Decimal("110000"),
                floating_pl=Decimal("-14000.01"),
                high_water_mark=Decimal("106000"),
            ),
        )
        self.assertTrue(result["profit_target"]["hit"])
        self.assertEqual(result["overall_drawdown"]["floor"], Decimal("96000"))
        self.assertTrue(result["overall_drawdown"]["breached"])
        self.assertEqual(result["terminal_precedence"], "failed_breach")

    def test_percentage_threshold_uses_declared_base_and_no_display_rounding(self):
        spec = phase().model_copy(
            update={
                "initial_capital": Decimal("100000.01"),
                "daily_loss": LossRule(
                    threshold=ThresholdValue(percent=Decimal("5"), percent_base="initial_capital"),
                    basis="equity",
                    comparator="lt",
                )
            }
        )
        result = money_oracle(
            spec,
            MoneyOracleInput(
                initial_capital=Decimal("100000.01"),
                daily_anchor=Decimal("102000.00"),
                balance_before_separate_costs=Decimal("97000.0004"),
                floating_pl=Decimal("0"),
                high_water_mark=Decimal("102000"),
            ),
        )
        self.assertEqual(result["daily_loss"]["floor"], Decimal("96999.9995"))
        self.assertFalse(result["daily_loss"]["breached"])

    def test_retained_u6d_evaluator_matches_fixed_amount_oracle_subset(self):
        spec = phase(overall_kind="trailing", loss_comparator="lte")
        retained = evaluate_with_retained_prop_profile(
            profile(spec),
            1,
            {
                "starting_balance": 100000,
                "balance": 102000,
                "equity": 97000,
                "high_water_mark": 106000,
                "daily_start_equity": 102000,
            },
        )
        oracle = money_oracle(
            spec,
            MoneyOracleInput(
                initial_capital=Decimal("100000"),
                daily_anchor=Decimal("102000"),
                balance_before_separate_costs=Decimal("102000"),
                floating_pl=Decimal("-5000"),
                high_water_mark=Decimal("106000"),
            ),
        )
        self.assertEqual(Decimal(str(retained["daily_loss"]["floor"])), oracle["daily_loss"]["floor"])
        self.assertEqual(
            Decimal(str(retained["total_drawdown"]["floor"])),
            oracle["overall_drawdown"]["floor"],
        )
        self.assertEqual(retained["daily_loss"]["breached"], oracle["daily_loss"]["breached"])


class Ps00CalendarOracleTests(unittest.TestCase):
    def test_dst_and_no_tick_days_emit_virtual_reset_boundaries(self):
        spec = phase(reset_timezone="Europe/Prague")
        result = calendar_oracle(
            spec,
            virtual_start_utc=datetime(2026, 3, 27, 12, tzinfo=timezone.utc),
            previous_virtual_utc=datetime(2026, 3, 28, 22, 30, tzinfo=timezone.utc),
            current_virtual_utc=datetime(2026, 3, 30, 1, tzinfo=timezone.utc),
            qualifying_local_dates=[date(2026, 3, 28), date(2026, 3, 29)],
        )
        boundaries = result["reset_boundaries"]
        self.assertEqual(len(boundaries), 2)
        self.assertEqual(boundaries[0]["boundary_utc"], datetime(2026, 3, 28, 23, tzinfo=timezone.utc))
        self.assertEqual(boundaries[1]["boundary_utc"], datetime(2026, 3, 29, 22, tzinfo=timezone.utc))
        self.assertEqual(boundaries[0]["ordered_events"], ["fees_swap", "daily_reset"])
        self.assertEqual(result["qualifying_days"], 2)
        self.assertFalse(result["min_qualifying_days_satisfied"])

    def test_calendar_uses_only_virtual_time_for_deadline(self):
        spec = phase(reset_timezone="UTC", max_calendar_days=2)
        result = calendar_oracle(
            spec,
            virtual_start_utc=datetime(2026, 1, 1, 12, tzinfo=timezone.utc),
            previous_virtual_utc=datetime(2026, 1, 1, 12, tzinfo=timezone.utc),
            current_virtual_utc=datetime(2026, 1, 3, 0, tzinfo=timezone.utc),
        )
        self.assertEqual(result["deadline_utc"], datetime(2026, 1, 3, 0, tzinfo=timezone.utc))
        self.assertTrue(result["expired"])

    def test_rewind_virtual_time_is_rejected(self):
        spec = phase(reset_timezone="UTC")
        with self.assertRaisesRegex(PropSessionContractError, "monotonic"):
            calendar_oracle(
                spec,
                virtual_start_utc=datetime(2026, 1, 1, tzinfo=timezone.utc),
                previous_virtual_utc=datetime(2026, 1, 2, tzinfo=timezone.utc),
                current_virtual_utc=datetime(2026, 1, 1, 23, tzinfo=timezone.utc),
            )

    def test_prop_session_module_has_no_broker_or_wall_clock_imports(self):
        module = V2 / "trading_workspace_v2" / "prop_session.py"
        tree = ast.parse(module.read_text(encoding="utf-8"))
        imports = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imports.add(node.module.split(".")[0])
        self.assertFalse({"execution_service", "mt5_data", "workspace_execution"}.intersection(imports))
        self.assertNotIn("time", imports)


if __name__ == "__main__":
    unittest.main()
