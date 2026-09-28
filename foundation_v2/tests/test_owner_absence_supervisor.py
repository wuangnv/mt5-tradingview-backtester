from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from trading_workspace_v2.owner_absence_safety import OwnerAbsencePolicy
from trading_workspace_v2.owner_absence_supervisor import (
    OwnerAbsenceSupervisorSnapshot,
    SupervisorIdentity,
    step_owner_absence_supervisor,
)


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
