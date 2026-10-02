from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import os
from pathlib import Path
import sys
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

for entry in (Path(__file__).resolve().parents[1], Path(__file__).resolve().parents[2]):
    if str(entry) not in sys.path:
        sys.path.insert(0, str(entry))

from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
from trading_workspace_v2.contracts import ChartAnnotationDelete
from trading_workspace_v2.store import PostgresStore


@pytest.fixture()
def annotation_api(tmp_path):
    dsn = os.getenv("TW_V2_DATABASE_URL")
    if not dsn:
        pytest.skip("TW_V2_DATABASE_URL is required for annotation persistence tests")
    workspace = "annotation-api-" + uuid4().hex
    foreign = workspace + "-foreign"
    app = create_app(dsn=dsn, artifact_root=tmp_path, learn_roots={},
                     authorization=LocalWorkspaceAuthorization.for_local_owner([workspace, foreign]))
    with TestClient(app) as client:
        yield client, app.state.store, workspace, foreign


def draft():
    return {"annotation_type": "zone", "instrument_id": "EURUSD", "timeframe": "1m",
            "anchors": [{"timestamp": 1000, "price": 1.1}, {"timestamp": 1060, "price": 1.2}],
            "cutoff_timestamp": 1060, "source": "replay", "run_id": "annotation-test-session"}


def create(client, workspace):
    response = client.post("/api/v2/chart/annotations", headers={"X-Workspace-Id": workspace}, json=draft())
    assert response.status_code == 201
    return response.json()


@pytest.mark.parametrize("revision", [True, False, "1", 1.0, 0, -1, None])
def test_delete_revision_requires_strict_positive_integer(revision):
    with pytest.raises(ValueError):
        ChartAnnotationDelete(expected_revision=revision)


def test_delete_preserves_history_hides_list_and_cannot_be_revived(annotation_api):
    client, store, workspace, _ = annotation_api
    headers = {"X-Workspace-Id": workspace}
    original = create(client, workspace)
    route = "/api/v2/chart/annotations/" + original["record_id"]
    updated_payload = {**original["payload"], "label": "Reviewed zone"}
    revised = client.post(route + "/revisions", headers=headers,
                          json={"expected_revision": 1, "payload": updated_payload})
    assert revised.status_code == 200
    stale = client.post(route + "/delete", headers=headers, json={"expected_revision": 1})
    assert stale.status_code == 409 and stale.json()["detail"] == "revision_conflict"
    assert store.get_record(workspace, "annotation", original["record_id"])["revision"] == 2
    deleted = client.post(route + "/delete", headers=headers, json={"expected_revision": 2})
    assert deleted.status_code == 200
    tombstone = deleted.json()
    assert tombstone["revision"] == 3 and tombstone["deleted"] is True
    assert tombstone["payload"] == updated_payload
    assert tombstone["created_at_utc"] == original["created_at_utc"]
    assert client.get("/api/v2/chart/annotations", headers=headers).json()["items"] == []
    history = store.list_record_revisions(workspace, "annotation", original["record_id"])
    assert [(version["revision"], version["deleted"]) for version in history] == [(1, False), (2, False), (3, True)]
    assert history[0]["payload"] == original["payload"]
    assert history[1]["payload"] == history[2]["payload"] == updated_payload
    for revision in (2, 3):
        response = client.post(route + "/delete", headers=headers, json={"expected_revision": revision})
        assert response.status_code == 404 and response.json()["detail"] == "annotation_not_found"
    revise_deleted = client.post(route + "/revisions", headers=headers,
                                 json={"expected_revision": 3, "payload": updated_payload})
    assert revise_deleted.status_code == 404
    assert len(store.list_record_revisions(workspace, "annotation", original["record_id"])) == 3


def test_delete_is_tenant_and_record_kind_isolated(annotation_api):
    client, store, workspace, foreign = annotation_api
    original = create(client, workspace)
    store.ensure_workspace(foreign)
    response = client.post("/api/v2/chart/annotations/" + original["record_id"] + "/delete",
                           headers={"X-Workspace-Id": foreign}, json={"expected_revision": 1})
    assert response.status_code == 404
    other_kind = store.create_record(workspace, "replay", {"kind": "fixture-only"})
    response = client.post("/api/v2/chart/annotations/" + other_kind["record_id"] + "/delete",
                           headers={"X-Workspace-Id": workspace}, json={"expected_revision": 1})
    assert response.status_code == 404
    assert store.get_record(workspace, "replay", other_kind["record_id"]) == other_kind
    assert store.get_record(workspace, "annotation", original["record_id"]) == original
    for body in ({"expected_revision": True}, {"expected_revision": "1"},
                 {"expected_revision": 1, "kind": "replay"}):
        response = client.post("/api/v2/chart/annotations/" + original["record_id"] + "/delete",
                               headers={"X-Workspace-Id": workspace}, json=body)
        assert response.status_code == 422


def test_concurrent_delete_and_edit_have_only_one_winner(annotation_api):
    client, store, workspace, _ = annotation_api
    original = create(client, workspace)
    record_id = original["record_id"]

    def edit_or_delete(delete):
        own_store = PostgresStore(os.environ["TW_V2_DATABASE_URL"])
        try:
            if delete:
                return own_store.delete_annotation(workspace, record_id, 1)
            return own_store.update_record(workspace, "annotation", record_id, 1,
                                           {**original["payload"], "label": "Concurrent edit"})
        except (LookupError, RuntimeError) as exc:
            return type(exc).__name__

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(edit_or_delete, [False, True]))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert store.get_record(workspace, "annotation", record_id)["revision"] == 2
    assert len(store.list_record_revisions(workspace, "annotation", record_id)) == 2


def test_edit_receipt_keeps_its_revision_when_another_client_deletes_after_commit(annotation_api, monkeypatch):
    client, store, workspace, _ = annotation_api
    original = create(client, workspace)
    record_id = original["record_id"]
    writer = PostgresStore(os.environ["TW_V2_DATABASE_URL"])
    connect = store.connect
    updated_payload = {**original["payload"], "label": "My committed edit"}

    class DeleteAfterCommit:
        def __init__(self, conn):
            self.conn = conn

        def execute(self, *args, **kwargs):
            return self.conn.execute(*args, **kwargs)

        def commit(self):
            self.conn.commit()
            writer.delete_annotation(workspace, record_id, 2)

    @contextmanager
    def interleaved_connection():
        with connect() as conn:
            yield DeleteAfterCommit(conn)

    monkeypatch.setattr(store, "connect", interleaved_connection)
    receipt = store.update_record(workspace, "annotation", record_id, 1, updated_payload)
    assert receipt["revision"] == 2 and receipt["deleted"] is False
    assert receipt["payload"] == updated_payload
    assert receipt["created_at_utc"] == original["created_at_utc"]
    assert writer.get_record(workspace, "annotation", record_id)["revision"] == 3
    assert writer.get_record(workspace, "annotation", record_id)["deleted"] is True
