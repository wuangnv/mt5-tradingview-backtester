from __future__ import annotations

import json
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient

FOUNDATION_ROOT = Path(__file__).resolve().parents[1]
for path in (FOUNDATION_ROOT.parent, FOUNDATION_ROOT):
    sys.path.insert(0, str(path))

from trading_workspace_v2.notion_oauth import (
    NotionOAuthConfig,
    NotionOAuthError,
    NotionOAuthService,
    is_loopback_host,
)
from trading_workspace_v2.auth import LocalWorkspaceAuthorization


NOW = datetime(2026, 9, 29, tzinfo=timezone.utc)
CONFIG = NotionOAuthConfig(
    "public-client", "private-secret", "http://127.0.0.1:8010/api/v2/connectors/notion/oauth/callback"
)


def _authorize(workspace_id):
    assert workspace_id == "owner-workspace"
    return SimpleNamespace(identity=SimpleNamespace(subject="local-owner"))


def _state(url):
    parsed = urlparse(url)
    assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == "https://api.notion.com/v1/oauth/authorize"
    query = parse_qs(parsed.query)
    assert query["client_id"] == ["public-client"]
    assert query["redirect_uri"] == [CONFIG.redirect_uri]
    return query["state"][0]


def test_unconfigured_oauth_is_explicit_and_has_no_side_effect():
    service = NotionOAuthService(None)
    assert service.status("owner-workspace", "local-owner")["oauth_available"] is False
    with pytest.raises(NotionOAuthError, match="notion_oauth_not_configured"):
        service.begin("owner-workspace", "local-owner")


def test_oauth_callback_consumes_state_and_keeps_token_out_of_status():
    requests = []

    def exchange(request):
        requests.append(request)
        assert str(request.url) == "https://api.notion.com/v1/oauth/token"
        assert request.headers["authorization"].startswith("Basic ")
        assert json.loads(request.content)["code"] == "one-time-code"
        return httpx.Response(200, json={"access_token": "notion-secret-token", "workspace_id": "external-id"})

    with httpx.Client(transport=httpx.MockTransport(exchange)) as client:
        service = NotionOAuthService(CONFIG, client=client)
        state = _state(service.begin("owner-workspace", "local-owner", now=NOW))
        result = service.complete(state, "one-time-code", authorize_workspace=_authorize, now=NOW)
        status = service.status("owner-workspace", "local-owner")
        assert result["status"] == status["status"] == "connected"
        assert status["export_mode"] == "PREP_ONLY"
        assert status["cloud_write"] is False
        assert "notion-secret-token" not in json.dumps(result) + json.dumps(status)
        with pytest.raises(NotionOAuthError, match="state_invalid_or_expired"):
            service.complete(state, "one-time-code", authorize_workspace=_authorize, now=NOW)
        assert len(requests) == 1
        service.disconnect("owner-workspace", "local-owner")
        assert service.status("owner-workspace", "local-owner")["status"] == "disconnected"


def test_expired_or_wrong_identity_never_exchanges_code():
    with httpx.Client(transport=httpx.MockTransport(lambda _: pytest.fail("provider must not be called"))) as client:
        service = NotionOAuthService(CONFIG, client=client)
        state = _state(service.begin("owner-workspace", "local-owner", now=NOW))
        with pytest.raises(NotionOAuthError, match="state_invalid_or_expired"):
            service.complete(state, "code", authorize_workspace=_authorize, now=NOW + timedelta(minutes=10))
        state = _state(service.begin("owner-workspace", "local-owner", now=NOW))
        with pytest.raises(NotionOAuthError, match="identity_changed"):
            service.complete(
                state, "code",
                authorize_workspace=lambda _: SimpleNamespace(identity=SimpleNamespace(subject="different-owner")),
                now=NOW,
            )


def test_oauth_requires_loopback_redirect_and_request_host(monkeypatch):
    monkeypatch.setenv("TW_V2_NOTION_CLIENT_ID", "id")
    monkeypatch.setenv("TW_V2_NOTION_CLIENT_SECRET", "secret")
    monkeypatch.setenv("TW_V2_NOTION_REDIRECT_URI", "https://example.com/api/v2/connectors/notion/oauth/callback")
    with pytest.raises(NotionOAuthError, match="redirect_must_be_loopback"):
        NotionOAuthConfig.from_environment()
    assert is_loopback_host("127.0.0.1")
    assert is_loopback_host("::1")
    assert not is_loopback_host("example.com")


def test_api_oauth_status_start_callback_and_disconnect(monkeypatch):
    from trading_workspace_v2 import api

    class FakeStore:
        def __init__(self, _dsn):
            pass

        def initialize(self):
            pass

    monkeypatch.setattr(api, "PostgresStore", FakeStore)
    with httpx.Client(transport=httpx.MockTransport(
        lambda _: httpx.Response(200, json={"access_token": "secret-never-in-response"})
    )) as exchange_client:
        service = NotionOAuthService(CONFIG, client=exchange_client)
        with tempfile.TemporaryDirectory() as root:
            app = api.create_app(
                dsn="unused", artifact_root=root,
                authorization=LocalWorkspaceAuthorization.for_local_owner(["owner-workspace"]),
                notion_oauth=service,
            )
            with TestClient(app, client=("127.0.0.1", 50000)) as browser:
                headers = {"X-Workspace-Id": "owner-workspace"}
                assert browser.get("/api/v2/connectors/notion/oauth/status", headers=headers).json()["status"] == "disconnected"
                started = browser.post("/api/v2/connectors/notion/oauth/start", headers=headers)
                assert started.status_code == 200
                state = _state(started.json()["authorization_url"])
                callback = browser.get(
                    "/api/v2/connectors/notion/oauth/callback", params={"state": state, "code": "code"}
                )
                assert callback.status_code == 200
                status = browser.get("/api/v2/connectors/notion/oauth/status", headers=headers).json()
                assert status["status"] == "connected"
                assert "secret-never-in-response" not in json.dumps(status)
                assert browser.post("/api/v2/connectors/notion/oauth/disconnect", headers=headers).json()["status"] == "disconnected"
            with TestClient(app, client=("192.0.2.1", 50000)) as remote:
                assert remote.post("/api/v2/connectors/notion/oauth/start", headers=headers).status_code == 403
                assert remote.get("/api/v2/connectors/notion/oauth/status", headers=headers).status_code == 403
                assert remote.post("/api/v2/connectors/notion/oauth/disconnect", headers=headers).status_code == 403
