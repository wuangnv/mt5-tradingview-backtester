import tempfile
import unittest
from pathlib import Path

import app as application
from session_store import SessionStore


class ReplaySessionApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_store = application.session_store
        self.original_mt5_state = application._mt5_init_done
        application.session_store = SessionStore(
            Path(self.temp_dir.name) / "sessions.sqlite3"
        )
        application._mt5_init_done = True
        application.app.config["TESTING"] = True
        self.client = application.app.test_client()

    def tearDown(self):
        application.session_store = self.original_store
        application._mt5_init_done = self.original_mt5_state
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


if __name__ == "__main__":
    unittest.main()
