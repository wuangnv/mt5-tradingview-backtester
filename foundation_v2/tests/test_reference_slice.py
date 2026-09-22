from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(V2) not in sys.path:
    sys.path.insert(0, str(V2))

from trading_workspace_v2.api import create_app
from trading_workspace_v2.artifacts import ArtifactConflict, ArtifactStore
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
from trading_workspace_v2.contracts import DatasetSource
from trading_workspace_v2.research import ResearchService
from trading_workspace_v2.store import PostgresStore


def fixture_source() -> DatasetSource:
    return DatasetSource(
        source_id="fixture-eurusd",
        provider="synthetic-f6",
        instrument_mapping={"EURUSD": "EURUSD"},
        license_use="qa-only",
        retrieved_at_utc="2026-09-22T00:00:00Z",
        export_settings="deterministic-fixture-v1",
    )


def rows(offset: float) -> list[dict]:
    return [
        {"timestamp": 1_700_000_000 + index * 60, "open": 1.0 + offset, "high": 1.1 + offset, "low": 0.9 + offset, "close": close + offset, "volume": 100 + index}
        for index, close in enumerate((1.0000, 1.0005, 1.0002, 1.0010, 1.0007))
    ]


@unittest.skipUnless(os.getenv("TW_V2_DATABASE_URL") and os.getenv("TW_V2_ARTIFACT_ROOT"), "F6 integration environment not configured")
class ReferenceSliceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dsn = os.environ["TW_V2_DATABASE_URL"]
        cls.artifact_root = os.environ["TW_V2_ARTIFACT_ROOT"]
        cls.store = PostgresStore(cls.dsn)
        cls.store.initialize()
        cls.artifacts = ArtifactStore(cls.artifact_root)
        cls.service = ResearchService(cls.store, cls.artifacts)

    def test_two_tenants_job_worker_api_and_immutable_artifact(self):
        a = self.service.register_dataset(
            workspace_id="tenant-a", source=fixture_source(), instrument_id="EURUSD", timeframe="1m", rows=rows(0.0)
        )
        b = self.service.register_dataset(
            workspace_id="tenant-b", source=fixture_source(), instrument_id="EURUSD", timeframe="1m", rows=rows(0.1)
        )
        self.assertNotEqual(a.artifact_sha256, b.artifact_sha256)

        job_a = self.service.create_job(
            workspace_id="tenant-a", dataset_id=a.dataset_id, strategy_version="close-delta-v1", starting_balance=10_000
        )
        job_b = self.service.create_job(
            workspace_id="tenant-b", dataset_id=b.dataset_id, strategy_version="close-delta-v1", starting_balance=20_000
        )

        first = self.service.run_one()
        second = self.service.run_one()
        self.assertEqual({first.job_id, second.job_id}, {job_a.job_id, job_b.job_id})

        app = create_app(
            dsn=self.dsn,
            artifact_root=self.artifact_root,
            authorization=LocalWorkspaceAuthorization.for_local_owner(["tenant-a", "tenant-b"]),
        )
        with TestClient(app) as client:
            own = client.get(f"/api/v2/research/jobs/{job_a.job_id}", headers={"X-Workspace-Id": "tenant-a"})
            self.assertEqual(own.status_code, 200)
            payload = own.json()
            self.assertEqual(payload["status"], "completed")
            self.assertEqual(payload["result"]["workspace_id"], "tenant-a")
            self.assertEqual(payload["result"]["trade_count"], 4)
            self.assertEqual(payload["result"]["metrics_schema_version"], "metrics-v2")

            cross = client.get(f"/api/v2/research/jobs/{job_a.job_id}", headers={"X-Workspace-Id": "tenant-b"})
            self.assertEqual(cross.status_code, 404)

            wrong_dataset = client.post(
                "/api/v2/research/jobs",
                headers={"X-Workspace-Id": "tenant-b"},
                json={"dataset_id": a.dataset_id, "strategy_version": "close-delta-v1", "starting_balance": 10_000},
            )
            self.assertEqual(wrong_dataset.status_code, 404)

        result_a = self.service.get_result("tenant-a", job_a.job_id)
        self.assertIsNotNone(result_a)
        result_path = self.store.get_job("tenant-a", job_a.job_id).result_path
        with self.assertRaises(ArtifactConflict):
            self.artifacts.write_result("tenant-a", job_a.job_id, result_a)
        self.assertTrue((Path(self.artifact_root) / result_path).exists())


if __name__ == "__main__":
    unittest.main()
