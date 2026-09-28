"""Offline host startup seam for the owner-absence reducer.

``owner_absence_supervisor`` is deliberately side-effect free.  This module
adds the small host-owned boundary that was missing from the P0 audit: a
startup can replay a verified journal, report the safe state, and apply one
policy/identity tick atomically under the journal's OS lock.  It does not
spawn or restart children, acquire or renew leases, call providers, send
orders, or grant execution authority.  A real process manager and alert
channel remain separate, explicit follow-up work.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field

from .owner_absence_journal import (
    OwnerAbsenceJournalEvent,
    OwnerAbsenceJournalConflict,
    OwnerAbsenceJournalState,
    OwnerAbsenceRunJournal,
)
from .owner_absence_supervisor import (
    SupervisorIdentity,
    SupervisorState,
)

if TYPE_CHECKING:
    from .owner_absence_safety import OwnerAbsencePolicy


OWNER_ABSENCE_HOST_SCHEMA = "owner-absence-host-status-v1"


class OwnerAbsenceHostStatus(BaseModel):
    """Verified status returned by a cold start or status read.

    ``ready`` means only that the persisted reducer is in ``running`` state;
    it is not a broker/provider/process-health claim.  The literal capability
    flag makes accidental promotion impossible at serialization boundaries.
    """

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    schema_version: Literal["owner-absence-host-status-v1"] = OWNER_ABSENCE_HOST_SCHEMA
    journal_path: str = Field(min_length=1)
    state: SupervisorState
    active_run_id: str | None = None
    active_fence_token: str | None = None
    restart_count: int = Field(ge=0, strict=True)
    next_sequence: int = Field(ge=1, strict=True)
    last_event_hash: str | None = None
    ready: bool
    execution_capability: Literal[False] = False

    @classmethod
    def from_state(cls, path: Path, state: OwnerAbsenceJournalState) -> "OwnerAbsenceHostStatus":
        snapshot = state.snapshot
        return cls(
            journal_path=str(path),
            state=snapshot.state,
            active_run_id=snapshot.active_run_id,
            active_fence_token=snapshot.active_fence_token,
            restart_count=snapshot.restart_count,
            next_sequence=state.next_sequence,
            last_event_hash=state.last_event_hash,
            ready=snapshot.state == "running",
            # Keep this explicit even if the model is later extended: host
            # startup is never an execution capability boundary.
            execution_capability=False,
        )


@dataclass(frozen=True)
class OwnerAbsenceHostTick:
    """The durable event and resulting verified status for one host tick."""

    event: OwnerAbsenceJournalEvent
    status: OwnerAbsenceHostStatus


class OwnerAbsenceHostSupervisor:
    """Replay and tick one local owner-absence journal.

    The constructor does not create a journal or perform startup work.  Call
    :meth:`cold_start` for a verified snapshot, then :meth:`tick` with fresh
    policy evidence and an explicit fence identity.  ``tick`` reduces and
    appends under one lock acquisition, preventing stale writers from racing
    between replay and persistence.
    """

    def __init__(self, journal_path: str | Path):
        self.journal = OwnerAbsenceRunJournal(journal_path)
        self._booted = False
        self._requires_new_fence = False

    @property
    def journal_path(self) -> Path:
        return self.journal.path

    def _status_from_state(self, state: OwnerAbsenceJournalState) -> OwnerAbsenceHostStatus:
        status = OwnerAbsenceHostStatus.from_state(self.journal.path, state)
        if self._requires_new_fence and status.state == "running":
            # A running persisted attempt is not automatically trusted after
            # a host reboot.  The first post-boot tick must present a fresh
            # fence; the old owner cannot silently continue.
            return status.model_copy(update={"ready": False})
        return status

    def _status_from_event(self, event: OwnerAbsenceJournalEvent) -> OwnerAbsenceHostStatus:
        """Build a coherent post-append status without a second lock/read."""

        snapshot = event.next_snapshot
        return OwnerAbsenceHostStatus(
            journal_path=str(self.journal.path),
            state=snapshot.state,
            active_run_id=snapshot.active_run_id,
            active_fence_token=snapshot.active_fence_token,
            restart_count=snapshot.restart_count,
            next_sequence=event.sequence + 1,
            last_event_hash=event.event_hash,
            ready=snapshot.state == "running",
            execution_capability=False,
        )

    def cold_start(self) -> OwnerAbsenceHostStatus:
        """Replay the complete journal or raise a corruption error.

        A missing journal yields a safe ``new``/not-ready status.  Existing
        bytes are never silently repaired or discarded.
        """

        state = self.journal.load()
        self._booted = True
        self._requires_new_fence = state.snapshot.state == "running"
        return self._status_from_state(state)

    def status(self) -> OwnerAbsenceHostStatus:
        """Read verified status without resetting this host's boot epoch."""

        if not self._booted:
            return self.cold_start()
        return self._status_from_state(self.journal.load())

    def tick(
        self,
        policy: "OwnerAbsencePolicy",
        identity: SupervisorIdentity,
        *,
        now: datetime | None = None,
    ) -> OwnerAbsenceHostTick:
        """Apply one reducer tick and return its durable status.

        The journal transition is atomic with respect to other host callers.
        A corrupt journal or busy lock propagates as a typed failure, leaving
        the existing bytes untouched and therefore fail-closed.
        """

        if not self._booted:
            self.cold_start()
        fresh_fence_after_reboot = False
        if self._requires_new_fence:
            state = self.journal.load()
            persisted = state.snapshot
            if (
                persisted.state == "running"
                and persisted.active_run_id == identity.run_id
                and persisted.active_fence_token == identity.fence_token
            ):
                raise OwnerAbsenceJournalConflict(
                    "cold start requires a new fence before the persisted run can continue"
                )
            # A fresh identity is allowed to enter the reducer.  The reducer
            # records a fail-closed stop for the stale running owner; the next
            # tick with that fresh identity can then perform the explicit
            # recovery/restart transition.
            fresh_fence_after_reboot = True
        event = self.journal.transition(policy, identity, now=now)
        if fresh_fence_after_reboot:
            # Do not consume the boot fence requirement until the stop event is
            # durably appended.  Busy/corrupt/I/O failures must leave the host
            # fail-closed so an old fence cannot slip through on retry.
            self._requires_new_fence = False
        return OwnerAbsenceHostTick(event=event, status=self._status_from_event(event))


__all__ = [
    "OWNER_ABSENCE_HOST_SCHEMA",
    "OwnerAbsenceHostStatus",
    "OwnerAbsenceHostSupervisor",
    "OwnerAbsenceHostTick",
]
