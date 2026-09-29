"""Local Notion OAuth boundary; credentials and tokens never enter the connector ledger."""

from __future__ import annotations

import hmac
import ipaddress
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import RLock
from urllib.parse import urlencode, urlparse

import httpx


AUTHORIZE_URL = "https://api.notion.com/v1/oauth/authorize"
TOKEN_URL = "https://api.notion.com/v1/oauth/token"
PENDING_TTL = timedelta(minutes=10)


class NotionOAuthError(RuntimeError):
    pass


@dataclass(frozen=True)
class NotionOAuthConfig:
    client_id: str
    client_secret: str
    redirect_uri: str

    @classmethod
    def from_environment(cls) -> NotionOAuthConfig | None:
        names = ("TW_V2_NOTION_CLIENT_ID", "TW_V2_NOTION_CLIENT_SECRET", "TW_V2_NOTION_REDIRECT_URI")
        values = tuple(os.getenv(name, "").strip() for name in names)
        if not any(values):
            return None
        if not all(values):
            raise NotionOAuthError("notion_oauth_configuration_incomplete")
        parsed = urlparse(values[2])
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
            raise NotionOAuthError("notion_oauth_redirect_must_be_loopback")
        if parsed.path != "/api/v2/connectors/notion/oauth/callback" or parsed.query or parsed.fragment:
            raise NotionOAuthError("notion_oauth_redirect_path_invalid")
        return cls(*values)


@dataclass(frozen=True)
class _Pending:
    workspace_id: str
    identity_id: str
    expires_at: datetime


@dataclass(frozen=True)
class _Connection:
    connection_id: str
    workspace_id: str
    identity_id: str
    access_token: str
    connected_at: datetime


class NotionOAuthService:
    """One-process OAuth state and token owner for the local trusted demo app."""

    def __init__(self, config: NotionOAuthConfig | None, *, client: httpx.Client | None = None):
        self.config = config
        self._client = client
        self._lock = RLock()
        self._pending: dict[str, _Pending] = {}
        self._connections: dict[tuple[str, str], _Connection] = {}

    @property
    def available(self) -> bool:
        return self.config is not None

    def begin(self, workspace_id: str, identity_id: str, *, now: datetime | None = None) -> str:
        if self.config is None:
            raise NotionOAuthError("notion_oauth_not_configured")
        now = now or datetime.now(timezone.utc)
        state = secrets.token_urlsafe(32)
        with self._lock:
            self._pending = {key: item for key, item in self._pending.items() if item.expires_at > now}
            self._pending[state] = _Pending(workspace_id, identity_id, now + PENDING_TTL)
        query = urlencode({
            "client_id": self.config.client_id,
            "response_type": "code",
            "owner": "user",
            "redirect_uri": self.config.redirect_uri,
            "state": state,
        })
        return f"{AUTHORIZE_URL}?{query}"

    def complete(
        self, state: str, code: str, *, authorize_workspace, now: datetime | None = None,
    ) -> dict[str, str]:
        if self.config is None:
            raise NotionOAuthError("notion_oauth_not_configured")
        now = now or datetime.now(timezone.utc)
        with self._lock:
            pending = self._pending.pop(state, None)
        if pending is None or pending.expires_at <= now:
            raise NotionOAuthError("notion_oauth_state_invalid_or_expired")
        context = authorize_workspace(pending.workspace_id)
        if not hmac.compare_digest(context.identity.subject, pending.identity_id):
            raise NotionOAuthError("notion_oauth_identity_changed")
        if not code or len(code) > 2048:
            raise NotionOAuthError("notion_oauth_code_invalid")
        client = self._client or httpx.Client(timeout=10.0, follow_redirects=False)
        try:
            response = client.post(
                TOKEN_URL,
                auth=(self.config.client_id, self.config.client_secret),
                json={"grant_type": "authorization_code", "code": code, "redirect_uri": self.config.redirect_uri},
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise NotionOAuthError("notion_oauth_exchange_failed") from exc
        finally:
            if self._client is None:
                client.close()
        token = payload.get("access_token") if isinstance(payload, dict) else None
        if not isinstance(token, str) or not token:
            raise NotionOAuthError("notion_oauth_token_missing")
        connection = _Connection(
            connection_id=f"notion-{secrets.token_urlsafe(18)}",
            workspace_id=pending.workspace_id,
            identity_id=pending.identity_id,
            access_token=token,
            connected_at=now,
        )
        with self._lock:
            self._connections[(pending.workspace_id, pending.identity_id)] = connection
        return {"status": "connected", "connection_id": connection.connection_id}

    def status(self, workspace_id: str, identity_id: str) -> dict[str, object]:
        with self._lock:
            connection = self._connections.get((workspace_id, identity_id))
        return {
            "provider": "notion",
            "oauth_available": self.available,
            "status": "connected" if connection else "disconnected",
            "connection_id": connection.connection_id if connection else None,
            "token_persistence": "process_memory_only",
            "export_mode": "PREP_ONLY",
            "cloud_write": False,
        }

    def disconnect(self, workspace_id: str, identity_id: str) -> None:
        with self._lock:
            self._connections.pop((workspace_id, identity_id), None)


def is_loopback_host(host: str | None) -> bool:
    if host == "localhost":
        return True
    try:
        return bool(host and ipaddress.ip_address(host).is_loopback)
    except ValueError:
        return False
