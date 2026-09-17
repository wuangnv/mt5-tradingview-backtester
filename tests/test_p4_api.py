import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from demo_broker import DemoBrokerSimulator
from execution_service import ExecutionService
from execution_store import ExecutionJournal
from p4_app import create_app


ORDER = {
    "symbol": "EURUSD",
    "side": "buy",
    "volume": 0.1,
    "stop_loss": 1.0952,
    "take_profit": 1.1102,
}


class P4ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.adapter = DemoBrokerSimulator()
        service = ExecutionService(self.adapter, ExecutionJournal(root / "execution.sqlite3"))
        self.app = create_app(
            root / "missing-evidence.sqlite3",
            root / "research.sqlite3",
            root / "journal.sqlite3",
            root / "history",
            execution_service=service,
            demo_adapter=self.adapter,
        )
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp_dir.cleanup()

    def confirmed_headers(self):
        return {"X-Execution-Intent": "confirmed"}

    def test_trade_desk_is_simulator_only_and_does_not_load_advanced_chart_bundle(self):
        page = self.client.get("/trade-desk")
        self.assertEqual(page.status_code, 200)
        self.assertIn(b"DEMO SIMULATOR / NO MT5", page.data)
        self.assertNotIn(b"charting_library.standalone.js", page.data)
        state = self.client.get("/api/execution/state")
        self.assertEqual(state.status_code, 200)
        self.assertFalse(state.json["state"]["live_execution_enabled"])
        self.assertTrue(state.json["state"]["connection"]["connected"])
        self.assertTrue(state.json["state"]["capabilities"]["request_lookup"])

    def test_place_requires_confirmation_demo_mode_matching_account_and_risk(self):
        payload = {
            "mode": "demo",
            "account_id": "demo-sim-1",
            "account_server": "LOCAL-SIM",
            "request_id": "api-1",
            "order": ORDER,
        }
        no_confirmation = self.client.post("/api/execution/orders", json=payload)
        self.assertEqual(no_confirmation.status_code, 403)

        live = self.client.post(
            "/api/execution/orders",
            json=dict(payload, mode="live", request_id="api-live"),
            headers=self.confirmed_headers(),
        )
        self.assertEqual(live.status_code, 403)

        accepted = self.client.post(
            "/api/execution/orders", json=payload, headers=self.confirmed_headers()
        )
        self.assertEqual(accepted.status_code, 201)
        self.assertEqual(accepted.json["result"]["status"], "accepted")
        duplicate = self.client.post(
            "/api/execution/orders", json=payload, headers=self.confirmed_headers()
        )
        self.assertEqual(duplicate.status_code, 201)
        self.assertEqual(len(self.adapter.calls), 1)

        too_risky = self.client.post(
            "/api/execution/orders",
            json=dict(payload, request_id="api-risk", order=dict(ORDER, stop_loss=1.0802)),
            headers=self.confirmed_headers(),
        )
        self.assertEqual(too_risky.status_code, 409)

        wrong_server = self.client.post(
            "/api/execution/orders",
            json=dict(payload, request_id="api-server", account_server="OTHER"),
            headers=self.confirmed_headers(),
        )
        self.assertEqual(wrong_server.status_code, 403)

    def test_disconnected_state_remains_readable_and_preview_is_unavailable(self):
        self.adapter.disconnect()
        state = self.client.get("/api/execution/state")
        self.assertEqual(state.status_code, 200)
        self.assertFalse(state.json["state"]["connection"]["connected"])
        preview = self.client.post("/api/execution/preview", json={"order": ORDER})
        self.assertEqual(preview.status_code, 503)

    def test_non_loopback_and_cross_origin_are_denied(self):
        remote = self.client.get(
            "/api/execution/state",
            environ_overrides={"REMOTE_ADDR": "192.168.1.50"},
        )
        self.assertEqual(remote.status_code, 403)
        cross_origin = self.client.post(
            "/api/execution/preview",
            json={"order": ORDER},
            headers={"Origin": "https://example.com"},
        )
        self.assertEqual(cross_origin.status_code, 403)
        same_origin_custom_port = self.client.post(
            "/api/execution/preview",
            json={"order": ORDER},
            headers={"Origin": "http://localhost:5123", "Host": "localhost:5123"},
        )
        self.assertEqual(same_origin_custom_port.status_code, 200)

    def test_importing_p4_does_not_load_mt5_or_legacy_app(self):
        process = subprocess.run(
            [
                sys.executable,
                "-c",
                "import sys; import p4_app; "
                "assert 'mt5_data' not in sys.modules; "
                "assert 'app' not in sys.modules",
            ],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(process.returncode, 0, process.stderr)


if __name__ == "__main__":
    unittest.main()
