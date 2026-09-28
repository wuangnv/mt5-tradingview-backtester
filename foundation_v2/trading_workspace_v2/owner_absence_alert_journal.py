"""Durable, offline outbox journal for owner-absence alert decisions.

``owner_absence_alerts`` deliberately stops at a deterministic retry plan.  A
host still needs a durable place to record that plan before it calls a future
owner/delegate adapter.  This module is that local boundary: it replays a
hash-chained JSONL outbox, evaluates one fenced event batch under an OS lock,
and persists the resulting ledger with ``fsync``.

The module never sends a notification, starts a process, contacts a provider
or broker, or grants execution capability.  A delivery is still true only
when the caller supplies an explicit sink receipt to the pure evaluator.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
from typing import Iterable

from .owner_absence_alerts import (
    WatchdogAlertEvaluation,
    WatchdogAlertLedger,
    WatchdogAlertRecord,
    WatchdogEvent,
    evaluate_alert_events,
)
from .owner_absence_journal import _exclusive_file_lock


OWNER_ABSENCE_ALERT_JOURNAL_SCHEMA = "owner-absence-alert-journal-v1"
_UNSET = object()


class OwnerAbsenceAlertJournalCorrupt(ValueError):
    """Raised when an outbox journal cannot be trusted."""


class OwnerAbsenceAlertJournalConflict(RuntimeError):
    """Raised when a stale caller attempts to append an evaluation."""


def _canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _sha256(value: object) -> str:
    return "sha256:" + hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _key(value: object, name: str = "alert key") -> tuple[str, str, str, str]:
    if not isinstance(value, (tuple, list)) or len(value) != 4:
        raise OwnerAbsenceAlertJournalCorrupt(f"{name} must contain four strings")
    if any(not isinstance(item, str) or not item for item in value):
        raise OwnerAbsenceAlertJournalCorrupt(f"{name} must contain four non-empty strings")
    return tuple(value)  # type: ignore[return-value]


def _seconds(value: object, name: str) -> int:
    if type(value) is not int or value < 0:
        raise OwnerAbsenceAlertJournalCorrupt(f"{name} must be an integer >= 0")
    return value


def _event_payload(event: WatchdogEvent) -> dict[str, object]:
    return {
        "run_id": event.run_id,
        "fence_token": event.fence_token,
        "event_type": event.event_type,
        "event_id": event.event_id,
        "severity": event.severity,
        "occurred_at_seconds": event.occurred_at_seconds,
    }


def _event_from_payload(value: object) -> WatchdogEvent:
    if not isinstance(value, dict):
        raise OwnerAbsenceAlertJournalCorrupt("input event is not an object")
    try:
        return WatchdogEvent(**value)
    except (TypeError, ValueError) as exc:
        raise OwnerAbsenceAlertJournalCorrupt("input event is invalid") from exc


def _record_payload(record: WatchdogAlertRecord) -> dict[str, object]:
    return {
        "key": list(record.key),
        "first_seen_at_seconds": record.first_seen_at_seconds,
        "attempts": record.attempts,
        "delivered": record.delivered,
    }


def _record_from_payload(value: object) -> WatchdogAlertRecord:
    if not isinstance(value, dict):
        raise OwnerAbsenceAlertJournalCorrupt("alert record is not an object")
    try:
        return WatchdogAlertRecord(
            key=_key(value.get("key")),
            first_seen_at_seconds=_seconds(value.get("first_seen_at_seconds"), "first_seen_at_seconds"),
            attempts=value.get("attempts", 0),
            delivered=value.get("delivered", False),
        )
    except (TypeError, ValueError) as exc:
        raise OwnerAbsenceAlertJournalCorrupt("alert record is invalid") from exc


def _ledger_payload(ledger: WatchdogAlertLedger) -> dict[str, object]:
    return {"records": [_record_payload(record) for record in ledger.records]}


def _ledger_from_payload(value: object) -> WatchdogAlertLedger:
    if not isinstance(value, dict) or not isinstance(value.get("records"), list):
        raise OwnerAbsenceAlertJournalCorrupt("ledger is invalid")
    try:
        return WatchdogAlertLedger(records=tuple(_record_from_payload(item) for item in value["records"]))
    except (TypeError, ValueError) as exc:
        raise OwnerAbsenceAlertJournalCorrupt("ledger is invalid") from exc


def _evaluation_payload(evaluation: WatchdogAlertEvaluation) -> dict[str, object]:
    return {
        "state": evaluation.state,
        "escalation": evaluation.escalation,
        "alerts": list(evaluation.alerts),
        "initial_alert_count": evaluation.initial_alert_count,
        "suppressed_duplicate_count": evaluation.suppressed_duplicate_count,
        "attempt_count": evaluation.attempt_count,
        "delivered_count": evaluation.delivered_count,
        "acknowledgement_required": evaluation.acknowledgement_required,
        "next_ledger": _ledger_payload(evaluation.next_ledger),
        "execution_capability": False,
        "provider_access": False,
        "broker_access": False,
    }


def _evaluation_from_payload(value: object) -> WatchdogAlertEvaluation:
    if not isinstance(value, dict):
        raise OwnerAbsenceAlertJournalCorrupt("evaluation is not an object")
    try:
        return WatchdogAlertEvaluation(
            state=value["state"],
            escalation=value.get("escalation"),
            alerts=tuple(value["alerts"]),
            initial_alert_count=value["initial_alert_count"],
            suppressed_duplicate_count=value["suppressed_duplicate_count"],
            attempt_count=value["attempt_count"],
            delivered_count=value["delivered_count"],
            acknowledgement_required=value["acknowledgement_required"],
            next_ledger=_ledger_from_payload(value["next_ledger"]),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise OwnerAbsenceAlertJournalCorrupt("evaluation is invalid") from exc


@dataclass(frozen=True, slots=True)
class OwnerAbsenceAlertJournalEvent:
    sequence: int
    evaluated_at_seconds: int
    input_events: tuple[WatchdogEvent, ...]
    sink_receipts: tuple[tuple[str, str, str, str], ...]
    evaluation: WatchdogAlertEvaluation
    transition_fingerprint: str
    previous_event_hash: str | None
    event_hash: str

    def integrity_payload(self) -> dict[str, object]:
        return {
            "schema_version": OWNER_ABSENCE_ALERT_JOURNAL_SCHEMA,
            "sequence": self.sequence,
            "evaluated_at_seconds": self.evaluated_at_seconds,
            "input_events": [_event_payload(event) for event in self.input_events],
            "sink_receipts": [list(key) for key in self.sink_receipts],
            "evaluation": _evaluation_payload(self.evaluation),
            "transition_fingerprint": self.transition_fingerprint,
            "previous_event_hash": self.previous_event_hash,
        }

    def expected_event_hash(self) -> str:
        return _sha256(self.integrity_payload())

    def expected_transition_fingerprint(self) -> str:
        return _sha256(
            {
                "evaluated_at_seconds": self.evaluated_at_seconds,
                "input_events": [_event_payload(event) for event in self.input_events],
                "sink_receipts": [list(key) for key in self.sink_receipts],
                "evaluation": _evaluation_payload(self.evaluation),
            }
        )

    def validate_integrity(self, previous_ledger: WatchdogAlertLedger) -> None:
        if type(self.sequence) is not int or self.sequence < 1:
            raise OwnerAbsenceAlertJournalCorrupt("alert journal sequence must be >= 1")
        _seconds(self.evaluated_at_seconds, "evaluated_at_seconds")
        if not isinstance(self.transition_fingerprint, str) or not isinstance(self.event_hash, str):
            raise OwnerAbsenceAlertJournalCorrupt("alert event hashes must be strings")
        if self.event_hash != self.expected_event_hash():
            raise OwnerAbsenceAlertJournalCorrupt(f"alert event {self.sequence} hash mismatch")
        if self.transition_fingerprint != self.expected_transition_fingerprint():
            raise OwnerAbsenceAlertJournalCorrupt(
                f"alert event {self.sequence} transition fingerprint mismatch"
            )
        try:
            expected = evaluate_alert_events(
                self.input_events,
                now_seconds=self.evaluated_at_seconds,
                previous_ledger=previous_ledger,
                sink_receipts=self.sink_receipts,
            )
        except (TypeError, ValueError) as exc:
            raise OwnerAbsenceAlertJournalCorrupt(
                f"alert event {self.sequence} contains invalid evaluation inputs"
            ) from exc
        if _evaluation_payload(expected) != _evaluation_payload(self.evaluation):
            raise OwnerAbsenceAlertJournalCorrupt(f"alert event {self.sequence} evaluation mismatch")


@dataclass(frozen=True, slots=True)
class OwnerAbsenceAlertJournalState:
    events: tuple[OwnerAbsenceAlertJournalEvent, ...]
    ledger: WatchdogAlertLedger
    next_sequence: int
    last_event_hash: str | None


def _event_payload_for_storage(event: OwnerAbsenceAlertJournalEvent) -> dict[str, object]:
    payload = event.integrity_payload()
    payload["event_hash"] = event.event_hash
    return payload


def _event_from_payload_for_storage(value: object) -> OwnerAbsenceAlertJournalEvent:
    if not isinstance(value, dict):
        raise OwnerAbsenceAlertJournalCorrupt("alert journal line is not an object")
    try:
        events_value = value["input_events"]
        receipts_value = value["sink_receipts"]
        if not isinstance(events_value, list) or not isinstance(receipts_value, list):
            raise TypeError
        return OwnerAbsenceAlertJournalEvent(
            sequence=value["sequence"],
            evaluated_at_seconds=value["evaluated_at_seconds"],
            input_events=tuple(_event_from_payload(item) for item in events_value),
            sink_receipts=tuple(_key(item, "sink receipt") for item in receipts_value),
            evaluation=_evaluation_from_payload(value["evaluation"]),
            transition_fingerprint=value["transition_fingerprint"],
            previous_event_hash=value.get("previous_event_hash"),
            event_hash=value["event_hash"],
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise OwnerAbsenceAlertJournalCorrupt("alert journal line is invalid") from exc


class OwnerAbsenceAlertJournal:
    """Append and replay one local, hash-chained alert decision outbox."""

    def __init__(self, path: str | Path):
        self.path = Path(path).expanduser().resolve()
        self.lock_path = self.path.with_name(self.path.name + ".lock")

    @staticmethod
    def _empty_state() -> OwnerAbsenceAlertJournalState:
        return OwnerAbsenceAlertJournalState(
            events=(), ledger=WatchdogAlertLedger(), next_sequence=1, last_event_hash=None
        )

    def _load_unlocked(self) -> OwnerAbsenceAlertJournalState:
        if not self.path.exists():
            return self._empty_state()
        raw = self.path.read_bytes()
        if not raw or not raw.endswith(b"\n"):
            raise OwnerAbsenceAlertJournalCorrupt("alert journal is empty or truncated")
        try:
            lines = raw.decode("utf-8").splitlines()
        except UnicodeDecodeError as exc:
            raise OwnerAbsenceAlertJournalCorrupt("alert journal is not valid UTF-8") from exc
        events: list[OwnerAbsenceAlertJournalEvent] = []
        ledger = WatchdogAlertLedger()
        previous_hash: str | None = None
        previous_time = -1
        for line_number, line in enumerate(lines, start=1):
            if not line.strip():
                raise OwnerAbsenceAlertJournalCorrupt(f"alert journal line {line_number} is empty")
            try:
                payload = json.loads(line)
                event = _event_from_payload_for_storage(payload)
            except (json.JSONDecodeError, TypeError, ValueError) as exc:
                raise OwnerAbsenceAlertJournalCorrupt(f"alert journal line {line_number} is invalid") from exc
            if event.sequence != len(events) + 1:
                raise OwnerAbsenceAlertJournalCorrupt("alert journal sequence is not contiguous")
            if event.previous_event_hash != previous_hash:
                raise OwnerAbsenceAlertJournalCorrupt("alert journal hash chain is broken")
            if event.evaluated_at_seconds < previous_time:
                raise OwnerAbsenceAlertJournalCorrupt("alert event time moved backwards")
            try:
                event.validate_integrity(ledger)
            except OwnerAbsenceAlertJournalCorrupt:
                raise
            except (AttributeError, KeyError, TypeError, ValueError) as exc:
                raise OwnerAbsenceAlertJournalCorrupt(
                    f"alert journal line {line_number} failed semantic validation"
                ) from exc
            events.append(event)
            ledger = event.evaluation.next_ledger
            previous_hash = event.event_hash
            previous_time = event.evaluated_at_seconds
        return OwnerAbsenceAlertJournalState(
            events=tuple(events),
            ledger=ledger,
            next_sequence=len(events) + 1,
            last_event_hash=previous_hash,
        )

    def load(self) -> OwnerAbsenceAlertJournalState:
        with _exclusive_file_lock(self.lock_path):
            return self._load_unlocked()

    def transition(
        self,
        events: Iterable[WatchdogEvent],
        *,
        now_seconds: int,
        sink_receipts: Iterable[tuple[str, str, str, str]] = (),
        expected_previous_event_hash: str | None | object = _UNSET,
    ) -> OwnerAbsenceAlertJournalEvent:
        """Evaluate and durably append one alert batch under one lock."""

        with _exclusive_file_lock(self.lock_path):
            state = self._load_unlocked()
            if expected_previous_event_hash is not _UNSET and state.last_event_hash != expected_previous_event_hash:
                raise OwnerAbsenceAlertJournalConflict(
                    "alert journal revision changed; recompute from the verified ledger"
                )
            input_events = tuple(events)
            receipts = tuple(_key(item, "sink receipt") for item in sink_receipts)
            evaluation = evaluate_alert_events(
                input_events,
                now_seconds=now_seconds,
                previous_ledger=state.ledger,
                sink_receipts=receipts,
            )
            temporary = OwnerAbsenceAlertJournalEvent(
                sequence=state.next_sequence,
                evaluated_at_seconds=now_seconds,
                input_events=input_events,
                sink_receipts=receipts,
                evaluation=evaluation,
                transition_fingerprint="sha256:" + ("0" * 64),
                previous_event_hash=state.last_event_hash,
                event_hash="sha256:" + ("0" * 64),
            )
            candidate = OwnerAbsenceAlertJournalEvent(
                sequence=temporary.sequence,
                evaluated_at_seconds=temporary.evaluated_at_seconds,
                input_events=temporary.input_events,
                sink_receipts=temporary.sink_receipts,
                evaluation=temporary.evaluation,
                transition_fingerprint=temporary.expected_transition_fingerprint(),
                previous_event_hash=temporary.previous_event_hash,
                event_hash="sha256:" + ("0" * 64),
            )
            candidate = OwnerAbsenceAlertJournalEvent(
                sequence=candidate.sequence,
                evaluated_at_seconds=candidate.evaluated_at_seconds,
                input_events=candidate.input_events,
                sink_receipts=candidate.sink_receipts,
                evaluation=candidate.evaluation,
                transition_fingerprint=candidate.transition_fingerprint,
                previous_event_hash=candidate.previous_event_hash,
                event_hash=candidate.expected_event_hash(),
            )
            candidate.validate_integrity(state.ledger)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            encoded = (_canonical_json(_event_payload_for_storage(candidate)) + "\n").encode("utf-8")
            with self.path.open("ab") as handle:
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            return candidate


__all__ = [
    "OWNER_ABSENCE_ALERT_JOURNAL_SCHEMA",
    "OwnerAbsenceAlertJournal",
    "OwnerAbsenceAlertJournalConflict",
    "OwnerAbsenceAlertJournalCorrupt",
    "OwnerAbsenceAlertJournalEvent",
    "OwnerAbsenceAlertJournalState",
]
