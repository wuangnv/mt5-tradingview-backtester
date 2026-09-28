"""Durable local lease and fence boundary for owner-absence supervision.

The safety policy consumes lease evidence, but evidence supplied by a caller
must not be mistaken for ownership.  This module provides the small local
compare-and-swap boundary between those two concerns: one active owner can be
acquired, renewed, or released, and an expired lease can only be replaced by
an owner with a new fence token.  The record is written atomically under the
same cross-platform file-lock primitive as the owner-absence journal.

This remains ``PREP_ONLY_OFFLINE``.  It does not spawn a process, renew a
provider/broker credential, send an order, or grant execution capability.  A
host supervisor must still bind the returned lease to its policy snapshot and
journal identity before ticking the reducer.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
from typing import Iterator, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .owner_absence_journal import _exclusive_file_lock


OWNER_ABSENCE_LEASE_SCHEMA = "owner-absence-lease-v1"
LeaseState = Literal["active", "released"]


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime, field_name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must include a timezone")
    return value


class OwnerAbsenceLeaseCorrupt(ValueError):
    """Raised when the persisted lease cannot be trusted."""


class OwnerAbsenceLeaseBusy(RuntimeError):
    """Raised when another unexpired owner already holds the lease."""


class OwnerAbsenceLeaseConflict(RuntimeError):
    """Raised when a stale owner attempts a compare-and-swap mutation."""


class OwnerAbsenceLeaseExpired(OwnerAbsenceLeaseConflict):
    """Raised when an owner attempts to renew an expired lease."""


class OwnerAbsenceLease(BaseModel):
    """Immutable ownership evidence for one fenced host attempt."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    schema_version: Literal["owner-absence-lease-v1"] = OWNER_ABSENCE_LEASE_SCHEMA
    state: LeaseState = "active"
    lease_id: str = Field(min_length=1, max_length=128)
    lease_owner: str = Field(min_length=1, max_length=128)
    fence_token: str = Field(min_length=1, max_length=128)
    acquired_at_utc: datetime
    heartbeat_at_utc: datetime
    expires_at_utc: datetime
    released_at_utc: datetime | None = None
    execution_capability: Literal[False] = False

    @field_validator("acquired_at_utc", "heartbeat_at_utc", "expires_at_utc", "released_at_utc")
    @classmethod
    def validate_times(cls, value: datetime | None, info) -> datetime | None:
        return None if value is None else _aware(value, str(info.field_name))

    @model_validator(mode="after")
    def validate_lifecycle(self) -> "OwnerAbsenceLease":
        if self.heartbeat_at_utc < self.acquired_at_utc:
            raise ValueError("heartbeat_at_utc cannot precede acquired_at_utc")
        if self.state == "active":
            if self.expires_at_utc <= self.heartbeat_at_utc:
                raise ValueError("active lease must expire after its heartbeat")
            if self.released_at_utc is not None:
                raise ValueError("active lease cannot have released_at_utc")
        elif self.released_at_utc is None:
            raise ValueError("released lease requires released_at_utc")
        return self

    def is_active(self, *, now: datetime | None = None) -> bool:
        """Return whether this exact persisted record is currently usable."""

        now_value = _aware(now or _utc_now(), "now")
        return self.state == "active" and self.expires_at_utc > now_value

    def matches(self, other: "OwnerAbsenceLease") -> bool:
        """Compare ownership identity without comparing mutable timestamps."""

        return (
            self.lease_id == other.lease_id
            and self.lease_owner == other.lease_owner
            and self.fence_token == other.fence_token
        )


def _canonical_json(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n").encode("utf-8")


class OwnerAbsenceLeaseStore:
    """Atomically persist one local owner-absence lease.

    The file is a single current-record snapshot.  Every mutation re-reads it
    while holding the lock and compares the caller's lease identity before it
    writes, so an old owner cannot renew or release a newer fence.  A missing
    or malformed record fails closed; it is never silently reset.
    """

    def __init__(self, path: str | Path):
        self.path = Path(path).expanduser().resolve()
        self.lock_path = self.path.with_name(self.path.name + ".lock")

    @contextmanager
    def _lock(self) -> Iterator[None]:
        # Keep lease and journal locking semantics identical on Windows/Linux.
        with _exclusive_file_lock(self.lock_path):
            yield

    def _load_unlocked(self) -> OwnerAbsenceLease | None:
        if not self.path.exists():
            return None
        raw = self.path.read_bytes()
        if not raw or not raw.endswith(b"\n"):
            raise OwnerAbsenceLeaseCorrupt("lease record is empty or truncated")
        try:
            return OwnerAbsenceLease.model_validate_json(raw.decode("utf-8"))
        except (UnicodeDecodeError, TypeError, ValueError) as exc:
            raise OwnerAbsenceLeaseCorrupt("lease record is invalid") from exc

    def load(self) -> OwnerAbsenceLease | None:
        """Return a fully validated lease, or ``None`` when no record exists."""

        with self._lock():
            return self._load_unlocked()

    def _write_unlocked(self, lease: OwnerAbsenceLease) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(f".{self.path.name}.{os.getpid()}.{uuid4().hex}.tmp")
        try:
            with temporary.open("wb") as handle:
                handle.write(_canonical_json(lease.model_dump(mode="json")))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    def acquire(
        self,
        lease_owner: str,
        *,
        ttl_seconds: int = 60,
        now: datetime | None = None,
        fence_token: str | None = None,
    ) -> OwnerAbsenceLease:
        """Acquire the lease or replace an expired/released record.

        Every acquisition receives a fresh ``lease_id`` and fence.  Callers
        may provide a deterministic fence in tests; production callers should
        omit it and use the generated opaque value.
        """

        if not lease_owner or not lease_owner.strip():
            raise ValueError("lease_owner must be non-empty")
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")
        now_value = _aware(now or _utc_now(), "now")
        with self._lock():
            current = self._load_unlocked()
            if current is not None and current.is_active(now=now_value):
                raise OwnerAbsenceLeaseBusy("an unexpired owner-absence lease already exists")
            lease = OwnerAbsenceLease(
                lease_id=uuid4().hex,
                lease_owner=lease_owner.strip(),
                fence_token=(fence_token or uuid4().hex),
                acquired_at_utc=now_value,
                heartbeat_at_utc=now_value,
                expires_at_utc=now_value + timedelta(seconds=ttl_seconds),
            )
            self._write_unlocked(lease)
            return lease

    def _assert_current_unlocked(self, expected: OwnerAbsenceLease) -> OwnerAbsenceLease:
        current = self._load_unlocked()
        if current is None or not current.matches(expected) or current.state != "active":
            raise OwnerAbsenceLeaseConflict("lease identity is no longer current")
        return current

    def renew(
        self,
        expected: OwnerAbsenceLease,
        *,
        ttl_seconds: int = 60,
        now: datetime | None = None,
    ) -> OwnerAbsenceLease:
        """Renew only the currently active fence using compare-and-swap."""

        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")
        now_value = _aware(now or _utc_now(), "now")
        with self._lock():
            current = self._assert_current_unlocked(expected)
            if now_value < current.heartbeat_at_utc:
                raise OwnerAbsenceLeaseConflict("lease clock moved backwards")
            if current.expires_at_utc <= now_value:
                raise OwnerAbsenceLeaseExpired("lease expired before renewal")
            renewed = current.model_copy(
                update={
                    "heartbeat_at_utc": now_value,
                    "expires_at_utc": now_value + timedelta(seconds=ttl_seconds),
                }
            )
            self._write_unlocked(renewed)
            return renewed

    def release(self, expected: OwnerAbsenceLease, *, now: datetime | None = None) -> OwnerAbsenceLease:
        """Release only the current fence; stale owners cannot clear a new one."""

        now_value = _aware(now or _utc_now(), "now")
        with self._lock():
            current = self._assert_current_unlocked(expected)
            if now_value < current.heartbeat_at_utc:
                raise OwnerAbsenceLeaseConflict("lease clock moved backwards")
            released = current.model_copy(update={"state": "released", "released_at_utc": now_value})
            self._write_unlocked(released)
            return released


__all__ = [
    "OWNER_ABSENCE_LEASE_SCHEMA",
    "OwnerAbsenceLease",
    "OwnerAbsenceLeaseBusy",
    "OwnerAbsenceLeaseConflict",
    "OwnerAbsenceLeaseCorrupt",
    "OwnerAbsenceLeaseExpired",
    "OwnerAbsenceLeaseStore",
]
