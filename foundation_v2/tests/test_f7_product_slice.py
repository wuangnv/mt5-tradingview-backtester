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
from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
from trading_workspace_v2.contracts import DatasetSource
from trading_workspace_v2.research import ResearchService
from trading_workspace_v2.retained import AIService, FakeProvider
from trading_workspace_v2.store import PostgresStore


def fixture_source() -> DatasetSource:
    return DatasetSource(
        source_id="f7-fixture",
        provider="synthetic-f7",
        instrument_mapping={"EURUSD": "EURUSD"},
        license_use="qa-only",
        retrieved_at_utc="2026-09-22T00:00:00Z",
        export_settings="f7-product-slice-v1",
    )


class F7ProductSliceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dsn = os.environ["TW_V2_DATABASE_URL"]

    @classmethod
    def tearDownClass(cls):
        # F7 uses per-test temporary artifact roots, while the PostgreSQL
        # fixture is shared by the integration suite. Remove its persisted
        # rows before the next suite can claim a job whose temp artifact root
        # has already been deleted.
        if os.getenv("TW_V2_ALLOW_DESTRUCTIVE_TEST_DB") != "1":
            return
        store = PostgresStore(cls.dsn)
        with store.connect() as conn:
            conn.execute("TRUNCATE workspace_record_revisions,workspace_records,research_jobs,datasets,workspaces CASCADE")
            conn.commit()

    def setUp(self):
        if os.getenv("TW_V2_ALLOW_DESTRUCTIVE_TEST_DB") != "1":
            self.fail("TW_V2_ALLOW_DESTRUCTIVE_TEST_DB=1 is required for TRUNCATE fixture tests")
        self.temp = tempfile.TemporaryDirectory(prefix="tw-f7-test-")
        self.artifacts = ArtifactStore(self.temp.name)
        self.store = PostgresStore(self.dsn)
        self.store.initialize()
        with self.store.connect() as conn:
            conn.execute("TRUNCATE workspace_record_revisions,workspace_records,research_jobs,datasets,workspaces CASCADE")
            conn.commit()
        self.research = ResearchService(self.store, self.artifacts)

    def tearDown(self):
        self.temp.cleanup()

    def client(self, ai_service=None):
        authorization = LocalWorkspaceAuthorization.for_local_owner(["tenant-a", "tenant-b"])
        return TestClient(
            create_app(
                dsn=self.dsn,
                artifact_root=self.temp.name,
                ai_service=ai_service,
                authorization=authorization,
            )
        )

    def seed_dataset(self, workspace="tenant-a"):
        return self.research.register_dataset(
            workspace_id=workspace,
            source=fixture_source(),
            instrument_id="EURUSD",
            timeframe="1m",
            rows=[
                {"timestamp": 1000, "open": 1.0, "high": 1.2, "low": 0.9, "close": 1.1, "volume": 10},
                {"timestamp": 1060, "open": 1.1, "high": 1.3, "low": 1.0, "close": 1.2, "volume": 11},
            ],
        )

    def test_data_catalog_and_overview_are_tenant_scoped(self):
        dataset = self.seed_dataset("tenant-a")
        self.seed_dataset("tenant-b")
        with self.client() as client:
            response = client.get("/api/v2/data/datasets", headers={"X-Workspace-Id": "tenant-a"})
            self.assertEqual(response.status_code, 200)
            items = response.json()["items"]
            self.assertEqual([item["dataset_id"] for item in items], [dataset.dataset_id])
            self.assertEqual(items[0]["quality_status"], "fixture-only")
            self.assertFalse(response.json()["holdout_access"])

            overview = client.get("/api/v2/overview", headers={"X-Workspace-Id": "tenant-a"}).json()
            self.assertEqual(overview["counts"]["datasets"], 1)
            self.assertFalse(overview["execution"]["broker_execution_capability"])
            self.assertIn("u1_owner_visual_approval", overview["blocked_reasons"])

    def test_playbook_journal_and_annotation_are_versioned_and_isolated(self):
        headers = {"X-Workspace-Id": "tenant-a"}
        with self.client() as client:
            playbook = client.post(
                "/api/v2/playbooks",
                headers=headers,
                json={
                    "name": "Breakout London",
                    "status": "draft",
                    "execution_capability": "manual-only",
                    "rules": {"entry": "close above range", "skip": "major news"},
                },
            )
            self.assertEqual(playbook.status_code, 201)
            playbook_id = playbook.json()["record_id"]
            revised = client.post(
                f"/api/v2/playbooks/{playbook_id}/revisions",
                headers=headers,
                json={
                    "expected_revision": 1,
                    "payload": {
                        "name": "Breakout London",
                        "status": "draft",
                        "execution_capability": "manual-only",
                        "rules": {"entry": "close above range", "skip": "major news or stale data"},
                    },
                },
            )
            self.assertEqual(revised.status_code, 200)
            self.assertEqual(revised.json()["revision"], 2)
            conflict = client.post(
                f"/api/v2/playbooks/{playbook_id}/revisions",
                headers=headers,
                json={"expected_revision": 1, "payload": revised.json()["payload"]},
            )
            self.assertEqual(conflict.status_code, 409)
            cross = client.get(f"/api/v2/playbooks/{playbook_id}", headers={"X-Workspace-Id": "tenant-b"})
            self.assertEqual(cross.status_code, 404)

            journal = client.post(
                "/api/v2/journal",
                headers=headers,
                json={
                    "entry_type": "no-trade",
                    "note": "Bo qua vi du lieu stale",
                    "source": {"kind": "replay-decision", "id": "decision-1"},
                    "tags": ["discipline"],
                },
            )
            self.assertEqual(journal.status_code, 201)
            duplicate = client.post("/api/v2/journal", headers=headers, json=journal.json()["payload"])
            self.assertEqual(duplicate.status_code, 409)

            annotation_payload = {
                "annotation_type": "zone",
                "instrument_id": "EURUSD",
                "timeframe": "5m",
                "anchors": [{"timestamp": 1000, "price": 1.101}, {"timestamp": 1060, "price": 1.102}],
                "cutoff_timestamp": 1060,
                "source": "replay",
                "run_id": "run-1",
                "rule_version": "rule-v1",
                "label": "London range",
            }
            annotation = client.post("/api/v2/chart/annotations", headers=headers, json=annotation_payload)
            self.assertEqual(annotation.status_code, 201)
            future = dict(annotation_payload)
            future["anchors"] = [{"timestamp": 1120, "price": 1.103}]
            rejected = client.post("/api/v2/chart/annotations", headers=headers, json=future)
            self.assertEqual(rejected.status_code, 422)

    def test_ai_boundary_and_execution_remain_non_broker(self):
        provider = FakeProvider(
            {
                "journal_review": {
                    "status": "ok",
                    "result": {"suggestion": "kiem tra rule version", "broker_action": None},
                }
            }
        )
        ai = AIService(provider, enabled_jobs={"journal_review"})
        headers = {"X-Workspace-Id": "tenant-a"}
        with self.client(ai_service=ai) as client:
            status = client.get("/api/v2/ai/status", headers=headers).json()
            self.assertFalse(status["execution_capability"])
            self.assertFalse(status["capabilities"]["broker_actions"])

            response = client.post(
                "/api/v2/ai/request",
                headers=headers,
                json={
                    "job": "journal_review",
                    "context_version": "journal-v1",
                    "state": {"note": "vao lenh som", "rule_version": "rule-v1"},
                },
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["status"], "ok")

            forbidden = client.post(
                "/api/v2/ai/request",
                headers=headers,
                json={
                    "job": "journal_review",
                    "context_version": "journal-v1",
                    "state": {"holdout_bars": [1, 2, 3]},
                },
            )
            self.assertEqual(forbidden.status_code, 422)

            execution = client.get("/api/v2/execution/capabilities", headers=headers).json()
            self.assertEqual(execution["mode"], "locked")
            denied = client.post("/api/v2/execution/intents", headers=headers, json={"side": "buy"})
            self.assertEqual(denied.status_code, 403)

    def test_research_checkpoint_is_read_only_and_workspace_scoped(self):
        dataset = self.seed_dataset("tenant-a")
        job = self.research.create_job(
            workspace_id="tenant-a",
            dataset_id=dataset.dataset_id,
            strategy_version="close-delta-v1",
            starting_balance=10_000,
        )
        headers = {"X-Workspace-Id": "tenant-a"}
        with self.client() as client:
            before_run = client.get(
                f"/api/v2/research/jobs/{job.job_id}/checkpoint", headers=headers
            )
            self.assertEqual(before_run.status_code, 404)
            self.assertEqual(before_run.json()["detail"], "checkpoint_not_found")

            self.research.run_one()
            checkpoint = client.get(
                f"/api/v2/research/jobs/{job.job_id}/checkpoint", headers=headers
            )
            self.assertEqual(checkpoint.status_code, 200)
            payload = checkpoint.json()
            self.assertEqual(payload["schema_version"], "research-job-checkpoint-view-v1")
            self.assertEqual(payload["job_id"], job.job_id)
            self.assertEqual(payload["workspace_id"], "tenant-a")
            self.assertEqual(payload["checkpoint"]["schema"], "research-job-checkpoint-v1")
            self.assertEqual(payload["checkpoint"]["phase"], "candidate-ready")
            self.assertFalse(payload["execution_capability"])
            self.assertEqual(payload["progress"], {"phase_count": 4, "phase_index": 4})

            cross_workspace = client.get(
                f"/api/v2/research/jobs/{job.job_id}/checkpoint",
                headers={"X-Workspace-Id": "tenant-b"},
            )
            self.assertEqual(cross_workspace.status_code, 404)
            self.assertEqual(cross_workspace.json()["detail"], "job_not_found")

    def test_replay_cutoff_branch_and_future_suffix_are_isolated(self):
        headers = {"X-Workspace-Id": "tenant-a"}
        first = self.research.register_dataset(
            workspace_id="tenant-a",
            source=fixture_source(),
            instrument_id="EURUSD",
            timeframe="1m",
            rows=[
                {"timestamp": 1000, "open": 1.0, "high": 1.1, "low": 0.9, "close": 1.0, "volume": 10},
                {"timestamp": 1060, "open": 1.0, "high": 1.2, "low": 1.0, "close": 1.1, "volume": 11},
                {"timestamp": 1120, "open": 1.1, "high": 1.3, "low": 1.0, "close": 1.2, "volume": 12},
            ],
        )
        second = self.research.register_dataset(
            workspace_id="tenant-a",
            source=fixture_source(),
            instrument_id="EURUSD",
            timeframe="1m",
            rows=[
                {"timestamp": 1000, "open": 1.0, "high": 1.1, "low": 0.9, "close": 1.0, "volume": 10},
                {"timestamp": 1060, "open": 1.0, "high": 1.2, "low": 1.0, "close": 1.1, "volume": 11},
                {"timestamp": 1120, "open": 1.1, "high": 9.9, "low": 0.1, "close": 9.0, "volume": 99},
            ],
        )
        with self.client() as client:
            a = client.post("/api/v2/replay/sessions", headers=headers, json={"dataset_id": first.dataset_id, "start_index": 1})
            b = client.post("/api/v2/replay/sessions", headers=headers, json={"dataset_id": second.dataset_id, "start_index": 1})
            self.assertEqual(a.status_code, 201)
            self.assertEqual(a.json()["visible_rows"], b.json()["visible_rows"])
            self.assertEqual(a.json()["cutoff_timestamp"], 1060)
            self.assertTrue(a.json()["has_future_rows"])

            session_id = a.json()["record_id"]
            stepped = client.post(
                f"/api/v2/replay/sessions/{session_id}/step",
                headers=headers,
                json={"expected_revision": 1, "steps": 1},
            )
            self.assertEqual(stepped.status_code, 200)
            self.assertEqual(stepped.json()["payload"]["cursor_index"], 2)
            self.assertEqual(stepped.json()["payload"]["status"], "completed")

            historical = client.get(
                f"/api/v2/replay/sessions/{session_id}?cursor_index=1",
                headers=headers,
            )
            self.assertEqual(historical.status_code, 200)
            self.assertEqual(historical.json()["payload"]["cursor_index"], 2)
            self.assertEqual(historical.json()["view_cursor_index"], 1)
            self.assertEqual(historical.json()["canonical_cursor_index"], 2)
            self.assertTrue(historical.json()["historical_view"])
            self.assertEqual(historical.json()["visible_row_count"], 2)
            self.assertEqual(historical.json()["cutoff_timestamp"], 1060)
            self.assertTrue(historical.json()["has_future_rows"])

            after_historical = client.get(f"/api/v2/replay/sessions/{session_id}", headers=headers)
            self.assertEqual(after_historical.status_code, 200)
            self.assertEqual(after_historical.json()["payload"]["cursor_index"], 2)
            self.assertFalse(after_historical.json()["historical_view"])

            branched = client.post(
                f"/api/v2/replay/sessions/{session_id}/branch",
                headers=headers,
                json={"expected_revision": 2, "cursor_index": 0},
            )
            self.assertEqual(branched.status_code, 201)
            self.assertEqual(branched.json()["visible_row_count"], 1)
            self.assertEqual(branched.json()["payload"]["parent_session_id"], session_id)
            self.assertNotEqual(branched.json()["payload"]["branch_id"], stepped.json()["payload"]["branch_id"])

    def test_research_cancel_is_durable_and_produces_no_result(self):
        dataset = self.seed_dataset("tenant-a")
        job = self.research.create_job(
            workspace_id="tenant-a", dataset_id=dataset.dataset_id, strategy_version="close-delta-v1", starting_balance=10_000
        )
        with self.client() as client:
            canceled = client.post(
                f"/api/v2/research/jobs/{job.job_id}/cancel", headers={"X-Workspace-Id": "tenant-a"}
            )
            self.assertEqual(canceled.status_code, 200)
            self.assertEqual(canceled.json()["status"], "canceled")
            self.assertTrue(canceled.json()["cancel_requested"])
        self.assertIsNone(self.research.run_one())
        current = self.store.get_job("tenant-a", job.job_id)
        self.assertEqual(current.status, "canceled")
        self.assertIsNone(current.result_path)

        running_job = self.research.create_job(
            workspace_id="tenant-a", dataset_id=dataset.dataset_id, strategy_version="close-delta-v1", starting_balance=10_000
        )
        claimed = self.store.claim_next_job()
        self.assertEqual(claimed.job_id, running_job.job_id)
        self.store.cancel_job("tenant-a", running_job.job_id)
        self.assertIsNone(self.research.execute_claimed(claimed))
        current = self.store.get_job("tenant-a", running_job.job_id)
        self.assertEqual(current.status, "canceled")
        self.assertIsNone(current.result_path)

    def test_data_cost_news_and_prop_contracts_preserve_unknowns(self):
        headers = {"X-Workspace-Id": "tenant-a"}
        with self.client() as client:
            instrument = client.post(
                "/api/v2/data/instruments/validate",
                headers=headers,
                json={
                    "instrument": {
                        "instrument_id": "EURUSDm",
                        "asset_class": "fx",
                        "base_ccy": "EUR",
                        "quote_ccy": "USD",
                        "account_ccy": "USD",
                        "tick_size": "0.00001",
                        "pip_size": "0.0001",
                        "contract_size": "100000",
                        "quantity_min": "0.01",
                        "quantity_step": "0.01",
                        "effective_from_utc": "2026-01-01T00:00:00Z",
                        "effective_to_utc": "",
                    }
                },
            )
            self.assertEqual(instrument.status_code, 200)
            self.assertEqual(instrument.json()["instrument_id"], "EURUSDm")

            cost = client.post(
                "/api/v2/data/cost-preview",
                headers=headers,
                json={
                    "cost_model": {
                        "version": "fixture-cost-v1",
                        "spread_basis": "bid_ask_embedded",
                        "commission_per_side_account": "3.5",
                        "minimum_fee_account": "0",
                        "slippage_price_per_side": "0.00001",
                        "financing_account": "0",
                        "quote_to_account_rate": "1",
                        "account_ccy": "USD",
                        "rounding_decimals": 2,
                    },
                    "side": "BUY",
                    "quantity": 0.1,
                    "contract_size": 100000,
                    "entry_bid": 1.1000,
                    "entry_ask": 1.1002,
                    "exit_bid": 1.1012,
                    "exit_ask": 1.1014,
                },
            )
            self.assertEqual(cost.status_code, 200)
            self.assertEqual(cost.json()["cost_model_version"], "fixture-cost-v1")
            self.assertEqual(cost.json()["account_ccy"], "USD")
            self.assertAlmostEqual(cost.json()["commission_account"], 7.0)
            self.assertAlmostEqual(cost.json()["slippage_account"], 0.2)
            self.assertAlmostEqual(cost.json()["net_account"], 2.8)

            events = [
                {
                    "event_id": "known-before",
                    "currency": "USD",
                    "scheduled_time_utc": 1000,
                    "known_at_utc": 900,
                    "event_type": "CPI",
                    "impact_source": "fixture",
                    "time_precision": "second",
                    "revision_source": "fixture-v1",
                },
                {
                    "event_id": "known-after",
                    "currency": "USD",
                    "scheduled_time_utc": 1000,
                    "known_at_utc": 1200,
                    "event_type": "CPI revision",
                    "impact_source": "fixture",
                    "time_precision": "second",
                    "revision_source": "fixture-v2",
                },
                {
                    "event_id": "archive-only",
                    "currency": "EUR",
                    "scheduled_time_utc": 950,
                    "known_at_utc": None,
                    "event_type": "PMI",
                    "impact_source": "archive-fixture",
                    "time_precision": "minute",
                    "revision_source": "unknown",
                },
            ]
            point_in_time = client.post(
                "/api/v2/data/news/visible",
                headers=headers,
                json={"events": events, "decision_time_utc": 1100, "allow_archive_proxy": False},
            )
            self.assertEqual([item["event_id"] for item in point_in_time.json()["items"]], ["known-before"])
            self.assertFalse(point_in_time.json()["point_in_time_warning"])
            archive = client.post(
                "/api/v2/data/news/visible",
                headers=headers,
                json={"events": events, "decision_time_utc": 1100, "allow_archive_proxy": True},
            )
            self.assertEqual(
                [item["event_id"] for item in archive.json()["items"]], ["archive-only", "known-before"]
            )
            self.assertTrue(archive.json()["point_in_time_warning"])

            prop = client.post(
                "/api/v2/analytics/prop/evaluate",
                headers=headers,
                json={
                    "profile": {
                        "profile_id": "fixture-prop",
                        "terms_version": "2026-09",
                        "effective_from": "2026-09-01",
                        "reset_timezone": "UTC",
                        "total_drawdown": {"type": "trailing", "amount": 1000, "basis": "equity"},
                        "daily_loss": {"amount": 500, "basis": "equity"},
                        "cost_basis": "included",
                        "breach_at_boundary": True,
                    },
                    "snapshot": {"starting_balance": 10000, "balance": 9900},
                },
            )
            self.assertEqual(prop.status_code, 200)
            self.assertEqual(prop.json()["status"], "blocked_by_data")
            self.assertIn("missing_equity", prop.json()["blocked_by_data"])
            self.assertIn("missing_high_water_mark", prop.json()["blocked_by_data"])


if __name__ == "__main__":
    unittest.main()
