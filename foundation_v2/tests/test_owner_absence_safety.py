from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from trading_workspace_v2.owner_absence_safety import (
    DEFAULT_ABSENT_MODE,
    OwnerAbsencePolicy,
    evaluate_owner_absence,
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


def test_default_is_explicit_research_and_fail_closed() -> None:
    policy = OwnerAbsencePolicy()
    assert policy.mode == DEFAULT_ABSENT_MODE == "research"
    assert policy.execution_capability is False
    decision = evaluate_owner_absence(policy, now=NOW)
    assert decision.decision == "stop"
    assert {
        "kill_switch_active",
        "lease_missing",
        "heartbeat_missing",
        "resource_missing",
        "data_missing",
    } <= set(decision.stop_reasons)


def test_ready_research_and_paper_are_offline_allowances_only() -> None:
    research = evaluate_owner_absence(ready_policy(), now=NOW)
    paper = evaluate_owner_absence(ready_policy(mode="paper"), now=NOW)
    advisory = evaluate_owner_absence(ready_policy(mode="advisory"), now=NOW)
    assert research.decision == "allow"
    assert paper.decision == "allow"
    assert advisory.decision == "allow"
    assert research.execution_capability is False
    assert paper.execution_capability is False


@pytest.mark.parametrize(
    ("field", "reason"),
    [
        ("lease_expires_at_utc", "lease_expired"),
        ("heartbeat_at_utc", "heartbeat_stale"),
        ("resource_checked_at_utc", "resource_stale"),
        ("data_observed_at_utc", "data_stale"),
    ],
)
def test_each_freshness_gate_stops_independently(field: str, reason: str) -> None:
    values = {"heartbeat_max_age_seconds": 60, "resource_max_age_seconds": 60, "data_max_age_seconds": 60}
    if field == "lease_expires_at_utc":
        values[field] = NOW - timedelta(seconds=1)
    else:
        values[field] = NOW - timedelta(seconds=61)
    decision = evaluate_owner_absence(ready_policy(**values), now=NOW)
    assert decision.decision == "stop"
    assert reason in decision.stop_reasons


def test_future_timestamps_and_cutoff_leak_stop() -> None:
    future = evaluate_owner_absence(
        ready_policy(
            heartbeat_at_utc=NOW + timedelta(seconds=1),
            resource_checked_at_utc=NOW + timedelta(seconds=1),
            data_observed_at_utc=NOW + timedelta(seconds=1),
        ),
        now=NOW,
    )
    assert {
        "heartbeat_timestamp_in_future",
        "resource_timestamp_in_future",
        "data_timestamp_in_future",
    } <= set(future.stop_reasons)
    cutoff = evaluate_owner_absence(
        ready_policy(data_cutoff_utc=NOW - timedelta(minutes=2)),
        now=NOW,
    )
    assert cutoff.decision == "stop"
    assert "data_after_cutoff" in cutoff.stop_reasons
    future_cutoff = evaluate_owner_absence(
        ready_policy(data_cutoff_utc=NOW + timedelta(seconds=1)),
        now=NOW,
    )
    assert "cutoff_timestamp_in_future" in future_cutoff.stop_reasons


def test_stop_reason_is_explicit_and_execution_literal_cannot_be_widened() -> None:
    policy = ready_policy(configured_stop_reasons=("configured_stop_reason",))
    decision = evaluate_owner_absence(policy, now=NOW)
    assert decision.stop_reasons == ("configured_stop_reason",)
    with pytest.raises(ValidationError):
        OwnerAbsencePolicy.model_validate({"execution_capability": True})
    with pytest.raises(ValidationError):
        OwnerAbsencePolicy.model_validate({"configured_stop_reasons": ("",)})


def test_times_need_timezone_and_age_limits_are_strict() -> None:
    with pytest.raises(ValidationError, match="heartbeat_at_utc"):
        OwnerAbsencePolicy(heartbeat_at_utc=datetime(2026, 9, 28, 12, 0))
    with pytest.raises(ValidationError):
        OwnerAbsencePolicy(heartbeat_max_age_seconds=True)


def test_decision_model_cannot_be_constructed_in_an_ambiguous_state() -> None:
    from trading_workspace_v2.owner_absence_safety import OwnerAbsenceDecision

    with pytest.raises(ValidationError, match="must explain"):
        OwnerAbsenceDecision(mode="research", decision="stop")
    with pytest.raises(ValidationError, match="cannot contain"):
        OwnerAbsenceDecision(mode="research", decision="allow", stop_reasons=("kill_switch_active",))
