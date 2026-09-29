from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
for entry in (str(ROOT), str(V2)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from trading_workspace_v2.project_session import (
    LOCAL_DEMO_AUTH_MODE,
    PROJECT_SESSION_SCHEMA_VERSION,
    ProjectSession,
    ProjectSessionError,
    ProviderOAuthConnection,
    SessionInactiveError,
)


NOW = datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc)


def make_session(*, ttl_seconds: int | None = 60) -> ProjectSession:
    return ProjectSession.begin_local_demo(
        session_id="local-demo-session-001",
        identity_id="local-owner",
        workspace_id="workspace-a",
        now=NOW,
        ttl_seconds=ttl_seconds,
    )


def test_local_demo_snapshot_is_explicit_and_contains_no_credentials():
    session = make_session()
    snapshot = session.snapshot(NOW)

    assert snapshot == {
        "schema_version": PROJECT_SESSION_SCHEMA_VERSION,
        "auth_mode": LOCAL_DEMO_AUTH_MODE,
        "production_auth": False,
        "session_id": "local-demo-session-001",
        "identity_id": "local-owner",
        "workspace_id": "workspace-a",
        "status": "signed_in",
        "issued_at_utc": "2026-09-29T12:00:00Z",
        "expires_at_utc": "2026-09-29T12:01:00Z",
        "signed_out_at_utc": None,
        "credentials_present": False,
    }
    assert not any("token" in key.lower() or "secret" in key.lower() for key in snapshot)


def test_expiry_is_fail_closed_at_exact_deadline_and_preserves_identity_for_audit():
    session = make_session(ttl_seconds=60)
    deadline = NOW + timedelta(seconds=60)

    assert session.is_active(deadline - timedelta(microseconds=1))
    assert not session.is_active(deadline)
    snapshot = session.snapshot(deadline)
    assert snapshot["status"] == "expired"
    assert snapshot["identity_id"] == "local-owner"
    assert snapshot["workspace_id"] == "workspace-a"


def test_terminal_expiry_and_revoke_cannot_become_signed_in_via_sign_out():
    session = make_session(ttl_seconds=1)
    expired = session.sign_out(NOW + timedelta(seconds=1))
    assert expired.status == "expired"
    assert expired.sign_out(NOW + timedelta(seconds=2)).status == "expired"

    revoked = session.revoke()
    assert revoked.sign_out(NOW + timedelta(seconds=2)).status == "revoked"


def test_sign_out_is_explicit_and_idempotent_but_does_not_revoke_provider_connection():
    session = make_session()
    signed_out = session.sign_out(NOW + timedelta(seconds=5))

    assert signed_out.status == "signed_out"
    assert signed_out.signed_out_at_utc == NOW + timedelta(seconds=5)
    assert not signed_out.is_active(NOW + timedelta(seconds=5))
    assert signed_out.sign_out(NOW + timedelta(seconds=6)) == signed_out

    provider = ProviderOAuthConnection.disconnected("drive", "drive-connection-001")
    pending = provider.begin_oauth(session, "state-001", now=NOW)
    connected = pending.complete_oauth(account_ref="user-selected:drive-account", scopes=("drive.file",))
    assert connected.status == "connected"
    assert connected.snapshot()["credentials_present"] is False
    assert connected.status == "connected"  # product sign-out is not provider revocation


def test_provider_oauth_is_separate_and_requires_active_project_session():
    expired = make_session(ttl_seconds=1)
    provider = ProviderOAuthConnection.disconnected("notion", "notion-connection-001")

    with pytest.raises(SessionInactiveError):
        provider.begin_oauth(expired, "state-001", now=NOW + timedelta(seconds=1))

    pending = provider.begin_oauth(make_session(), "state-002", now=NOW)
    assert pending.status == "oauth_pending"
    assert pending.snapshot()["oauth_state_present"] is True
    assert "oauth_state" not in pending.snapshot()


def test_malformed_or_secret_like_values_are_rejected_without_token_storage():
    with pytest.raises(ProjectSessionError):
        make_session(ttl_seconds=0)
    with pytest.raises(ProjectSessionError):
        ProjectSession(
            session_id="expired-without-deadline",
            identity_id="owner",
            workspace_id="workspace",
            issued_at_utc=NOW,
            expires_at_utc=None,
            status="expired",
        )
    with pytest.raises(ProjectSessionError):
        ProjectSession.begin_local_demo(
            session_id="x",
            identity_id="owner",
            workspace_id="workspace",
            now=datetime(2026, 9, 29, 12, 0),
        )
    with pytest.raises(ProjectSessionError):
        ProviderOAuthConnection(
            provider="drive",
            connection_id="conn",
            status="connected",
            account_ref="account",
            scopes=(),
        )
    with pytest.raises(ProjectSessionError):
        ProviderOAuthConnection(
            provider="drive",
            connection_id="conn",
            status="unknown",  # type: ignore[arg-type]
        )


def test_revoke_and_expire_provider_connection_advance_epoch_without_tokens():
    session = make_session()
    connected = (
        ProviderOAuthConnection.disconnected("drive", "drive-connection-002")
        .begin_oauth(session, "state-003", now=NOW)
        .complete_oauth(account_ref="picker:account", scopes=["drive.file"])
    )
    expired = connected.expire()
    revoked = expired.revoke()

    assert expired.status == "expired"
    assert revoked.status == "revoked"
    assert revoked.epoch == connected.epoch + 1
    assert set(revoked.snapshot()) == {
        "provider",
        "connection_id",
        "status",
        "account_ref",
        "scopes",
        "epoch",
        "oauth_state_present",
        "credentials_present",
    }

