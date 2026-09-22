from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
for entry in (str(ROOT), str(V2)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
from trading_workspace_v2.store import PostgresStore


class U3PlaybookJournalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dsn = os.environ["TW_V2_DATABASE_URL"]

    def setUp(self):
        if os.getenv("TW_V2_ALLOW_DESTRUCTIVE_TEST_DB") != "1":
            self.fail("TW_V2_ALLOW_DESTRUCTIVE_TEST_DB=1 is required for TRUNCATE fixture tests")
        self.temp = tempfile.TemporaryDirectory(prefix="tw-u3-test-")
        self.store = PostgresStore(self.dsn)
        self.store.initialize()
        with self.store.connect() as conn:
            conn.execute("TRUNCATE workspace_record_revisions,workspace_records,research_jobs,datasets,workspaces CASCADE")
            conn.commit()
        authorization = LocalWorkspaceAuthorization.for_local_owner(["tenant-a", "tenant-b"])
        self.client = TestClient(
            create_app(dsn=self.dsn, artifact_root=self.temp.name, authorization=authorization)
        )
        self.headers = {"X-Workspace-Id": "tenant-a"}

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def create_draft(self):
        response = self.client.post(
            "/api/v2/playbooks",
            headers=self.headers,
            json={
                "name": "London breakout",
                "status": "draft",
                "execution_capability": "needs-definition",
                "rules": {"entry": "close above range", "skip": "major news"},
            },
        )
        self.assertEqual(response.status_code, 201)
        return response.json()

    def test_frozen_playbook_is_immutable_and_fork_preserves_lineage(self):
        draft = self.create_draft()
        playbook_id = draft["record_id"]
        revised = self.client.post(
            f"/api/v2/playbooks/{playbook_id}/revisions",
            headers=self.headers,
            json={
                "expected_revision": 1,
                "payload": {
                    "name": "London breakout",
                    "status": "draft",
                    "execution_capability": "engine-supported",
                    "rules": {"entry": "close above range", "skip": "major news or stale data"},
                    "parent_playbook_id": None,
                    "parent_revision": None,
                },
            },
        )
        self.assertEqual(revised.status_code, 200)
        frozen = self.client.post(
            f"/api/v2/playbooks/{playbook_id}/freeze",
            headers=self.headers,
            json={"expected_revision": 2},
        )
        self.assertEqual(frozen.status_code, 200)
        self.assertEqual(frozen.json()["payload"]["status"], "frozen")
        self.assertEqual(frozen.json()["revision"], 3)

        rejected = self.client.post(
            f"/api/v2/playbooks/{playbook_id}/revisions",
            headers=self.headers,
            json={"expected_revision": 3, "payload": frozen.json()["payload"]},
        )
        self.assertEqual(rejected.status_code, 409)
        self.assertIn("immutable", rejected.json()["detail"])

        forked = self.client.post(
            f"/api/v2/playbooks/{playbook_id}/fork",
            headers=self.headers,
            json={
                "expected_revision": 3,
                "name": "London breakout v2",
                "rules": {"entry": "close above range and retest", "skip": "major news or stale data"},
            },
        )
        self.assertEqual(forked.status_code, 201)
        payload = forked.json()["payload"]
        self.assertEqual(payload["status"], "draft")
        self.assertEqual(payload["parent_playbook_id"], playbook_id)
        self.assertEqual(payload["parent_revision"], 3)
        self.assertNotEqual(forked.json()["record_id"], playbook_id)

        history = self.client.get(
            f"/api/v2/playbooks/{playbook_id}/revisions", headers=self.headers
        )
        self.assertEqual(history.status_code, 200)
        self.assertEqual([item["revision"] for item in history.json()["items"]], [1, 2, 3])

    def test_lineage_is_server_managed_and_workspace_scoped(self):
        frozen = self.client.post(
            "/api/v2/playbooks",
            headers=self.headers,
            json={
                "name": "Bypass freeze",
                "status": "frozen",
                "execution_capability": "manual-only",
                "rules": {"entry": "manual"},
            },
        )
        self.assertEqual(frozen.status_code, 409)

        injected = self.client.post(
            "/api/v2/playbooks",
            headers=self.headers,
            json={
                "name": "Injected lineage",
                "status": "draft",
                "execution_capability": "manual-only",
                "rules": {"entry": "manual"},
                "parent_playbook_id": "other",
                "parent_revision": 9,
            },
        )
        self.assertEqual(injected.status_code, 422)

        draft = self.create_draft()
        cross = self.client.get(
            f"/api/v2/playbooks/{draft['record_id']}/revisions",
            headers={"X-Workspace-Id": "tenant-b"},
        )
        self.assertEqual(cross.status_code, 404)

    def test_journal_source_is_immutable_while_review_fields_are_revisioned(self):
        created = self.client.post(
            "/api/v2/journal",
            headers=self.headers,
            json={
                "entry_type": "no-trade",
                "note": "Skip because quote is stale",
                "source": {"kind": "replay-decision", "id": "decision-7", "cursor": 12},
                "tags": ["discipline"],
            },
        )
        self.assertEqual(created.status_code, 201)
        record_id = created.json()["record_id"]

        revised_payload = dict(created.json()["payload"])
        revised_payload["note"] = "Skip confirmed after review"
        revised_payload["tags"] = ["discipline", "data-quality"]
        revised = self.client.post(
            f"/api/v2/journal/{record_id}/revisions",
            headers=self.headers,
            json={"expected_revision": 1, "payload": revised_payload},
        )
        self.assertEqual(revised.status_code, 200)
        self.assertEqual(revised.json()["revision"], 2)

        tampered = dict(revised.json()["payload"])
        tampered["source"] = {"kind": "replay-decision", "id": "decision-8", "cursor": 13}
        rejected = self.client.post(
            f"/api/v2/journal/{record_id}/revisions",
            headers=self.headers,
            json={"expected_revision": 2, "payload": tampered},
        )
        self.assertEqual(rejected.status_code, 409)
        self.assertIn("source is immutable", rejected.json()["detail"])

        history = self.client.get(
            f"/api/v2/journal/{record_id}/revisions", headers=self.headers
        )
        self.assertEqual(history.status_code, 200)
        self.assertEqual([item["revision"] for item in history.json()["items"]], [1, 2])
        self.assertEqual(history.json()["items"][0]["payload"]["source"], history.json()["items"][1]["payload"]["source"])


if __name__ == "__main__":
    unittest.main()
