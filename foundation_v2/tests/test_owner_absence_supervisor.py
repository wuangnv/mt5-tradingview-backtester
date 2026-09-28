from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from pydantic import ValidationError

from trading_workspace_v2.owner_absence_safety import OwnerAbsencePolicy
from trading_workspace_v2.owner_absence_supervisor import (
    OwnerAbsencePaperAdmissionError,
    OwnerAbsenceSupervisorSnapshot,
    SupervisorIdentity,
    admit_owner_absence_paper,
    step_owner_absence_supervisor,
)
from trading_workspace_v2.execution_intent_contract import ExecutionIntent
from trading_workspace_v2.risk_promotion_contracts import AITradeMode, RiskBudget


UTC = timezone.utc
NOW = datetime(2026, 9, 28, 12, 0, tzinfo=UTC)


def ready_policy(**overrides: object) -> OwnerAbsencePolicy:
    values: dict[str, object] = {
        "mode": "research",
        "kill_switch_active": False,
        "lease_id": "lease-1",
        "lease_owner": "offline-worker",
        "lease_expires_at_utc": NOW + timedelta(minutes=5),
        "heartbeat_at_utc": NOW - timedelta(seconds=30),
        "resource_checked_at_utc": NOW - timedelta(seconds=30),
        "data_observed_at_utc": NOW - timedelta(seconds=30),
    }
    values.update(overrides)
    return OwnerAbsencePolicy(**values)


def identity(token: str = "fence-1") -> SupervisorIdentity:
    return SupervisorIdentity(run_id="research-run-1", fence_token=token)


def paper_intent() -> ExecutionIntent:
    return ExecutionIntent(
        intent_id="paper-i-1",
        account_id="paper-account",
        mode="paper",
        symbol="BTCUSDT",
        action="open",
        quantity=Decimal("1"),
        risk_budget_hash="budget-v1",
        capability_epoch="epoch-1",
        actor="offline-worker",
        created_at_utc=NOW,
        expires_at_utc=NOW + timedelta(minutes=10),
    )


def paper_budget() -> RiskBudget:
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
        allowed_instruments=("BTCUSDT",),
        effective_from_utc=NOW - timedelta(hours=1),
        expires_at_utc=NOW + timedelta(days=1),
        config_hash="budget-v1",
        approved_by="owner-fixture",
    )


def paper_capability() -> AITradeMode:
    return AITradeMode(
        mode="paper",
        account_id="paper-account",
        allowed_symbols=("BTCUSDT",),
        allowed_actions=("open",),
        risk_budget_hash="budget-v1",
        effective_from_utc=NOW - timedelta(hours=1),
        expires_at_utc=NOW + timedelta(days=1),
        kill_switch_active=False,
        reconciliation_state="ready",
    )


def test_new_run_starts_and_never_grants_execution() -> None:
    step = step_owner_absence_supervisor(
        OwnerAbsenceSupervisorSnapshot(), ready_policy(), identity(), now=NOW
    )
    assert step.action == "start"
    assert step.next_snapshot.state == "running"
    assert step.next_snapshot.restart_count == 0
    assert step.safety_decision.decision == "allow"
    assert step.safety_decision.execution_capability is False


def test_running_run_requires_exact_fence_identity() -> None:
    started = step_owner_absence_supervisor(
        OwnerAbsenceSupervisorSnapshot(), ready_policy(), identity(), now=NOW
    )
    continued = step_owner_absence_supervisor(
        started.next_snapshot, ready_policy(), identity(), now=NOW + timedelta(seconds=1)
    )
    assert continued.action == "continue"
    stale = step_owner_absence_supervisor(
        started.next_snapshot,
        ready_policy(),
        identity("fence-2"),
        now=NOW + timedelta(seconds=2),
    )
    assert stale.action == "stop"
    assert stale.safety_decision.stop_reasons == ("fence_mismatch",)
    assert stale.next_snapshot.state == "recovery_required"


def test_stopped_run_cannot_resume_without_new_fence_then_can_restart() -> None:
    started = step_owner_absence_supervisor(
        OwnerAbsenceSupervisorSnapshot(), ready_policy(), identity(), now=NOW
    )
    stopped = step_owner_absence_supervisor(
        started.next_snapshot,
        ready_policy(kill_switch_active=True),
        identity(),
        now=NOW + timedelta(seconds=1),
    )
    assert stopped.action == "stop"
    same_fence = step_owner_absence_supervisor(
        stopped.next_snapshot,
        ready_policy(),
        identity(),
        now=NOW + timedelta(seconds=2),
    )
    assert same_fence.action == "stop"
    assert "restart_requires_new_fence" in same_fence.safety_decision.stop_reasons
    restarted = step_owner_absence_supervisor(
        stopped.next_snapshot,
        ready_policy(),
        identity("fence-2"),
        now=NOW + timedelta(seconds=3),
    )
    assert restarted.action == "restart"
    assert restarted.next_snapshot.state == "running"
    assert restarted.next_snapshot.restart_count == 1


def test_restart_budget_quarantines_and_cannot_be_bypassed_by_fresh_evidence() -> None:
    snapshot = OwnerAbsenceSupervisorSnapshot(max_restarts=0)
    stopped = step_owner_absence_supervisor(
        snapshot,
        ready_policy(kill_switch_active=True),
        identity(),
        now=NOW,
    )
    assert stopped.action == "quarantine"
    assert stopped.next_snapshot.state == "quarantined"
    assert "restart_budget_exhausted" in stopped.safety_decision.stop_reasons
    quarantined = step_owner_absence_supervisor(
        stopped.next_snapshot,
        ready_policy(),
        identity("fresh-fence"),
        now=NOW + timedelta(seconds=1),
    )
    assert quarantined.action == "quarantine"
    assert quarantined.next_snapshot.state == "quarantined"
    assert "restart_budget_exhausted" in quarantined.safety_decision.stop_reasons


def test_snapshot_rejects_orphan_fence_and_naive_time() -> None:
    with pytest.raises(ValidationError, match="provided together"):
        OwnerAbsenceSupervisorSnapshot(active_fence_token="orphan")
    with pytest.raises(ValidationError, match="provided together"):
        OwnerAbsenceSupervisorSnapshot(active_run_id="orphan")
    with pytest.raises(ValidationError, match="requires an active identity"):
        OwnerAbsenceSupervisorSnapshot(state="running")
    with pytest.raises(ValidationError, match="last_transition_at_utc"):
        OwnerAbsenceSupervisorSnapshot(last_transition_at_utc=datetime(2026, 9, 28, 12, 0))


def test_paper_admission_binds_fenced_run_to_exact_intent() -> None:
    step = step_owner_absence_supervisor(
        OwnerAbsenceSupervisorSnapshot(), ready_policy(mode="paper"), identity(), now=NOW
    )
    admission = admit_owner_absence_paper(
        step,
        paper_intent(),
        paper_capability(),
        paper_budget(),
        active_capability_epoch="epoch-1",
        now=NOW,
    )
    assert admission.run_id == "research-run-1"
    assert admission.fence_token == "fence-1"
    assert admission.intent_id == "paper-i-1"
    assert admission.execution_capability is False
    assert admission.fingerprint().startswith("sha256:")


def test_paper_admission_cannot_be_granted_by_supervisor_or_live_capability_alone() -> None:
    step = step_owner_absence_supervisor(
        OwnerAbsenceSupervisorSnapshot(), ready_policy(mode="research"), identity(), now=NOW
    )
    with pytest.raises(OwnerAbsencePaperAdmissionError) as denied:
        admit_owner_absence_paper(
            step,
            paper_intent(),
            paper_capability(),
            paper_budget(),
            active_capability_epoch="epoch-1",
            now=NOW,
        )
    assert "owner_absence_paper_mode_required" in denied.value.blockers

    paper_step = step_owner_absence_supervisor(
        OwnerAbsenceSupervisorSnapshot(), ready_policy(mode="paper"), identity(), now=NOW
    )
    live_capability = paper_capability().model_copy(update={"mode": "live"})
    with pytest.raises(OwnerAbsencePaperAdmissionError) as live_denied:
        admit_owner_absence_paper(
            paper_step,
            paper_intent(),
            live_capability,
            paper_budget(),
            active_capability_epoch="epoch-1",
            now=NOW,
        )
    assert "paper_capability_required" in live_denied.value.blockers
