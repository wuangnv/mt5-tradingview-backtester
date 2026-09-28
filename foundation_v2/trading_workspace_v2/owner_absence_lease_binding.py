"""Bind a persisted owner-absence lease to one host supervisor tick.

``owner_absence_lease`` and ``owner_absence_supervisor`` intentionally have
separate responsibilities: one stores local ownership, while the other
reduces safety evidence.  Without a small binding boundary, a caller could
accidentally evaluate a policy copied from a different lease or continue a
supervisor with a different fence.  This module validates that join without
renewing a lease, touching a process, calling a provider, or granting an
execution capability.

The result is an immutable provenance record for the host runner.  It is
``PREP_ONLY_OFFLINE`` evidence, not a command to start or restart anything.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .owner_absence_lease import OwnerAbsenceLease
from .owner_absence_safety import OwnerAbsencePolicy
from .owner_absence_supervisor import SupervisorIdentity


OWNER_ABSENCE_LEASE_BINDING_SCHEMA = "owner-absence-lease-binding-v1"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime, field_name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must include a timezone")
    return value


class OwnerAbsenceLeaseBindingError(ValueError):
    """Raised when lease, supervisor identity, and policy do not agree."""

    def __init__(self, *blockers: str):
        self.blockers = tuple(dict.fromkeys(blockers)) or ("owner_absence_lease_binding_denied",)
        super().__init__(", ".join(self.blockers))


class OwnerAbsenceLeaseBinding(BaseModel):
    """Verified join between one active lease and one supervisor fence."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, allow_inf_nan=False)

    schema_version: Literal["owner-absence-lease-binding-v1"] = OWNER_ABSENCE_LEASE_BINDING_SCHEMA
    run_id: str = Field(min_length=1, max_length=128)
    fence_token: str = Field(min_length=1, max_length=128)
    lease_id: str = Field(min_length=1, max_length=128)
    lease_owner: str = Field(min_length=1, max_length=128)
    acquired_at_utc: datetime
    heartbeat_at_utc: datetime
    expires_at_utc: datetime
    bound_at_utc: datetime
    execution_capability: Literal[False] = False

    @field_validator(
        "acquired_at_utc",
        "heartbeat_at_utc",
        "expires_at_utc",
        "bound_at_utc",
    )
    @classmethod
    def validate_times(cls, value: datetime) -> datetime:
        return _aware(value, "lease binding timestamp")


def bind_owner_absence_lease(
    policy: OwnerAbsencePolicy,
    lease: OwnerAbsenceLease,
    identity: SupervisorIdentity,
    *,
    now: datetime | None = None,
) -> OwnerAbsenceLeaseBinding:
    """Validate the exact lease/fence/policy join used by a host tick.

    The policy lease fields must match the verified persisted lease byte for
    byte.  A fresh lease with a stale policy, a foreign fence, an expired
    record, or a future-dated record is rejected before the supervisor can use
    it.  This function has no side effects and never renews or acquires the
    lease.
    """

    if not isinstance(policy, OwnerAbsencePolicy):
        raise TypeError("policy must be an OwnerAbsencePolicy")
    if not isinstance(lease, OwnerAbsenceLease):
        raise TypeError("lease must be an OwnerAbsenceLease")
    if not isinstance(identity, SupervisorIdentity):
        raise TypeError("identity must be a SupervisorIdentity")

    now_value = _aware(now or _utc_now(), "now")
    blockers: list[str] = []
    if now_value < lease.acquired_at_utc:
        blockers.append("lease_not_yet_acquired")
    if lease.heartbeat_at_utc > now_value:
        blockers.append("lease_heartbeat_in_future")
    if not lease.is_active(now=now_value):
        blockers.append("lease_inactive")
    if identity.fence_token != lease.fence_token:
        blockers.append("fence_mismatch")

    if policy.lease_id != lease.lease_id:
        blockers.append("policy_lease_id_mismatch")
    if policy.lease_owner != lease.lease_owner:
        blockers.append("policy_lease_owner_mismatch")
    if policy.lease_expires_at_utc != lease.expires_at_utc:
        blockers.append("policy_lease_expiry_mismatch")

    if blockers:
        raise OwnerAbsenceLeaseBindingError(*blockers)

    return OwnerAbsenceLeaseBinding(
        run_id=identity.run_id,
        fence_token=identity.fence_token,
        lease_id=lease.lease_id,
        lease_owner=lease.lease_owner,
        acquired_at_utc=lease.acquired_at_utc,
        heartbeat_at_utc=lease.heartbeat_at_utc,
        expires_at_utc=lease.expires_at_utc,
        bound_at_utc=now_value,
        execution_capability=False,
    )


__all__ = [
    "OWNER_ABSENCE_LEASE_BINDING_SCHEMA",
    "OwnerAbsenceLeaseBinding",
    "OwnerAbsenceLeaseBindingError",
    "bind_owner_absence_lease",
]
