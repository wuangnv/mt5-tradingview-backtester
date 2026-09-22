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
from trading_workspace_v2.auth import LocalTrustedIdentityAdapter, LocalWorkspaceAuthorization, ServerWorkspaceMemberships
from trading_workspace_v2.contracts import DatasetSource
from trading_workspace_v2.data_sources import DataProviderRegistry, StaticMetadataProvider
from trading_workspace_v2.research import ResearchService
from trading_workspace_v2.store import PostgresStore


@unittest.skipUnless(os.getenv("TW_V2_DATABASE_URL"), "U2 PostgreSQL fixture not configured")
class U2ProviderBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dsn = os.environ["TW_V2_DATABASE_URL"]

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tw-u2-provider-")
        suffix = uuid4().hex
        self.workspace_a = f"u2-a-{suffix}"
        self.workspace_b = f"u2-b-{suffix}"
        self.identity = f"u2-user-{suffix}"

    def tearDown(self):
        self.temp.cleanup()

    def authorization(self, *workspace_ids: str):
        return LocalWorkspaceAuthorization(
            LocalTrustedIdentityAdapter(self.identity),
            ServerWorkspaceMemberships({self.identity: workspace_ids}),
        )

    def client(self, authorization, data_registry=None):
        return TestClient(
            create_app(
                dsn=self.dsn,
                artifact_root=self.temp.name,
                authorization=authorization,
                data_registry=data_registry,
            )
        )

    def test_default_registry_discloses_local_capabilities_without_remote_claims(self):
        with self.client(self.authorization(self.workspace_a)) as client:
            response = client.get("/api/v2/data/providers", headers={"X-Workspace-Id": self.workspace_a})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["items"]), 1)
        provider = response.json()["items"][0]
        self.assertEqual(provider["provider_id"], "local-catalog")
        self.assertTrue(provider["capabilities"]["read_metadata"])
        self.assertFalse(provider["capabilities"]["import"])
        self.assertFalse(provider["capabilities"]["fresh_quote"])
        self.assertFalse(provider["capabilities"]["holdout_content"])

    def test_fake_provider_proves_replacement_and_keeps_workspace_scope(self):
        registry = DataProviderRegistry(
            [
                StaticMetadataProvider(
                    "offline-fake",
                    {
                        self.workspace_a: [{"dataset_id": "a-only", "stale": True}],
                        self.workspace_b: [{"dataset_id": "b-only", "stale": False}],
                    },
                )
            ]
        )
        with self.client(self.authorization(self.workspace_a), registry) as client:
            response = client.get("/api/v2/data/datasets", headers={"X-Workspace-Id": self.workspace_a})
            forbidden = client.get("/api/v2/data/datasets", headers={"X-Workspace-Id": self.workspace_b})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["items"],
            [{"dataset_id": "a-only", "stale": True, "provider_id": "offline-fake"}],
        )
        self.assertEqual(forbidden.status_code, 403)
        self.assertNotIn("b-only", forbidden.text)

    def test_local_catalog_exposes_only_the_authorized_workspace_dataset(self):
        store = PostgresStore(self.dsn)
        store.initialize()
        service = ResearchService(store, ArtifactStore(self.temp.name))
        dataset = service.register_dataset(
            workspace_id=self.workspace_a,
            source=DatasetSource(
                source_id="u2-provider-fixture",
                provider="offline-fixture",
                instrument_mapping={"EURUSD": "EURUSD"},
                license_use="qa-only",
                retrieved_at_utc="2026-09-22T00:00:00Z",
                export_settings="provider-boundary-v1",
            ),
            instrument_id="EURUSD",
            timeframe="1m",
            rows=[
                {"timestamp": 1_700_000_000, "open": 1.0, "high": 1.1, "low": 0.9, "close": 1.0, "volume": 10},
                {"timestamp": 1_700_000_060, "open": 1.0, "high": 1.2, "low": 0.9, "close": 1.1, "volume": 11},
            ],
        )

        with self.client(self.authorization(self.workspace_a)) as client:
            response = client.get("/api/v2/data/datasets", headers={"X-Workspace-Id": self.workspace_a})

        self.assertEqual(response.status_code, 200)
        items = response.json()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["dataset_id"], dataset.dataset_id)
        self.assertEqual(items[0]["provider_id"], "local-catalog")
        self.assertFalse(items[0]["holdout_access"])
        self.assertEqual(items[0]["quality_status"], "fixture-only")

    def test_duplicate_provider_ids_fail_closed(self):
        first = StaticMetadataProvider("same", {})
        second = StaticMetadataProvider("same", {})
        with self.assertRaisesRegex(ValueError, "duplicate data provider"):
            DataProviderRegistry([first, second])
