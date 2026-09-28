"""Durable, fail-closed journal for owner-absence supervisor transitions.

The owner-absence supervisor is intentionally a pure reducer.  This module is
the smallest persistence boundary around it: every accepted supervisor step is
written as one hash-chained JSONL event and can be replayed after a host crash.
It does not start a worker, renew a lease, call a provider, or grant an
execution capability.  A malformed, truncated, reordered, or tampered journal
raises instead of silently starting a fresh run.

The journal is local and append-only.  The lock is an OS file lock so two host
processes cannot both append from the same sequence number.  ``append_step``
flushes and fsyncs the event before returning; a crash during the write leaves a
detectable corrupt tail and therefore requires explicit operator recovery.
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
from typing import Iterator

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .owner_absence_safety import OwnerAbsenceDecision
from .owner_absence_supervisor import (
    OwnerAbsenceSupervisorSnapshot,
    OwnerAbsenceSupervisorStep,
    SupervisorAction,
    SupervisorState,
)


OWNER_ABSENCE_JOURNAL_SCHEMA = "owner-absence-run-journal-v1"


def _canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _sha256(value: object) -> str:
    return "sha256:" + hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _aware(value: datetime, field_name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must include a timezone")
    return value


class OwnerAbsenceJournalCorrupt(ValueError):
    """Raised when the journal cannot be trusted for a cold start."""


class OwnerAbsenceJournalBusy(RuntimeError):
    """Raised when another host process currently owns the journal lock."""


class OwnerAbsenceJournalEvent(BaseModel):
    """One immutable supervisor transition and its safety evidence."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    schema_version: str = OWNER_ABSENCE_JOURNAL_SCHEMA
    sequence: int = Field(ge=1, strict=True)
    action: SupervisorAction
    previous_state: SupervisorState
    next_snapshot: OwnerAbsenceSupervisorSnapshot
    safety_decision: OwnerAbsenceDecision
    evaluated_at_utc: datetime
    transition_fingerprint: str = Field(min_length=16, max_length=128)
    previous_event_hash: str | None = Field(default=None, min_length=16, max_length=128)
    event_hash: str = Field(min_length=16, max_length=128)

    @field_validator("evaluated_at_utc")
    @classmethod
    def validate_evaluated_at(cls, value: datetime) -> datetime:
        return _aware(value, "evaluated_at_utc")

    @model_validator(mode="after")
    def validate_evidence_timestamp(self) -> "OwnerAbsenceJournalEvent":
        if self.safety_decision.evaluated_at_utc != self.evaluated_at_utc:
            raise ValueError("safety_decision and event timestamps must match")
        if self.next_snapshot.last_transition_at_utc != self.evaluated_at_utc:
            raise ValueError("next_snapshot and event timestamps must match")
        return self

    def integrity_payload(self) -> dict[str, object]:
        """Return the exact canonical payload covered by ``event_hash``."""

        return self.model_dump(mode="json", exclude={"event_hash"})

    def expected_event_hash(self) -> str:
        return _sha256(self.integrity_payload())

    def expected_transition_fingerprint(self) -> str:
        return _sha256(
            self.model_dump(
                mode="json",
                exclude={
                    "sequence",
                    "transition_fingerprint",
                    "previous_event_hash",
                    "event_hash",
                },
            )
        )

    def validate_integrity(self) -> None:
        if self.event_hash != self.expected_event_hash():
            raise OwnerAbsenceJournalCorrupt(f"event {self.sequence} hash mismatch")
        if self.transition_fingerprint != self.expected_transition_fingerprint():
            raise OwnerAbsenceJournalCorrupt(f"event {self.sequence} transition fingerprint mismatch")


@dataclass(frozen=True)
class OwnerAbsenceJournalState:
    """Verified state available to a cold-start caller."""

    events: tuple[OwnerAbsenceJournalEvent, ...]
    snapshot: OwnerAbsenceSupervisorSnapshot
    next_sequence: int
    last_event_hash: str | None


def _event_from_step(
    step: OwnerAbsenceSupervisorStep,
    *,
    sequence: int,
    previous_event_hash: str | None,
) -> OwnerAbsenceJournalEvent:
    # A temporary hash is only used while constructing the immutable event;
    # callers receive the fully hashed copy below.
    values = {
        "sequence": sequence,
        "action": step.action,
        "previous_state": step.previous_state,
        "next_snapshot": step.next_snapshot,
        "safety_decision": step.safety_decision,
        "evaluated_at_utc": step.evaluated_at_utc,
        "transition_fingerprint": "sha256:" + ("0" * 64),
        "previous_event_hash": previous_event_hash,
        "event_hash": "sha256:" + ("0" * 64),
    }
    event = OwnerAbsenceJournalEvent(**values)
    transition_fingerprint = event.expected_transition_fingerprint()
    event = event.model_copy(update={"transition_fingerprint": transition_fingerprint})
    return event.model_copy(update={"event_hash": event.expected_event_hash()})


def _validate_transition(
    event: OwnerAbsenceJournalEvent,
    previous: OwnerAbsenceJournalEvent | None,
) -> None:
    """Reject journals that can skip or invent a lifecycle state."""

    if previous is None:
        if event.sequence != 1 or event.previous_state != "new":
            raise OwnerAbsenceJournalCorrupt("journal must start with a new supervisor state")
    else:
        if event.sequence != previous.sequence + 1:
            raise OwnerAbsenceJournalCorrupt("journal sequence is not contiguous")
        if event.previous_event_hash != previous.event_hash:
            raise OwnerAbsenceJournalCorrupt("journal hash chain is broken")
        if event.previous_state != previous.next_snapshot.state:
            raise OwnerAbsenceJournalCorrupt("journal lifecycle state is not contiguous")

    expected_state = {
        "start": "running",
        "continue": "running",
        "restart": "running",
        "stop": "recovery_required",
        "quarantine": "quarantined",
    }[event.action]
    expected_previous_states: dict[SupervisorAction, set[SupervisorState]] = {
        "start": {"new"},
        "continue": {"running"},
        "restart": {"recovery_required"},
        # A safety failure may be observed on the first tick, while running, or
        # while waiting for a fresh fence.  All of them remain fail-closed.
        "stop": {"new", "running", "recovery_required"},
        "quarantine": {"running", "recovery_required", "quarantined"},
    }
    if event.previous_state not in expected_previous_states[event.action] or event.next_snapshot.state != expected_state:
        raise OwnerAbsenceJournalCorrupt(
            f"event {event.sequence} has invalid {event.action} transition"
        )
    if event.action in {"start", "continue", "restart"} and event.safety_decision.decision != "allow":
        raise OwnerAbsenceJournalCorrupt("running transition cannot carry a stopped safety decision")
    if event.action in {"stop", "quarantine"} and event.safety_decision.decision != "stop":
        raise OwnerAbsenceJournalCorrupt("stop transition must carry a stopped safety decision")


@contextmanager
def _exclusive_file_lock(path: Path) -> Iterator[None]:
    """Take a non-blocking cross-platform lock on one byte of ``path``."""

    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("a+b")
    try:
        handle.seek(0)
        handle.write(b"\0")
        handle.flush()
        handle.seek(0)
        if os.name == "nt":
            import msvcrt

            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as exc:
                raise OwnerAbsenceJournalBusy(f"journal lock is busy: {path}") from exc
        else:
            import fcntl

            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                raise OwnerAbsenceJournalBusy(f"journal lock is busy: {path}") from exc
        yield
    finally:
        try:
            if os.name == "nt":
                import msvcrt

                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()


class OwnerAbsenceRunJournal:
    """Append and recover owner-absence supervisor evidence on local disk."""

    def __init__(self, path: str | Path):
        self.path = Path(path).expanduser().resolve()
        self.lock_path = self.path.with_name(self.path.name + ".lock")

    @staticmethod
    def _empty_state() -> OwnerAbsenceJournalState:
        return OwnerAbsenceJournalState(
            events=(),
            snapshot=OwnerAbsenceSupervisorSnapshot(),
            next_sequence=1,
            last_event_hash=None,
        )

    def _load_unlocked(self) -> OwnerAbsenceJournalState:
        if not self.path.exists():
            return self._empty_state()
        raw = self.path.read_bytes()
        if not raw:
            raise OwnerAbsenceJournalCorrupt("journal exists but is empty")
        try:
            lines = raw.decode("utf-8").splitlines()
        except UnicodeDecodeError as exc:
            raise OwnerAbsenceJournalCorrupt("journal is not valid UTF-8") from exc
        if not lines or any(not line.strip() for line in lines):
            raise OwnerAbsenceJournalCorrupt("journal contains an empty event line")

        events: list[OwnerAbsenceJournalEvent] = []
        previous: OwnerAbsenceJournalEvent | None = None
        for line_number, line in enumerate(lines, start=1):
            try:
                # ``model_validate_json`` retains Pydantic's strict scalar
                # checks while still parsing ISO timestamps from the durable
                # JSON representation.  ``model_validate(dict)`` would reject
                # those timestamp strings under the strict model config.
                event = OwnerAbsenceJournalEvent.model_validate_json(line)
            except (json.JSONDecodeError, TypeError, ValueError) as exc:
                raise OwnerAbsenceJournalCorrupt(f"journal line {line_number} is invalid") from exc
            if event.schema_version != OWNER_ABSENCE_JOURNAL_SCHEMA:
                raise OwnerAbsenceJournalCorrupt(f"journal line {line_number} has an unknown schema")
            event.validate_integrity()
            _validate_transition(event, previous)
            events.append(event)
            previous = event

        assert previous is not None
        return OwnerAbsenceJournalState(
            events=tuple(events),
            snapshot=previous.next_snapshot,
            next_sequence=previous.sequence + 1,
            last_event_hash=previous.event_hash,
        )

    def load(self) -> OwnerAbsenceJournalState:
        """Return only a fully verified state; corruption fails closed."""

        with _exclusive_file_lock(self.lock_path):
            return self._load_unlocked()

    def append_step(self, step: OwnerAbsenceSupervisorStep) -> OwnerAbsenceJournalEvent:
        """Persist one step and return its durable event.

        Retrying the exact last transition is idempotent, which covers the
        common crash window where the fsync completed before the caller saw the
        return value.  A different step always receives the next sequence.
        """

        with _exclusive_file_lock(self.lock_path):
            state = self._load_unlocked()
            candidate = _event_from_step(
                step,
                sequence=state.next_sequence,
                previous_event_hash=state.last_event_hash,
            )
            candidate.validate_integrity()
            if state.events and state.events[-1].transition_fingerprint == candidate.transition_fingerprint:
                return state.events[-1]
            _validate_transition(candidate, state.events[-1] if state.events else None)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            encoded = (_canonical_json(candidate.model_dump(mode="json")) + "\n").encode("utf-8")
            with self.path.open("ab") as handle:
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            return candidate

    def restore_snapshot(self) -> OwnerAbsenceSupervisorSnapshot:
        """Restore the latest trusted snapshot, or a safe empty snapshot."""

        return self.load().snapshot


__all__ = [
    "OWNER_ABSENCE_JOURNAL_SCHEMA",
    "OwnerAbsenceJournalBusy",
    "OwnerAbsenceJournalCorrupt",
    "OwnerAbsenceJournalEvent",
    "OwnerAbsenceJournalState",
    "OwnerAbsenceRunJournal",
]
