from __future__ import annotations

import os
from pathlib import Path
import sys
import uuid

import pytest

# The foundation reuses framework-independent legacy modules from the project
# root, while the package itself lives under foundation_v2.
FOUNDATION_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = FOUNDATION_ROOT.parent
for path in (FOUNDATION_ROOT, PROJECT_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from trading_workspace_v2.connector_ledger import (  # noqa: E402
    ConnectorLedgerError,
    validate_connection_request,
)
from trading_workspace_v2.notion_projection import (  # noqa: E402
    build_notion_export_intent,
    build_notion_projection,
)
from trading_workspace_v2.store import PostgresStore  # noqa: E402


def _report() -> dict:
    return {
        "schema_version": "prop-attempt-report-v1",
        "mode": "simulation",
        "result_source": "simulation",
        "broker_execution_capability": False,
        "session": {"session_id": "session-ledger", "status": "failed_breach", "revision": 4},
        "profile": {"profile_id": "ps03-generic", "profile_hash": "sha256:profile-ledger"},
        "attempt": {
            "attempt_id": "attempt-ledger",
            "status": "failed_breach",
            "revision": 7,
            "branch_kind": "clean",
            "data_version": "dataset:ps03",
            "cost_version": "cost-v1",
            "engine_version": "replay-v1",
        },
        "phase": {
            "phase_index": 1,
            "balance": "100500",
            "floating_pl": "-6000",
            "equity": "94500",
            "high_water_mark": "101000",
            "qualifying_days": 2,
            "evaluation_quality": "full_for_declared_model",
        },
        "outcome": {
            "status": "failed_breach",
            "terminal": True,
            "terminal_action": "breach",
            "reason_codes": ["daily_loss_breached"],
            "breaches": [{"rule": "daily_loss", "current": None, "floor": "95000", "reference": None}],
        },
        "safety": {
            "simulation_only": True,
            "broker_results_included": False,
            "broker_credentials_included": False,
            "holdout_content_included": False,
        },
        "tutorials": {"answer_keys_exposed": False, "auto_completion_enabled": False},
    }


@pytest.fixture()
def ledger():
    dsn = os.getenv("TW_V2_DATABASE_URL")
    if not dsn:
        pytest.skip("TW_V2_DATABASE_URL is required for connector ledger persistence tests")
    store = PostgresStore(dsn)
    store.initialize()
    workspace_id = "m6-ledger-" + uuid.uuid4().hex[:16]
    store.ensure_workspace(workspace_id)
    return store, workspace_id


def _intent() -> dict:
    projection = build_notion_projection(_report())
    return build_notion_export_intent(
        projection,
        request_id="projection-request-ledger",
        requested_at_utc="2026-09-29T00:00:00Z",
        destination_ref="user-selected:page-ledger",
        destination_selected=True,
    )


def test_validator_rejects_credentials_and_keeps_account_ref_opaque() -> None:
    with pytest.raises(ConnectorLedgerError, match="sensitive field"):
        validate_connection_request(
            workspace_id="workspace-1",
            connector="notion",
            connection_id="connection-1",
            request_id="request-1",
            idempotency_key="idempotency-1",
            account_ref="selected-account-1",
            scopes=["read"],
            metadata={"access_token": "must-not-persist"},
        )


def test_connection_is_idempotent_and_survives_new_store_instance(ledger) -> None:
    store, workspace_id = ledger
    first = store.create_connector_connection(
        workspace_id=workspace_id,
        connection_id="connection-1",
        request_id="request-1",
        idempotency_key="idempotency-1",
        account_ref="selected-account-1",
        scopes=["read"],
        metadata={"label": "manual selection"},
    )
    duplicate = store.create_connector_connection(
        workspace_id=workspace_id,
        connection_id="connection-1",
        request_id="request-1",
        idempotency_key="idempotency-1",
        account_ref="selected-account-1",
        scopes=["read"],
        metadata={"label": "manual selection"},
    )
    assert first["duplicate"] is False
    assert duplicate["duplicate"] is True
    assert duplicate["connection"]["status"] == "pending"

    updated = store.update_connector_connection(
        workspace_id=workspace_id,
        connection_id="connection-1",
        status="unknown",
        expected_revision=1,
    )
    assert updated["connection"]["revision"] == 2
    restored = PostgresStore(os.environ["TW_V2_DATABASE_URL"]).get_connector_connection(
        workspace_id, "connection-1"
    )
    assert restored["status"] == "unknown"
    assert restored["revision"] == 2
    assert restored["account_ref"] == "selected-account-1"


def test_intent_creates_pending_receipt_and_duplicate_is_safe(ledger) -> None:
    store, workspace_id = ledger
    store.create_connector_connection(
        workspace_id=workspace_id,
        connection_id="connection-1",
        request_id="request-connection",
        idempotency_key="idempotency-connection",
        account_ref=None,
        scopes=["read", "write"],
        metadata={},
    )
    intent = _intent()
    first = store.create_connector_intent(
        workspace_id=workspace_id,
        intent_id="intent-1",
        request_id="request-intent",
        idempotency_key="idempotency-intent",
        connection_id="connection-1",
        intent=intent,
    )
    duplicate = store.create_connector_intent(
        workspace_id=workspace_id,
        intent_id="intent-1",
        request_id="request-intent",
        idempotency_key="idempotency-intent",
        connection_id="connection-1",
        intent=intent,
    )
    assert first["duplicate"] is False
    assert duplicate["duplicate"] is True
    assert first["intent"]["mode"] == "PREP_ONLY"
    assert first["intent"]["source_revision_json"] == {"session": 4, "attempt": 7}
    assert first["intent"]["source_content_sha256"].startswith("sha256:")
    assert first["receipt"]["status"] == "pending"
    assert first["receipt"]["external_id"] is None


def test_receipt_statuses_are_revisioned_and_terminal_success_is_immutable(ledger) -> None:
    store, workspace_id = ledger
    store.create_connector_intent(
        workspace_id=workspace_id,
        intent_id="intent-2",
        request_id="request-intent-2",
        idempotency_key="idempotency-intent-2",
        connection_id=None,
        intent=_intent(),
    )
    unknown = store.record_connector_receipt(
        workspace_id=workspace_id,
        intent_id="intent-2",
        status="unknown",
        expected_revision=1,
        response={"provider_state": "not_checked"},
    )
    assert unknown["receipt"]["revision"] == 2
    with pytest.raises(ConnectorLedgerError, match="require external_id"):
        store.record_connector_receipt(
            workspace_id=workspace_id,
            intent_id="intent-2",
            status="succeeded",
            expected_revision=2,
        )
    succeeded = store.record_connector_receipt(
        workspace_id=workspace_id,
        intent_id="intent-2",
        status="succeeded",
        expected_revision=2,
        external_id="notion-page-opaque-1",
        remote_revision="remote-rev-2",
        response={"written_fields": ["generated.mt5_report"]},
    )
    assert succeeded["receipt"]["status"] == "succeeded"
    assert succeeded["receipt"]["revision"] == 3
    assert store.get_connector_intent(workspace_id, "intent-2")["status"] == "succeeded"
    with pytest.raises(ConnectorLedgerError, match="terminal"):
        store.record_connector_receipt(
            workspace_id=workspace_id,
            intent_id="intent-2",
            status="failed",
            expected_revision=3,
            error_code="late-failure",
        )


def test_intent_rejects_non_prep_only_payload(ledger) -> None:
    store, workspace_id = ledger
    bad = _intent()
    bad["status"] = "READY_TO_DISPATCH"
    with pytest.raises(ConnectorLedgerError, match="PREP_ONLY"):
        store.create_connector_intent(
            workspace_id=workspace_id,
            intent_id="intent-bad",
            request_id="request-bad",
            idempotency_key="idempotency-bad",
            connection_id=None,
            intent=bad,
        )
