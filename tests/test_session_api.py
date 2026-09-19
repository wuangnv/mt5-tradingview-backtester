import tempfile
import unittest
from pathlib import Path

import app as application
from session_store import SessionStore


class ReplaySessionApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_store = application.session_store
        application.session_store = SessionStore(
            Path(self.temp_dir.name) / "sessions.sqlite3"
        )
        application.app.config["TESTING"] = True
        self.client = application.app.test_client()

    def tearDown(self):
        application.session_store = self.original_store
        self.temp_dir.cleanup()

    @staticmethod
    def report():
        return {
            "symbol": "EURUSD",
            "timeframe": "H1",
            "barsReplayed": 42,
            "realMs": 120000,
            "startBalance": 10000,
            "trades": [
                {
                    "time": 1700003600,
                    "time_open": 1700000000,
                    "ticket": 100001,
                    "symbol": "EURUSD",
                    "type": "BUY",
                    "volume": 0.10,
                    "price_open": 1.08000,
                    "price_close": 1.08150,
                    "profit": 15.00,
                    "result": "Take Profit",
                    "r": 1.5,
                }
            ],
        }

    def test_create_list_read_and_delete_session(self):
        empty = self.client.get("/api/sessions")
        self.assertEqual(empty.status_code, 200)
        self.assertEqual(empty.json["sessions"], [])

        invalid = self.client.post("/api/session/save", json={"symbol": "EURUSD"})
        self.assertEqual(invalid.status_code, 400)
        self.assertFalse(invalid.json["success"])

        created = self.client.post("/api/session/save", json=self.report())
        self.assertEqual(created.status_code, 201)
        self.assertTrue(created.json["success"])
        saved = created.json["session"]
        self.assertIsInstance(saved["id"], int)
        self.assertEqual(saved["stats"]["net"], 15.0)
        self.assertEqual(saved["stats"]["winRate"], 100.0)

        listed = self.client.get("/api/sessions?limit=10")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json["sessions"]), 1)
        summary = listed.json["sessions"][0]
        self.assertEqual(summary["id"], saved["id"])
        self.assertNotIn("trades", summary)

        detail = self.client.get(f"/api/sessions/{saved['id']}")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json["session"]["trades"], saved["trades"])

        deleted = self.client.delete(f"/api/sessions/{saved['id']}")
        self.assertEqual(deleted.status_code, 200)
        self.assertTrue(deleted.json["success"])
        self.assertEqual(self.client.get(f"/api/sessions/{saved['id']}").status_code, 404)

    def test_rejects_out_of_contract_report_values(self):
        report = self.report()
        report["timeframe"] = "H2"
        response = self.client.post("/api/session/save", json=report)
        self.assertEqual(response.status_code, 400)
        self.assertIn("timeframe", response.json["message"])

        report = self.report()
        report["trades"][0]["profit"] = float("inf")
        response = self.client.post("/api/session/save", json=report)
        self.assertEqual(response.status_code, 400)
        self.assertIn("profit", response.json["message"])

    def test_store_persists_strict_evidence_v2_metadata_without_backfilling_legacy(self):
        report = self.report()
        report["evidence"] = {
            "artifact_schema_version": "replay-evidence-v2",
            "strategy_id": "fixture-strategy",
            "strategy_version": "v1",
            "data": {
                "dataset_id": "fixture-dataset-v1",
                "source_id": "fixture-source-v1",
                "requested_range": {"from": "2026-01-01T00:00:00Z", "to": "2026-01-10T00:00:00Z"},
                "observed_range": {"from": "2026-01-01T00:00:00Z", "to": "2026-01-10T00:00:00Z"},
                "timezone": "UTC",
                "quality_status": "verified_fixture",
            },
            "assumptions": {
                "cost_model_version": "cost-v1",
                "spread": 0,
                "slippage": 0,
                "commission": 0,
                "fill_model_version": "fill-v1",
                "risk_model_version": "risk-v1",
            },
            "reproduce": {
                "engine_version": "engine-v1",
                "metric_version": "metrics-v2",
                "code_hash": "abc123",
                "config_hash": "def456",
                "seed": 7,
            },
        }

        saved = application.session_store.save(report)
        self.assertEqual(saved["evidence"]["data"]["dataset_id"], "fixture-dataset-v1")

        invalid = self.report()
        invalid["evidence"] = dict(report["evidence"])
        invalid["evidence"]["data"] = dict(report["evidence"]["data"])
        invalid["evidence"]["data"].pop("dataset_id")
        with self.assertRaisesRegex(ValueError, "dataset_id"):
            application.session_store.save(invalid)

    def test_public_session_api_rejects_client_supplied_evidence(self):
        report = self.report()
        report["evidence"] = {"artifact_schema_version": "replay-evidence-v2"}
        rejected = self.client.post("/api/session/save", json=report)
        self.assertEqual(rejected.status_code, 400)
        self.assertIn("server-generated", rejected.json["message"])

    def test_new_replay_range_is_enriched_from_local_history_before_save(self):
        class FakeHistoryStore:
            @staticmethod
            def load(symbol, timeframe, from_time=None, to_time=None):
                return [
                    {"time": from_time, "open": 1.0, "high": 1.1, "low": 0.9, "close": 1.05, "volume": 10},
                    {"time": to_time, "open": 1.05, "high": 1.2, "low": 1.0, "close": 1.10, "volume": 20},
                ]

        report = self.report()
        report["replayRange"] = {"from": 1700000000, "to": 1700003600}
        original_history_store = application.history_store
        application.history_store = FakeHistoryStore()
        try:
            created = self.client.post("/api/session/save", json=report)
        finally:
            application.history_store = original_history_store

        self.assertEqual(created.status_code, 201)
        evidence = created.json["session"]["evidence"]
        self.assertEqual(evidence["strategy_id"], "manual-replay")
        self.assertTrue(evidence["data"]["dataset_id"].startswith("local-bars-sha256:"))
        self.assertEqual(evidence["data"]["quality_status"], "local_content_hashed_unverified")
        self.assertEqual(evidence["assumptions"]["risk_model_version"], "virtual-manual-sizing-v1")


if __name__ == "__main__":
    unittest.main()
