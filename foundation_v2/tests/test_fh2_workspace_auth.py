from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
for entry in (str(ROOT), str(V2)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from trading_workspace_v2.api import create_app
from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.auth import (
    LocalTrustedIdentityAdapter,
    LocalWorkspaceAuthorization,
    ServerWorkspaceMemberships,
)
from trading_workspace_v2.contracts import DatasetSource
from trading_workspace_v2.research import ResearchService
from trading_workspace_v2.store import PostgresStore


def fixture_source() -> DatasetSource:
    return DatasetSource(
        source_id="fh2-fixture",
        provider="synthetic-fh2",
        instrument_mapping={"EURUSD": "EURUSD"},
        license_use="qa-only",
        retrieved_at_utc="2026-09-22T00:00:00Z",
        export_settings="fh2-auth-v1",
    )


@unittest.skipUnless(os.getenv("TW_V2_DATABASE_URL"), "FH-2 PostgreSQL fixture is not configured")
class FH2WorkspaceAuthorizationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dsn = os.environ["TW_V2_DATABASE_URL"]
        cls.store = PostgresStore(cls.dsn)
        cls.store.initialize()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tw-fh2-auth-")
        suffix = uuid4().hex
        self.workspace_a = f"fh2-a-{suffix}"
        self.workspace_b = f"fh2-b-{suffix}"
        self.identity_id = f"fh2-user-{suffix}"

    def tearDown(self):
        self.temp.cleanup()

    def authorization(self, *workspace_ids: str, identity_id: str | None = None):
        subject = self.identity_id if identity_id is None else identity_id
        memberships = ServerWorkspaceMemberships({self.identity_id: workspace_ids})
        return LocalWorkspaceAuthorization(LocalTrustedIdentityAdapter(subject), memberships)

    def client(self, authorization: LocalWorkspaceAuthorization):
        return TestClient(
            create_app(
                dsn=self.dsn,
                artifact_root=self.temp.name,
                authorization=authorization,
            )
        )

    def test_missing_trusted_identity_is_rejected(self):
        memberships = ServerWorkspaceMemberships({self.identity_id: [self.workspace_a]})
        authorization = LocalWorkspaceAuthorization(LocalTrustedIdentityAdapter(None), memberships)
        with self.client(authorization) as client:
            response = client.get(
                "/api/v2/overview",
                headers={"X-Workspace-Id": self.workspace_a, "X-Local-Identity": self.identity_id},
            )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "trusted_identity_missing")

    def test_workspace_header_is_only_a_request_and_revocation_is_immediate(self):
        authorization = self.authorization(self.workspace_a)
        headers_a = {"X-Workspace-Id": self.workspace_a}
        headers_b = {"X-Workspace-Id": self.workspace_b}

        with self.client(authorization) as client:
            own = client.get("/api/v2/overview", headers=headers_a)
            switched = client.get("/api/v2/overview", headers=headers_b)
            authorization.memberships.revoke(self.identity_id, self.workspace_a)
            revoked = client.get("/api/v2/overview", headers=headers_a)

        self.assertEqual(own.status_code, 200)
        self.assertEqual(switched.status_code, 403)
        self.assertEqual(switched.json()["detail"], "workspace_access_denied")
        self.assertEqual(revoked.status_code, 403)
        self.assertEqual(revoked.json()["detail"], "workspace_access_denied")

    def test_cross_tenant_job_and_completed_artifact_are_not_exposed(self):
        artifacts = ArtifactStore(self.temp.name)
        service = ResearchService(self.store, artifacts)
        dataset_b = service.register_dataset(
            workspace_id=self.workspace_b,
            source=fixture_source(),
            instrument_id="EURUSD",
            timeframe="1m",
            rows=[
                {"timestamp": 1_700_000_000, "open": 1.0, "high": 1.1, "low": 0.9, "close": 1.0, "volume": 10},
                {"timestamp": 1_700_000_060, "open": 1.0, "high": 1.2, "low": 0.9, "close": 1.1, "volume": 11},
            ],
        )
        job_b = service.create_job(
            workspace_id=self.workspace_b,
            dataset_id=dataset_b.dataset_id,
            strategy_version="close-delta-v1",
            starting_balance=10_000,
        )
        claimed = self.store.claim_next_job()
        self.assertIsNotNone(claimed)
        self.assertEqual(claimed.job_id, job_b.job_id)
        result_b = service.execute_claimed(claimed)
        self.assertIsNotNone(result_b)
        self.assertEqual(result_b.workspace_id, self.workspace_b)

        authorization = self.authorization(self.workspace_a)
        with self.client(authorization) as client:
            forbidden_workspace = client.get(
                f"/api/v2/research/jobs/{job_b.job_id}",
                headers={"X-Workspace-Id": self.workspace_b},
            )
            hidden_by_tenant_scope = client.get(
                f"/api/v2/research/jobs/{job_b.job_id}",
                headers={"X-Workspace-Id": self.workspace_a},
            )
            own_catalog = client.get("/api/v2/data/datasets", headers={"X-Workspace-Id": self.workspace_a})

        self.assertEqual(forbidden_workspace.status_code, 403)
        self.assertEqual(hidden_by_tenant_scope.status_code, 404)
        self.assertNotIn("result", hidden_by_tenant_scope.text)
        self.assertEqual(own_catalog.status_code, 200)
        self.assertEqual(own_catalog.json()["items"], [])
        self.assertIsNotNone(service.get_result(self.workspace_b, job_b.job_id))

    def test_cross_tenant_record_id_is_hidden(self):
        record_b = self.store.create_record(
            self.workspace_b,
            "playbook",
            {"name": "tenant-b-only"},
        )
        authorization = self.authorization(self.workspace_a)

        with self.client(authorization) as client:
            hidden_by_tenant_scope = client.get(
                f"/api/v2/playbooks/{record_b['record_id']}",
                headers={"X-Workspace-Id": self.workspace_a},
            )
            forbidden_workspace = client.get(
                f"/api/v2/playbooks/{record_b['record_id']}",
                headers={"X-Workspace-Id": self.workspace_b},
            )

        self.assertEqual(hidden_by_tenant_scope.status_code, 404)
        self.assertEqual(hidden_by_tenant_scope.json()["detail"], "playbook_not_found")
        self.assertEqual(forbidden_workspace.status_code, 403)
        self.assertEqual(forbidden_workspace.json()["detail"], "workspace_access_denied")

    def test_health_discloses_local_only_auth_and_execution_stays_locked(self):
        authorization = self.authorization(self.workspace_a)
        with self.client(authorization) as client:
            health = client.get("/health")
            execution = client.post(
                "/api/v2/execution/intents",
                headers={"X-Workspace-Id": self.workspace_a},
            )

        self.assertEqual(health.status_code, 200)
        auth_status = health.json()["authorization"]
        self.assertTrue(auth_status["local_only"])
        self.assertFalse(auth_status["production_auth"])
        self.assertFalse(auth_status["oauth_or_idp"])
        self.assertFalse(auth_status["database_rls"])
        self.assertFalse(health.json()["execution_capability"])
        self.assertEqual(execution.status_code, 403)
        self.assertEqual(execution.json()["detail"], "broker_execution_locked")


if __name__ == "__main__":
    unittest.main()
