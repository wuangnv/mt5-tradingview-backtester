from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile
import uuid

import pytest
from fastapi.testclient import TestClient

FOUNDATION_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = FOUNDATION_ROOT.parent
for path in (FOUNDATION_ROOT, PROJECT_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from trading_workspace_v2.api import create_app  # noqa: E402
from trading_workspace_v2.auth import LocalWorkspaceAuthorization  # noqa: E402
from trading_workspace_v2.store import PostgresStore  # noqa: E402
from test_m6_connector_ledger import _intent  # noqa: E402


@pytest.fixture()
def api_client():
    dsn = os.getenv("TW_V2_DATABASE_URL")
    if not dsn:
        pytest.skip("TW_V2_DATABASE_URL is required for connector API persistence tests")
    workspace_id = "m6-api-" + uuid.uuid4().hex[:16]
    store = PostgresStore(dsn)
    store.initialize()
    store.ensure_workspace(workspace_id)
    authorization = LocalWorkspaceAuthorization.for_local_owner([workspace_id])
    with tempfile.TemporaryDirectory(prefix="m6-connector-api-") as artifact_root:
        with TestClient(
            create_app(
                dsn=dsn,
                artifact_root=artifact_root,
                authorization=authorization,
                learn_roots={},
            )
        ) as client:
            yield client, workspace_id


def test_connector_api_persists_prep_only_connection_intent_and_receipt(api_client) -> None:
    client, workspace_id = api_client
    headers = {"X-Workspace-Id": workspace_id}
    session = client.get("/api/v2/session/status", headers=headers)
    assert session.status_code == 200
    session_payload = session.json()
    assert session_payload["schema_version"] == "project-session-v1"
    assert session_payload["auth_mode"] == "local-trusted-demo"
    assert session_payload["production_auth"] is False
    assert session_payload["credentials_present"] is False
    assert session_payload["workspace"] == {"id": workspace_id}
    assert session_payload["identity"]["marker"] == "local-owner"
    assert session_payload["session"]["status"] == "signed_in"

    connection = client.post(
        "/api/v2/connectors/notion/connections",
        headers=headers,
        json={
            "connection_id": "connection-api-1",
            "request_id": "request-api-1",
            "idempotency_key": "idempotency-api-1",
            "account_ref": "selected-account-api",
            "scopes": ["read"],
            "metadata": {"label": "local selection"},
        },
    )
    assert connection.status_code == 201
    assert connection.json()["connection"]["status"] == "pending"
    assert connection.json()["connection"]["account_ref"] == "selected-account-api"
    assert connection.json()["connection"]["metadata_json"] == {"label": "local selection"}
    duplicate = client.post(
        "/api/v2/connectors/notion/connections",
        headers=headers,
        json={
            "connection_id": "connection-api-1",
            "request_id": "request-api-1",
            "idempotency_key": "idempotency-api-1",
            "account_ref": "selected-account-api",
            "scopes": ["read"],
            "metadata": {"label": "local selection"},
        },
    )
    assert duplicate.status_code == 201
    assert duplicate.json()["duplicate"] is True

    intent = client.post(
        "/api/v2/connectors/notion/intents",
        headers=headers,
        json={
            "intent_id": "intent-api-1",
            "request_id": "request-intent-api-1",
            "idempotency_key": "idempotency-intent-api-1",
            "connection_id": "connection-api-1",
            "intent": _intent(),
        },
    )
    assert intent.status_code == 201
    assert intent.json()["intent"]["mode"] == "PREP_ONLY"
    assert intent.json()["receipt"]["status"] == "pending"
    assert intent.json()["receipt"]["external_id"] is None

    receipt = client.get(
        "/api/v2/connectors/notion/intents/intent-api-1/receipt",
        headers=headers,
    )
    assert receipt.status_code == 200
    assert receipt.json()["status"] == "pending"

    failed = client.patch(
        "/api/v2/connectors/notion/intents/intent-api-1/receipt",
        headers=headers,
        json={
            "status": "failed",
            "expected_revision": 1,
            "error_code": "adapter_not_configured",
        },
    )
    assert failed.status_code == 200
    assert failed.json()["receipt"]["status"] == "failed"
    assert client.get(
        "/api/v2/connectors/notion/intents/intent-api-1", headers=headers
    ).json()["status"] == "failed"


def test_connector_api_fails_closed_for_unsafe_payload_and_stale_revision(api_client) -> None:
    client, workspace_id = api_client
    headers = {"X-Workspace-Id": workspace_id}
    unsafe = client.post(
        "/api/v2/connectors/notion/connections",
        headers=headers,
        json={
            "connection_id": "connection-unsafe",
            "request_id": "request-unsafe",
            "idempotency_key": "idempotency-unsafe",
            "account_ref": None,
            "scopes": ["read"],
            "metadata": {"access_token": "never-store"},
        },
    )
    assert unsafe.status_code == 422
    assert "sensitive field" in unsafe.json()["detail"]

    connection = client.post(
        "/api/v2/connectors/notion/connections",
        headers=headers,
        json={
            "connection_id": "connection-state-api",
            "request_id": "request-state-api",
            "idempotency_key": "idempotency-state-api",
            "account_ref": None,
            "scopes": ["read"],
            "metadata": {},
        },
    )
    assert connection.status_code == 201
    updated = client.patch(
        "/api/v2/connectors/notion/connections/connection-state-api",
        headers=headers,
        json={"status": "unknown", "expected_revision": 1},
    )
    assert updated.status_code == 200
    stale = client.patch(
        "/api/v2/connectors/notion/connections/connection-state-api",
        headers=headers,
        json={"status": "failed", "expected_revision": 1},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"] == "connector_connection_conflict"
