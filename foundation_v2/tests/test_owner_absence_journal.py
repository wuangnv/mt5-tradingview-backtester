from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json

import pytest

from trading_workspace_v2.owner_absence_journal import (
    OwnerAbsenceJournalCorrupt,
    OwnerAbsenceRunJournal,
)
from trading_workspace_v2.owner_absence_safety import OwnerAbsencePolicy
from trading_workspace_v2.owner_absence_supervisor import (
    OwnerAbsenceSupervisorSnapshot,
    SupervisorIdentity,
    step_owner_absence_supervisor,
)


UTC = timezone.utc
NOW = datetime(2026, 9, 28, 13, 0, tzinfo=UTC)


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
    return SupervisorIdentity(run_id="research-run-1", fence_token=token)


def start_step():
    return step_owner_absence_supervisor(
        OwnerAbsenceSupervisorSnapshot(), ready_policy(), identity(), now=NOW
    )


def continue_step(started):
    return step_owner_absence_supervisor(
        started.next_snapshot,
        ready_policy(),
        identity(),
        now=NOW + timedelta(seconds=1),
    )


def test_missing_journal_restores_safe_empty_snapshot(tmp_path) -> None:
    state = OwnerAbsenceRunJournal(tmp_path / "runs.jsonl").load()
    assert state.events == ()
    assert state.next_sequence == 1
    assert state.snapshot.state == "new"
    assert state.snapshot.execution_capability is False


def test_append_and_cold_start_restore_hash_chained_state(tmp_path) -> None:
    path = tmp_path / "runs.jsonl"
    journal = OwnerAbsenceRunJournal(path)
    started = start_step()
    first = journal.append_step(started)
    second = journal.append_step(continue_step(started))

    assert first.sequence == 1
    assert second.sequence == 2
    assert second.previous_event_hash == first.event_hash
    restored = journal.load()
    assert restored.next_sequence == 3
    assert restored.last_event_hash == second.event_hash
    assert restored.snapshot == second.next_snapshot
    assert journal.restore_snapshot() == second.next_snapshot


def test_retrying_exact_last_transition_is_idempotent(tmp_path) -> None:
    journal = OwnerAbsenceRunJournal(tmp_path / "runs.jsonl")
    started = start_step()
    first = journal.append_step(started)
    retry = journal.append_step(started)
    assert retry == first
    assert len(journal.load().events) == 1


def test_tampered_event_fails_closed(tmp_path) -> None:
    path = tmp_path / "runs.jsonl"
    journal = OwnerAbsenceRunJournal(path)
    journal.append_step(start_step())
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["next_snapshot"]["state"] = "recovery_required"
    path.write_text(json.dumps(payload) + "\n", encoding="utf-8")

    with pytest.raises(OwnerAbsenceJournalCorrupt, match="hash mismatch"):
        journal.load()


def test_truncated_tail_fails_closed(tmp_path) -> None:
    path = tmp_path / "runs.jsonl"
    journal = OwnerAbsenceRunJournal(path)
    journal.append_step(start_step())
    with path.open("ab") as handle:
        handle.write(b'{"schema_version":"owner-absence-run-journal-v1"')

    with pytest.raises(OwnerAbsenceJournalCorrupt, match="line 2"):
        journal.load()


def test_invalid_transition_is_rejected_before_persisting(tmp_path) -> None:
    path = tmp_path / "runs.jsonl"
    journal = OwnerAbsenceRunJournal(path)
    invalid = start_step().model_copy(update={"action": "continue"})

    with pytest.raises(OwnerAbsenceJournalCorrupt, match="invalid continue transition"):
        journal.append_step(invalid)
    assert not path.exists()
