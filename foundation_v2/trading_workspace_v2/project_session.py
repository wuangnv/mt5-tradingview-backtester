"""Typed product-session boundary for the local/demo workspace.

This module models the product's own session separately from any provider OAuth
connection.  It intentionally does not authenticate users, issue bearer tokens,
or persist credentials.  The current foundation can therefore expose a truthful
local/demo state while leaving production authentication as a later boundary.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from typing import Literal


PROJECT_SESSION_SCHEMA_VERSION = "project-session-v1"
LOCAL_DEMO_AUTH_MODE = "local-trusted-demo"

SessionStatus = Literal["signed_in", "signed_out", "expired", "revoked"]
ProviderId = Literal["drive", "notion", "learn"]
ProviderStatus = Literal["disconnected", "oauth_pending", "connected", "expired", "revoked"]


class ProjectSessionError(ValueError):
    """Raised when a local/demo session contract is malformed or misused."""


class SessionInactiveError(ProjectSessionError):
    """Raised when a provider flow is started without an active project session."""


def _utc(value: datetime, field: str) -> datetime:
    if not isinstance(value, datetime):
        raise ProjectSessionError(f"{field} must be a datetime")
    if value.tzinfo is None or value.utcoffset() is None:
        raise ProjectSessionError(f"{field} must be timezone-aware")
    return value.astimezone(timezone.utc)


def _text(value: str, field: str, *, max_length: int = 128) -> str:
    if not isinstance(value, str):
        raise ProjectSessionError(f"{field} must be text")
    normalized = value.strip()
    if not normalized:
        raise ProjectSessionError(f"{field} is required")
    if len(normalized) > max_length:
        raise ProjectSessionError(f"{field} is too long")
    return normalized


def _iso(value: datetime | None) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value is not None else None


@dataclass(frozen=True)
class ProjectSession:
    """An in-memory product session for local/demo use.

    ``production_auth`` is permanently false for this contract.  ``identity_id``
    and ``workspace_id`` identify the trusted local owner and selected workspace;
    they are not proof of a web login.  No token, cookie, password, or secret is
    represented or stored here.
    """

    session_id: str
    identity_id: str
    workspace_id: str
    issued_at_utc: datetime
    expires_at_utc: datetime | None
    status: SessionStatus = "signed_in"
    signed_out_at_utc: datetime | None = None
    auth_mode: Literal["local-trusted-demo"] = LOCAL_DEMO_AUTH_MODE
    production_auth: Literal[False] = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "session_id", _text(self.session_id, "session_id"))
        object.__setattr__(self, "identity_id", _text(self.identity_id, "identity_id"))
        object.__setattr__(self, "workspace_id", _text(self.workspace_id, "workspace_id"))
        issued = _utc(self.issued_at_utc, "issued_at_utc")
        object.__setattr__(self, "issued_at_utc", issued)
        if self.expires_at_utc is not None:
            expires = _utc(self.expires_at_utc, "expires_at_utc")
            if expires <= issued:
                raise ProjectSessionError("expires_at_utc must be after issued_at_utc")
            object.__setattr__(self, "expires_at_utc", expires)
        if self.signed_out_at_utc is not None:
            signed_out = _utc(self.signed_out_at_utc, "signed_out_at_utc")
            if signed_out < issued:
                raise ProjectSessionError("signed_out_at_utc cannot precede issued_at_utc")
            object.__setattr__(self, "signed_out_at_utc", signed_out)
        if not isinstance(self.status, str) or self.status not in {"signed_in", "signed_out", "expired", "revoked"}:
            raise ProjectSessionError("unsupported session status")
        if self.status == "signed_in" and self.signed_out_at_utc is not None:
            raise ProjectSessionError("signed-in session cannot have signed_out_at_utc")
        if self.status == "signed_out" and self.signed_out_at_utc is None:
            raise ProjectSessionError("signed-out session requires signed_out_at_utc")
        if self.status == "expired" and self.expires_at_utc is None:
            raise ProjectSessionError("expired session requires expires_at_utc")
        if self.auth_mode != LOCAL_DEMO_AUTH_MODE or self.production_auth is not False:
            raise ProjectSessionError("project session is local-trusted-demo only")

    @classmethod
    def begin_local_demo(
        cls,
        *,
        session_id: str,
        identity_id: str,
        workspace_id: str,
        now: datetime,
        ttl_seconds: int | None = 3600,
    ) -> "ProjectSession":
        """Create a trusted local/demo session without performing authentication."""
        issued = _utc(now, "now")
        if ttl_seconds is not None:
            if isinstance(ttl_seconds, bool) or not isinstance(ttl_seconds, int) or ttl_seconds <= 0:
                raise ProjectSessionError("ttl_seconds must be a positive integer or None")
            expires = issued + timedelta(seconds=ttl_seconds)
        else:
            expires = None
        return cls(
            session_id=session_id,
            identity_id=identity_id,
            workspace_id=workspace_id,
            issued_at_utc=issued,
            expires_at_utc=expires,
        )

    def status_at(self, now: datetime) -> SessionStatus:
        """Return the effective status at ``now`` without mutating the snapshot."""
        current = _utc(now, "now")
        if self.status == "signed_in" and self.expires_at_utc is not None and current >= self.expires_at_utc:
            return "expired"
        return self.status

    def is_active(self, now: datetime) -> bool:
        return self.status_at(now) == "signed_in"

    def sign_out(self, now: datetime) -> "ProjectSession":
        current = _utc(now, "now")
        effective = self.status_at(current)
        if effective == "signed_out":
            return self
        if effective in {"expired", "revoked"}:
            return replace(self, status=effective)
        return replace(self, status="signed_out", signed_out_at_utc=current)

    def revoke(self) -> "ProjectSession":
        if self.status == "revoked":
            return self
        return replace(self, status="revoked")

    def snapshot(self, now: datetime) -> dict[str, object]:
        effective = self.status_at(now)
        return {
            "schema_version": PROJECT_SESSION_SCHEMA_VERSION,
            "auth_mode": self.auth_mode,
            "production_auth": False,
            "session_id": self.session_id,
            "identity_id": self.identity_id,
            "workspace_id": self.workspace_id,
            "status": effective,
            "issued_at_utc": _iso(self.issued_at_utc),
            "expires_at_utc": _iso(self.expires_at_utc),
            "signed_out_at_utc": _iso(self.signed_out_at_utc),
            "credentials_present": False,
        }


@dataclass(frozen=True)
class ProviderOAuthConnection:
    """Provider connection state, deliberately separate from ``ProjectSession``.

    This is an offline state contract only.  It records a user-selected account
    marker and scopes after a future OAuth callback; it never accepts or emits
    access/refresh tokens.  Product sign-out does not silently revoke a provider
    connection, because those are separate lifecycle authorities.
    """

    provider: ProviderId
    connection_id: str
    status: ProviderStatus = "disconnected"
    account_ref: str | None = None
    scopes: tuple[str, ...] = ()
    oauth_state: str | None = None
    epoch: int = 0

    def __post_init__(self) -> None:
        if not isinstance(self.provider, str) or self.provider not in {"drive", "notion", "learn"}:
            raise ProjectSessionError("unsupported provider")
        object.__setattr__(self, "connection_id", _text(self.connection_id, "connection_id"))
        if not isinstance(self.status, str) or self.status not in {
            "disconnected",
            "oauth_pending",
            "connected",
            "expired",
            "revoked",
        }:
            raise ProjectSessionError("unsupported provider status")
        if self.account_ref is not None:
            object.__setattr__(self, "account_ref", _text(self.account_ref, "account_ref"))
        if not isinstance(self.scopes, (tuple, list)):
            raise ProjectSessionError("scopes must be a tuple or list")
        normalized_scopes = tuple(_text(scope, "scope", max_length=256) for scope in self.scopes)
        object.__setattr__(self, "scopes", normalized_scopes)
        if any(not isinstance(scope, str) or not scope.strip() for scope in self.scopes):
            raise ProjectSessionError("scopes must contain non-empty text")
        if isinstance(self.epoch, bool) or not isinstance(self.epoch, int) or self.epoch < 0:
            raise ProjectSessionError("epoch must be a non-negative integer")
        if self.status == "oauth_pending" and not self.oauth_state:
            raise ProjectSessionError("oauth_pending requires oauth_state")
        if self.oauth_state is not None:
            object.__setattr__(self, "oauth_state", _text(self.oauth_state, "oauth_state"))
        if self.status == "connected" and (not self.account_ref or not self.scopes):
            raise ProjectSessionError("connected provider requires account_ref and scopes")
        if self.status != "oauth_pending" and self.oauth_state is not None:
            raise ProjectSessionError("oauth_state is only valid while oauth_pending")

    @classmethod
    def disconnected(cls, provider: ProviderId, connection_id: str) -> "ProviderOAuthConnection":
        return cls(provider=provider, connection_id=connection_id)

    def begin_oauth(
        self, session: ProjectSession, oauth_state: str, *, now: datetime
    ) -> "ProviderOAuthConnection":
        if not session.is_active(_utc(now, "now")):
            raise SessionInactiveError("active project session required before provider OAuth")
        return replace(self, status="oauth_pending", oauth_state=_text(oauth_state, "oauth_state"))

    def complete_oauth(self, *, account_ref: str, scopes: tuple[str, ...] | list[str]) -> "ProviderOAuthConnection":
        if self.status != "oauth_pending":
            raise ProjectSessionError("OAuth callback is not expected")
        normalized_scopes = tuple(_text(scope, "scope", max_length=256) for scope in scopes)
        if not normalized_scopes:
            raise ProjectSessionError("at least one provider scope is required")
        return replace(
            self,
            status="connected",
            account_ref=_text(account_ref, "account_ref"),
            scopes=normalized_scopes,
            oauth_state=None,
            epoch=self.epoch + 1,
        )

    def revoke(self) -> "ProviderOAuthConnection":
        return replace(self, status="revoked", oauth_state=None, epoch=self.epoch + 1)

    def expire(self) -> "ProviderOAuthConnection":
        return replace(self, status="expired", oauth_state=None)

    def snapshot(self) -> dict[str, object]:
        return {
            "provider": self.provider,
            "connection_id": self.connection_id,
            "status": self.status,
            "account_ref": self.account_ref,
            "scopes": list(self.scopes),
            "epoch": self.epoch,
            "oauth_state_present": self.oauth_state is not None,
            "credentials_present": False,
        }


__all__ = [
    "LOCAL_DEMO_AUTH_MODE",
    "PROJECT_SESSION_SCHEMA_VERSION",
    "ProjectSession",
    "ProjectSessionError",
    "ProviderOAuthConnection",
    "SessionInactiveError",
]
