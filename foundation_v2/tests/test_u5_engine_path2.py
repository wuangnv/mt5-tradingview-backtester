from __future__ import annotations

import csv
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch
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
from trading_workspace_v2.data_ingest import DataIngestService
from trading_workspace_v2.research_validation import ResearchReconciliationError, validate_engine_result
from trading_workspace_v2.retained import InstrumentSpec
from trading_workspace_v2.store import PostgresStore


def source_fixture() -> DatasetSource:
    return DatasetSource(
        source_id="u5-path2-fixture",
        provider="offline-fixture",
        instrument_mapping={"EURUSD": "EURUSD"},
        license_use="test-only",
        retrieved_at_utc="2026-09-22T00:00:00Z",
        export_settings="u5-path2-fixture",
    )


def instrument_fixture():
    return InstrumentSpec.from_mapping(
        {
            "instrument_id": "EURUSD",
            "asset_class": "fx",
            "base_ccy": "EUR",
            "quote_ccy": "USD",
            "account_ccy": "USD",
            "tick_size": "0.0001",
            "pip_size": "0.0001",
            "contract_size": "100000",
            "quantity_min": "0.01",
            "quantity_step": "0.01",
            "effective_from_utc": "2026-01-01T00:00:00Z",
            "effective_to_utc": "",
        }
    )


@unittest.skipUnless(os.getenv("TW_V2_DATABASE_URL"), "U5 PostgreSQL fixture not configured")
class U5EnginePath2Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dsn = os.environ["TW_V2_DATABASE_URL"]

    def setUp(self):
        if os.getenv("TW_V2_ALLOW_DESTRUCTIVE_TEST_DB") != "1":
            self.fail("TW_V2_ALLOW_DESTRUCTIVE_TEST_DB=1 is required for TRUNCATE fixture tests")
        self.temp = tempfile.TemporaryDirectory(prefix="tw-u5-path2-")
        self.root = Path(self.temp.name)
        self.artifacts = ArtifactStore(self.root / "artifacts")
        self.store = PostgresStore(self.dsn)
        self.store.initialize()
        with self.store.connect() as conn:
            conn.execute("TRUNCATE workspace_record_revisions,workspace_records,research_jobs,datasets,workspaces CASCADE")
            conn.commit()
        authorization = LocalWorkspaceAuthorization.for_local_owner(["tenant-a", "tenant-b"])
        self.client = TestClient(
            create_app(dsn=self.dsn, artifact_root=self.artifacts.root, authorization=authorization)
        )
        self.headers = {"X-Workspace-Id": "tenant-a"}

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def import_dataset(self, *, holdout_policy=None):
        path = self.root / "bars.csv"
        rows = [
            (0, 1.0000, 1.0100, 0.9900, 1.0000),
            (3600, 1.0000, 1.0200, 0.9950, 1.0150),
            (7200, 1.0150, 1.0400, 1.0100, 1.0350),
            (10800, 1.0360, 1.0450, 1.0200, 1.0400),
            (14400, 1.0400, 1.0420, 1.0000, 1.0050),
            (18000, 1.0040, 1.0100, 0.9700, 0.9750),
            (21600, 0.9740, 0.9900, 0.9600, 0.9650),
            (25200, 0.9650, 0.9850, 0.9550, 0.9800),
        ]
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["time", "open", "high", "low", "close", "volume"])
            for row in rows:
                writer.writerow([*row, 100])
        return DataIngestService(self.store, self.artifacts).import_csv(
            workspace_id="tenant-a",
            path=path,
            source=source_fixture(),
            instrument=instrument_fixture(),
            timeframe_seconds=3600,
            holdout_policy=holdout_policy,
        )

    def create_frozen_playbook(self, *, capability="engine-supported"):
        created = self.client.post(
            "/api/v2/playbooks",
            headers=self.headers,
            json={
                "name": "Deterministic breakout",
                "status": "draft",
                "execution_capability": capability,
                "rules": {
                    "engine": "bar-breakout-v1",
                    "lookback": 2,
                    "hold_bars": 1,
                    "direction": "both",
                    "quantity": 0.1,
                    "planned_stop_distance_price": 0.002,
                },
            },
        )
        self.assertEqual(created.status_code, 201)
        frozen = self.client.post(
            f"/api/v2/playbooks/{created.json()['record_id']}/freeze",
            headers=self.headers,
            json={"expected_revision": 1},
        )
        self.assertEqual(frozen.status_code, 200)
        return frozen.json()

    def engine_request(self, manifest, playbook, **overrides):
        payload = {
            "dataset_id": manifest.dataset_id,
            "playbook_id": playbook["record_id"],
            "playbook_revision": playbook["revision"],
            "starting_balance": 10_000,
            "data_from_utc": 0,
            "data_to_utc": 28_800,
            "split": "baseline",
            "seed": 7,
            "spread_price": 0.0002,
            "cost_model": {
                "version": "fixture-cost-v1",
                "spread_basis": "bid_ask_embedded",
                "commission_per_side_account": 1.0,
                "minimum_fee_account": 0,
                "slippage_price_per_side": 0,
                "financing_account": 0,
                "quote_to_account_rate": 1,
                "account_ccy": "USD",
                "rounding_decimals": 2,
            },
            "max_bars": 100,
            "max_runtime_ms": 5_000,
        }
        payload.update(overrides)
        return payload

    def test_engine_job_pins_frozen_playbook_protocol_and_reconciles(self):
        manifest = self.import_dataset()
        playbook = self.create_frozen_playbook()
        request = self.engine_request(manifest, playbook)
        queued = self.client.post("/api/v2/research/engine-jobs", headers=self.headers, json=request)
        self.assertEqual(queued.status_code, 202)
        queued_payload = queued.json()
        self.assertEqual(queued_payload["strategy_version"], "bar-breakout-v1")
        self.assertEqual(queued_payload["protocol"]["playbook"]["revision"], playbook["revision"])
        self.assertEqual(queued_payload["protocol"]["dataset"]["artifact_sha256"], manifest.artifact_sha256)
        self.assertTrue(queued_payload["protocol_sha256"])

        completed = self.client.app.state.service.run_one()
        self.assertIsNotNone(completed)
        view = self.client.get(
            f"/api/v2/research/jobs/{queued_payload['job_id']}", headers=self.headers
        )
        self.assertEqual(view.status_code, 200)
        self.assertEqual(view.json()["status"], "completed")
        result = view.json()["result"]
        self.assertEqual(result["playbook_id"], playbook["record_id"])
        self.assertEqual(result["playbook_revision"], playbook["revision"])
        self.assertEqual(result["protocol_sha256"], queued_payload["protocol_sha256"])
        self.assertGreaterEqual(len(result["ledger"]), 2)
        self.assertEqual({item["side"] for item in result["ledger"]}, {"BUY", "SELL"})
        self.assertTrue(all(item["open_time_utc"] >= item["signal_time_utc"] for item in result["ledger"]))
        self.assertTrue(all(item["fees"] >= 0 for item in result["ledger"]))
        self.assertTrue(validate_engine_result(result)["reconciled"])

        tampered = dict(result)
        tampered["ledger"] = [dict(item) for item in result["ledger"]]
        tampered["ledger"][0]["net_pnl"] += 1
        with self.assertRaises(ResearchReconciliationError):
            validate_engine_result(tampered)

    def test_same_protocol_reproduces_business_output_and_old_revision_stays_pinned(self):
        manifest = self.import_dataset()
        playbook = self.create_frozen_playbook()
        request = self.engine_request(manifest, playbook)
        first = self.client.post("/api/v2/research/engine-jobs", headers=self.headers, json=request).json()
        self.client.app.state.service.run_one()
        first_result = self.client.get(
            f"/api/v2/research/jobs/{first['job_id']}", headers=self.headers
        ).json()["result"]

        fork = self.client.post(
            f"/api/v2/playbooks/{playbook['record_id']}/fork",
            headers=self.headers,
            json={
                "expected_revision": playbook["revision"],
                "name": "Changed breakout",
                "rules": {**playbook["payload"]["rules"], "lookback": 3},
            },
        )
        self.assertEqual(fork.status_code, 201)

        second = self.client.post("/api/v2/research/engine-jobs", headers=self.headers, json=request).json()
        self.client.app.state.service.run_one()
        second_result = self.client.get(
            f"/api/v2/research/jobs/{second['job_id']}", headers=self.headers
        ).json()["result"]
        self.assertEqual(first["protocol_sha256"], second["protocol_sha256"])
        for key in ("dataset_sha256", "protocol_sha256", "playbook_id", "playbook_revision", "assumptions", "signals", "ledger", "metrics"):
            self.assertEqual(first_result[key], second_result[key])

    def test_engine_job_rejects_draft_manual_and_locked_holdout(self):
        manifest = self.import_dataset()
        draft = self.client.post(
            "/api/v2/playbooks",
            headers=self.headers,
            json={
                "name": "Draft engine",
                "status": "draft",
                "execution_capability": "engine-supported",
                "rules": {
                    "engine": "bar-breakout-v1",
                    "lookback": 2,
                    "hold_bars": 1,
                    "direction": "both",
                    "quantity": 0.1,
                    "planned_stop_distance_price": 0.002,
                },
            },
        ).json()
        draft_request = self.engine_request(manifest, {"record_id": draft["record_id"], "revision": 1})
        rejected = self.client.post("/api/v2/research/engine-jobs", headers=self.headers, json=draft_request)
        self.assertEqual(rejected.status_code, 422)
        self.assertIn("frozen", rejected.json()["detail"])

        manual = self.create_frozen_playbook(capability="manual-only")
        rejected = self.client.post(
            "/api/v2/research/engine-jobs", headers=self.headers, json=self.engine_request(manifest, manual)
        )
        self.assertEqual(rejected.status_code, 422)
        self.assertIn("not engine-supported", rejected.json()["detail"])

        with self.store.connect() as conn:
            manifest_json = manifest.model_dump(mode="json")
            manifest_json["holdout_policy"] = {"mode": "metadata_only", "from_utc": 25_000}
            conn.execute(
                "UPDATE datasets SET manifest_json=%s::jsonb WHERE workspace_id=%s AND dataset_id=%s",
                (__import__("json").dumps(manifest_json), "tenant-a", manifest.dataset_id),
            )
            conn.commit()
        frozen = self.create_frozen_playbook()
        locked = self.client.post(
            "/api/v2/research/engine-jobs", headers=self.headers, json=self.engine_request(manifest, frozen)
        )
        self.assertEqual(locked.status_code, 403)
        self.assertIn("locked holdout", locked.json()["detail"])

    def test_half_open_holdout_boundary_and_worker_reauthorization(self):
        manifest = self.import_dataset(holdout_policy={"mode": "metadata_only", "from_utc": 28800})
        playbook = self.create_frozen_playbook()
        queued = self.client.post("/api/v2/research/engine-jobs", headers=self.headers,
                                  json=self.engine_request(manifest, playbook))
        self.assertEqual(queued.status_code, 202)
        with self.store.connect() as conn:
            changed = manifest.model_dump(mode="json")
            changed["holdout_policy"]["from_utc"] = 28000
            conn.execute("UPDATE datasets SET manifest_json=%s::jsonb WHERE workspace_id=%s AND dataset_id=%s",
                         (json.dumps(changed), "tenant-a", manifest.dataset_id))
        service = self.client.app.state.service
        with patch.object(service.artifacts, "read_dataset_range") as read:
            with self.assertRaises(PermissionError):
                service.run_one()
            read.assert_not_called()
        job = self.store.get_job("tenant-a", queued.json()["job_id"])
        self.assertEqual(job.status, "failed")
        self.assertIsNone(job.result_path)

    def test_protocol_tamper_and_bar_budget_do_not_publish_result(self):
        manifest = self.import_dataset()
        playbook = self.create_frozen_playbook()
        first = self.client.post("/api/v2/research/engine-jobs", headers=self.headers,
                                 json=self.engine_request(manifest, playbook)).json()
        with self.store.connect() as conn:
            conn.execute("UPDATE research_jobs SET protocol_sha256='tampered' WHERE job_id=%s", (first["job_id"],))
        with self.assertRaisesRegex(ValueError, "protocol hash mismatch"):
            self.client.app.state.service.run_one()
        self.assertIsNone(self.store.get_job("tenant-a", first["job_id"]).result_path)

        second = self.client.post("/api/v2/research/engine-jobs", headers=self.headers,
                                  json=self.engine_request(manifest, playbook, max_bars=2)).json()
        with self.assertRaisesRegex(ValueError, "budget.max_bars"):
            self.client.app.state.service.run_one()
        self.assertEqual(self.store.get_job("tenant-a", second["job_id"]).status, "failed")
        self.assertIsNone(self.store.get_job("tenant-a", second["job_id"]).result_path)

    def test_cancel_during_engine_has_no_published_or_partial_success(self):
        manifest = self.import_dataset()
        playbook = self.create_frozen_playbook()
        queued = self.client.post("/api/v2/research/engine-jobs", headers=self.headers,
                                  json=self.engine_request(manifest, playbook)).json()
        service = self.client.app.state.service
        from trading_workspace_v2.research_engine import execute_breakout

        def cancel_then_execute(rows, protocol, **kwargs):
            service.cancel_job("tenant-a", queued["job_id"])
            return execute_breakout(rows, protocol, **kwargs)

        with patch("trading_workspace_v2.research.execute_breakout", side_effect=cancel_then_execute):
            self.assertIsNone(service.run_one())
        job = self.store.get_job("tenant-a", queued["job_id"])
        self.assertEqual(job.status, "canceled")
        self.assertIsNone(job.result_path)

    def test_tenant_boundary_hides_foreign_playbook_and_result(self):
        manifest = self.import_dataset()
        playbook = self.create_frozen_playbook()
        response = self.client.post("/api/v2/research/engine-jobs", headers={"X-Workspace-Id": "tenant-b"},
                                    json=self.engine_request(manifest, playbook))
        self.assertEqual(response.status_code, 404)

    def test_independent_reconciliation_blocks_self_consistent_cost_bug(self):
        from trading_workspace_v2.retained import calculate_round_trip_cost

        manifest = self.import_dataset()
        playbook = self.create_frozen_playbook()
        queued = self.client.post("/api/v2/research/engine-jobs", headers=self.headers,
                                  json=self.engine_request(manifest, playbook)).json()

        def biased_cost(*args):
            cost = calculate_round_trip_cost(*args)
            cost["gross_account"] += 1
            cost["net_account"] += 1
            return cost

        with patch("trading_workspace_v2.research_engine.calculate_round_trip_cost", side_effect=biased_cost):
            # Keep hashing bound to actual source: the injected behavioral defect is the test subject.
            with patch("trading_workspace_v2.research_engine.engine_code_sha256",
                       return_value=queued["protocol"]["engine"]["code_sha256"]):
                with self.assertRaises(ResearchReconciliationError):
                    self.client.app.state.service.run_one()
        job = self.store.get_job("tenant-a", queued["job_id"])
        self.assertEqual(job.status, "failed")
        self.assertIsNone(job.result_path)

    def test_deadline_after_candidate_write_quarantines_instead_of_publishing(self):
        manifest = self.import_dataset()
        playbook = self.create_frozen_playbook()
        queued = self.client.post("/api/v2/research/engine-jobs", headers=self.headers,
                                  json=self.engine_request(manifest, playbook)).json()
        service = self.client.app.state.service
        write = service.artifacts.write_result_candidate
        clock = [0.0]

        def slow_write(*args):
            candidate = write(*args)
            clock[0] = 6.0
            return candidate

        with patch("trading_workspace_v2.research.time.perf_counter", side_effect=lambda: clock[0]):
            with patch.object(service.artifacts, "write_result_candidate", side_effect=slow_write):
                with self.assertRaisesRegex(ValueError, "budget.max_runtime_ms"):
                    service.run_one()
        job = self.store.get_job("tenant-a", queued["job_id"])
        self.assertEqual(job.status, "failed")
        self.assertIsNone(job.result_path)
        candidates = list(service.artifacts.root.glob(f"tenant-a/quarantine/results/{job.job_id}/*.json"))
        self.assertEqual(len(candidates), 1)


if __name__ == "__main__":
    unittest.main()
