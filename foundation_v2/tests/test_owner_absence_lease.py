from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from trading_workspace_v2.owner_absence_lease import (
    OwnerAbsenceLeaseBusy,
    OwnerAbsenceLeaseConflict,
    OwnerAbsenceLeaseCorrupt,
    OwnerAbsenceLeaseExpired,
    OwnerAbsenceLeaseStore,
)


UTC = timezone.utc
NOW = datetime(2026, 9, 28, 14, 0, tzinfo=UTC)


def test_acquire_renew_release_is_atomic_and_fail_closed(tmp_path) -> None:
    store = OwnerAbsenceLeaseStore(tmp_path / "owner-absence.lease.json")
    first = store.acquire("host-a", ttl_seconds=30, now=NOW, fence_token="fence-a")

    with pytest.raises(OwnerAbsenceLeaseBusy):
        store.acquire("host-b", now=NOW + timedelta(seconds=1), fence_token="fence-b")

    renewed = store.renew(first, ttl_seconds=30, now=NOW + timedelta(seconds=10))
    assert renewed.fence_token == "fence-a"
    assert renewed.heartbeat_at_utc == NOW + timedelta(seconds=10)
    released = store.release(renewed, now=NOW + timedelta(seconds=11))
    assert released.state == "released"
    assert store.load() == released


def test_expired_lease_can_only_be_replaced_by_a_new_fence(tmp_path) -> None:
    store = OwnerAbsenceLeaseStore(tmp_path / "owner-absence.lease.json")
    first = store.acquire("host-a", ttl_seconds=5, now=NOW, fence_token="fence-a")
    replacement = store.acquire("host-b", now=NOW + timedelta(seconds=6), fence_token="fence-b")

    with pytest.raises(OwnerAbsenceLeaseConflict):
        store.renew(first, now=NOW + timedelta(seconds=7))
    assert replacement.fence_token == "fence-b"
    assert store.load() == replacement


def test_expired_current_owner_cannot_renew(tmp_path) -> None:
    store = OwnerAbsenceLeaseStore(tmp_path / "owner-absence.lease.json")
    first = store.acquire("host-a", ttl_seconds=5, now=NOW, fence_token="fence-a")

    with pytest.raises(OwnerAbsenceLeaseExpired):
        store.renew(first, now=NOW + timedelta(seconds=5))


def test_malformed_or_truncated_lease_never_becomes_available(tmp_path) -> None:
    path = tmp_path / "owner-absence.lease.json"
    store = OwnerAbsenceLeaseStore(path)
    path.write_text("{\"state\":\"active\"}\n", encoding="utf-8")
    with pytest.raises(OwnerAbsenceLeaseCorrupt):
        store.load()

    path.write_bytes(b"not-json")
    with pytest.raises(OwnerAbsenceLeaseCorrupt):
        store.load()


def test_capability_is_literal_false(tmp_path) -> None:
    store = OwnerAbsenceLeaseStore(tmp_path / "owner-absence.lease.json")
    lease = store.acquire("host-a", now=NOW, fence_token="fence-a")
    assert lease.execution_capability is False
