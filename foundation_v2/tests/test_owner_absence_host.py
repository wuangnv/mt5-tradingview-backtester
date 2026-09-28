from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from trading_workspace_v2.owner_absence_host import OwnerAbsenceHostStatus, OwnerAbsenceHostSupervisor
from trading_workspace_v2.owner_absence_journal import (
    OwnerAbsenceJournalConflict,
    OwnerAbsenceJournalBusy,
    OwnerAbsenceRunJournal,
    _exclusive_file_lock,
)
from trading_workspace_v2.owner_absence_safety import OwnerAbsencePolicy
from trading_workspace_v2.owner_absence_supervisor import (
    OwnerAbsenceSupervisorSnapshot,
    SupervisorIdentity,
    step_owner_absence_supervisor,
)


UTC = timezone.utc
NOW = datetime(2026, 9, 28, 14, 0, tzinfo=UTC)


def ready_policy(**overrides: object) -> OwnerAbsencePolicy:
    values: dict[str, object] = {
        "mode": "research",
        "kill_switch_active": False,
        "lease_id": "lease-1",
        "lease_owner": "offline-worker",
        "lease_expires_at_utc": NOW + timedelta(minutes=5),
        "heartbeat_at_utc": NOW - timedelta(seconds=10),
        "resource_checked_at_utc": NOW - timedelta(seconds=10),
        "data_observed_at_utc": NOW - timedelta(seconds=10),
    }
    values.update(overrides)
    return OwnerAbsencePolicy(**values)


def identity(token: str = "fence-1") -> SupervisorIdentity:
    return SupervisorIdentity(run_id="host-run-1", fence_token=token)


def test_cold_start_is_safe_and_does_not_auto_start(tmp_path) -> None:
    host = OwnerAbsenceHostSupervisor(tmp_path / "owner-absence.jsonl")

    status = host.cold_start()

    assert status.state == "new"
    assert status.ready is False
    assert status.next_sequence == 1
    assert status.execution_capability is False
    assert status.active_run_id is None


def test_tick_reduces_and_persists_under_host_boundary(tmp_path) -> None:
    path = tmp_path / "owner-absence.jsonl"
    host = OwnerAbsenceHostSupervisor(path)

    started = host.tick(ready_policy(), identity(), now=NOW)
    continued = host.tick(ready_policy(), identity(), now=NOW + timedelta(seconds=1))

    assert started.event.action == "start"
    assert started.status.state == "running"
    assert continued.event.action == "continue"
    assert continued.status.next_sequence == 3
    rebooted = OwnerAbsenceHostSupervisor(path).status()
    assert rebooted.state == continued.status.state
    assert rebooted.next_sequence == continued.status.next_sequence
    assert rebooted.ready is False


def test_host_tick_retry_advances_verified_lifecycle(tmp_path) -> None:
    host = OwnerAbsenceHostSupervisor(tmp_path / "owner-absence.jsonl")

    first = host.tick(ready_policy(), identity(), now=NOW)
    retry = host.tick(ready_policy(), identity(), now=NOW)

    # A host retry is a fresh reducer tick after the start event.  Exact
    # same-transition idempotency is provided by ``append_step`` when the
    # caller retries the already-built step (covered by journal tests).
    assert retry.event != first.event
    assert retry.event.action == "continue"
    assert retry.event.sequence == 2
    assert retry.status.next_sequence == 3


def test_reboot_requires_a_fresh_fence_before_continuing(tmp_path) -> None:
    path = tmp_path / "owner-absence.jsonl"
    first_host = OwnerAbsenceHostSupervisor(path)
    first_host.tick(ready_policy(), identity("fence-1"), now=NOW)

    rebooted = OwnerAbsenceHostSupervisor(path)
    assert rebooted.cold_start().ready is False
    with pytest.raises(OwnerAbsenceJournalConflict, match="new fence"):
        rebooted.tick(ready_policy(), identity("fence-1"), now=NOW + timedelta(seconds=1))

    stopped = rebooted.tick(ready_policy(), identity("fence-2"), now=NOW + timedelta(seconds=1))
    assert stopped.event.action == "stop"
    assert stopped.status.state == "recovery_required"
    restarted = rebooted.tick(ready_policy(), identity("fence-2"), now=NOW + timedelta(seconds=2))
    assert restarted.event.action == "restart"
    assert restarted.status.ready is True


def test_reboot_fence_requirement_survives_busy_append(tmp_path) -> None:
    path = tmp_path / "owner-absence.jsonl"
    first_host = OwnerAbsenceHostSupervisor(path)
    first_host.tick(ready_policy(), identity("fence-1"), now=NOW)

    rebooted = OwnerAbsenceHostSupervisor(path)
    rebooted.cold_start()
    journal = OwnerAbsenceRunJournal(path)
    with _exclusive_file_lock(journal.lock_path):
        with pytest.raises(OwnerAbsenceJournalBusy):
            rebooted.tick(ready_policy(), identity("fence-2"), now=NOW + timedelta(seconds=1))

    with pytest.raises(OwnerAbsenceJournalConflict, match="new fence"):
        rebooted.tick(ready_policy(), identity("fence-1"), now=NOW + timedelta(seconds=1))


def test_stale_writer_is_rejected_by_compare_and_swap(tmp_path) -> None:
    journal = OwnerAbsenceRunJournal(tmp_path / "owner-absence.jsonl")
    first = step_owner_absence_supervisor(
        OwnerAbsenceSupervisorSnapshot(), ready_policy(), identity(), now=NOW
    )
    journal.append_step(first, expected_previous_event_hash=None)

    second = step_owner_absence_supervisor(
        first.next_snapshot, ready_policy(), identity(), now=NOW + timedelta(seconds=1)
    )
    with pytest.raises(OwnerAbsenceJournalConflict):
        # ``None`` is an explicit expected revision here: an empty journal was
        # observed, but another writer has already appended the start event.
        journal.append_step(second, expected_previous_event_hash=None)


def test_host_lock_rejects_a_second_writer(tmp_path) -> None:
    journal = OwnerAbsenceRunJournal(tmp_path / "owner-absence.jsonl")

    with _exclusive_file_lock(journal.lock_path):
        with pytest.raises(OwnerAbsenceJournalBusy):
            journal.load()


def test_existing_truncated_tail_never_becomes_ready(tmp_path) -> None:
    path = tmp_path / "owner-absence.jsonl"
    host = OwnerAbsenceHostSupervisor(path)
    host.tick(ready_policy(), identity(), now=NOW)
    path.write_bytes(path.read_bytes().rstrip(b"\n"))

    with pytest.raises(ValueError, match="line 1 is truncated"):
        host.cold_start()


def test_host_status_cannot_be_promoted_to_execution(tmp_path) -> None:
    host = OwnerAbsenceHostSupervisor(tmp_path / "owner-absence.jsonl")
    with pytest.raises(ValidationError):
        payload = host.cold_start().model_dump(mode="json")
        payload["execution_capability"] = True
        OwnerAbsenceHostStatus.model_validate(payload)
