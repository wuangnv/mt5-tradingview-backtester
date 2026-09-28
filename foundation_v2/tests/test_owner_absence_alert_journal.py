from __future__ import annotations

import json

import pytest

from trading_workspace_v2.owner_absence_alert_journal import (
    OwnerAbsenceAlertJournal,
    OwnerAbsenceAlertJournalConflict,
    OwnerAbsenceAlertJournalCorrupt,
)
from trading_workspace_v2.owner_absence_alerts import WatchdogEvent


def event(event_id: str = "stop-1") -> WatchdogEvent:
    return WatchdogEvent(
        run_id="run-1",
        fence_token="fence-1",
        event_type="stop",
        event_id=event_id,
        severity="P1",
        occurred_at_seconds=100,
    )


def test_missing_outbox_is_safe_and_first_transition_is_durable(tmp_path) -> None:
    path = tmp_path / "alerts.jsonl"
    journal = OwnerAbsenceAlertJournal(path)

    assert journal.load().next_sequence == 1
    appended = journal.transition((event(),), now_seconds=100)

    assert appended.sequence == 1
    assert appended.evaluation.attempt_count == 1
    assert appended.evaluation.execution_capability is False
    assert appended.evaluation.provider_access is False
    assert appended.evaluation.broker_access is False
    restored = OwnerAbsenceAlertJournal(path).load()
    assert restored.next_sequence == 2
    assert restored.ledger.records[0].attempts == 1


def test_replayed_event_is_deduplicated_and_does_not_retry_early(tmp_path) -> None:
    journal = OwnerAbsenceAlertJournal(tmp_path / "alerts.jsonl")
    first = journal.transition((event(),), now_seconds=100)

    second = journal.transition((event(),), now_seconds=101)

    assert second.sequence == 2
    assert second.evaluation.attempt_count == 0
    assert second.evaluation.suppressed_duplicate_count == 1
    assert second.evaluation.alerts == ()
    assert journal.load().ledger.records[0].attempts == 1
    assert first.event_hash != second.event_hash


def test_retry_budget_and_manual_ack_survive_restart(tmp_path) -> None:
    path = tmp_path / "alerts.jsonl"
    journal = OwnerAbsenceAlertJournal(path)
    journal.transition((event(),), now_seconds=100)
    journal.transition((event(),), now_seconds=160)
    final = journal.transition((event(),), now_seconds=400)

    assert final.evaluation.attempt_count == 1
    assert final.evaluation.acknowledgement_required is True
    assert final.evaluation.escalation == "manual_ack"
    restored = OwnerAbsenceAlertJournal(path).load()
    assert restored.ledger.records[0].attempts == 3


def test_expected_revision_blocks_stale_writer(tmp_path) -> None:
    path = tmp_path / "alerts.jsonl"
    journal = OwnerAbsenceAlertJournal(path)
    journal.transition((event(),), now_seconds=100)

    with pytest.raises(OwnerAbsenceAlertJournalConflict):
        journal.transition((event("stop-2"),), now_seconds=101, expected_previous_event_hash=None)


def test_tamper_and_truncated_tail_fail_closed(tmp_path) -> None:
    path = tmp_path / "alerts.jsonl"
    journal = OwnerAbsenceAlertJournal(path)
    journal.transition((event(),), now_seconds=100)

    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["evaluation"]["attempt_count"] = 99
    path.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    with pytest.raises(OwnerAbsenceAlertJournalCorrupt):
        journal.load()

    # A torn final line is never treated as a valid outbox snapshot.
    path.write_bytes(b'{"schema_version":"owner-absence-alert-journal-v1"}')
    with pytest.raises(OwnerAbsenceAlertJournalCorrupt, match="empty or truncated"):
        journal.load()

