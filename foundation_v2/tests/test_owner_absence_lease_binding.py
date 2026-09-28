from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from trading_workspace_v2.owner_absence_lease import OwnerAbsenceLeaseStore
from trading_workspace_v2.owner_absence_lease_binding import (
    OwnerAbsenceLeaseBindingError,
    bind_owner_absence_lease,
)
from trading_workspace_v2.owner_absence_safety import OwnerAbsencePolicy
from trading_workspace_v2.owner_absence_supervisor import SupervisorIdentity


UTC = timezone.utc
NOW = datetime(2026, 9, 28, 14, 0, tzinfo=UTC)


def test_binding_requires_the_persisted_lease_and_supervisor_fence(tmp_path) -> None:
    lease = OwnerAbsenceLeaseStore(tmp_path / "owner-absence.lease.json").acquire(
        "offline-host", ttl_seconds=30, now=NOW, fence_token="fence-a"
    )
    policy = OwnerAbsencePolicy(
        mode="research",
        kill_switch_active=False,
        lease_id=lease.lease_id,
        lease_owner=lease.lease_owner,
        lease_expires_at_utc=lease.expires_at_utc,
        heartbeat_at_utc=NOW,
        resource_checked_at_utc=NOW,
        data_observed_at_utc=NOW,
    )

    binding = bind_owner_absence_lease(
        policy,
        lease,
        SupervisorIdentity(run_id="host-run-1", fence_token="fence-a"),
        now=NOW + timedelta(seconds=1),
    )

    assert binding.run_id == "host-run-1"
    assert binding.fence_token == "fence-a"
    assert binding.lease_id == lease.lease_id
    assert binding.bound_at_utc == NOW + timedelta(seconds=1)
    assert binding.execution_capability is False


def test_binding_rejects_foreign_fence_and_stale_policy(tmp_path) -> None:
    lease = OwnerAbsenceLeaseStore(tmp_path / "owner-absence.lease.json").acquire(
        "offline-host", ttl_seconds=30, now=NOW, fence_token="fence-a"
    )
    policy = OwnerAbsencePolicy(
        mode="research",
        kill_switch_active=False,
        lease_id="stale-lease",
        lease_owner="other-host",
        lease_expires_at_utc=NOW + timedelta(seconds=10),
        heartbeat_at_utc=NOW,
        resource_checked_at_utc=NOW,
        data_observed_at_utc=NOW,
    )

    with pytest.raises(OwnerAbsenceLeaseBindingError) as error:
        bind_owner_absence_lease(
            policy,
            lease,
            SupervisorIdentity(run_id="host-run-1", fence_token="fence-b"),
            now=NOW + timedelta(seconds=1),
        )

    assert error.value.blockers == (
        "fence_mismatch",
        "policy_lease_id_mismatch",
        "policy_lease_owner_mismatch",
        "policy_lease_expiry_mismatch",
    )


def test_binding_rejects_expired_and_future_leases(tmp_path) -> None:
    store = OwnerAbsenceLeaseStore(tmp_path / "owner-absence.lease.json")
    expired = store.acquire("offline-host", ttl_seconds=5, now=NOW, fence_token="fence-a")
    policy = OwnerAbsencePolicy(
        mode="research",
        kill_switch_active=False,
        lease_id=expired.lease_id,
        lease_owner=expired.lease_owner,
        lease_expires_at_utc=expired.expires_at_utc,
        heartbeat_at_utc=NOW,
        resource_checked_at_utc=NOW,
        data_observed_at_utc=NOW,
    )
    with pytest.raises(OwnerAbsenceLeaseBindingError, match="lease_inactive"):
        bind_owner_absence_lease(
            policy,
            expired,
            SupervisorIdentity(run_id="host-run-1", fence_token="fence-a"),
            now=NOW + timedelta(seconds=5),
        )

    future = store.acquire(
        "offline-host", ttl_seconds=30, now=NOW + timedelta(minutes=1), fence_token="fence-b"
    )
    future_policy = policy.model_copy(
        update={
            "lease_id": future.lease_id,
            "lease_owner": future.lease_owner,
            "lease_expires_at_utc": future.expires_at_utc,
        }
    )
    with pytest.raises(OwnerAbsenceLeaseBindingError) as future_error:
        bind_owner_absence_lease(
            future_policy,
            future,
            SupervisorIdentity(run_id="host-run-1", fence_token="fence-b"),
            now=NOW,
        )
    assert future_error.value.blockers == ("lease_not_yet_acquired", "lease_heartbeat_in_future")
