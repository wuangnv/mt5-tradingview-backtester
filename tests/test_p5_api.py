import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from demo_broker import DemoBrokerSimulator
from execution_service import ExecutionService
from execution_store import ExecutionJournal
from live_readiness import MT5LiveReadinessProbe
from p5_app import create_app
from test_p5_live_readiness import FakeLiveFetcher, approved_policy


class P5ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.demo_adapter = DemoBrokerSimulator()
        service = ExecutionService(
            self.demo_adapter, ExecutionJournal(root / "execution.sqlite3")
        )
        self.live_fetcher = FakeLiveFetcher()
        self.app = create_app(
            root / "missing-evidence.sqlite3",
            root / "research.sqlite3",
            root / "journal.sqlite3",
            root / "history",
            execution_service=service,
            demo_adapter=self.demo_adapter,
            live_probe=MT5LiveReadinessProbe(self.live_fetcher),
            live_policy=approved_policy(),
        )
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_readiness_endpoint_is_local_read_only_and_does_not_trade(self):
        response = self.client.get("/api/live-readiness/state")
        self.assertEqual(response.status_code, 200)
        state = response.json["state"]
        self.assertTrue(state["ready_for_live_gate"])
        self.assertTrue(state["read_only"])
        self.assertFalse(state["execution_enabled"])
        self.assertEqual(self.live_fetcher.trade_calls, [])

        remote = self.client.get(
            "/api/live-readiness/state",
            environ_overrides={"REMOTE_ADDR": "192.168.1.50"},
        )
        self.assertEqual(remote.status_code, 403)

    def test_no_live_route_is_added_and_p4_live_guard_remains(self):
        missing = self.client.post("/api/live-readiness/orders", json={})
        self.assertEqual(missing.status_code, 404)

        live_attempt = self.client.post(
            "/api/execution/orders",
            json={
                "mode": "live",
                "account_id": "demo-sim-1",
                "account_server": "LOCAL-SIM",
                "request_id": "p5-live-denied",
                "order": {
                    "symbol": "EURUSD",
                    "side": "buy",
                    "volume": 0.01,
                    "stop_loss": 1.0950,
                    "take_profit": 1.1050,
                },
            },
            headers={"X-Execution-Intent": "confirmed"},
        )
        self.assertEqual(live_attempt.status_code, 403)
        self.assertEqual(self.demo_adapter.calls, [])
        self.assertEqual(self.live_fetcher.trade_calls, [])

    def test_default_import_does_not_load_mt5_readiness_backend(self):
        environment = {
            key: value
            for key, value in os.environ.items()
            if key != "P5_READINESS_BACKEND"
        }
        environment["P4_EXECUTION_BACKEND"] = "mt5-demo"
        process = subprocess.run(
            [
                sys.executable,
                "-c",
                "import sys; import p5_app; assert 'mt5_data' not in sys.modules",
            ],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True,
            text=True,
            timeout=10,
            env=environment,
        )
        self.assertEqual(process.returncode, 0, process.stderr)

    def test_disabled_backend_fails_closed(self):
        root = Path(self.temp_dir.name)
        disabled_app = create_app(
            root / "missing-evidence.sqlite3",
            root / "research-disabled.sqlite3",
            root / "journal-disabled.sqlite3",
            root / "history-disabled",
            execution_service=ExecutionService(
                self.demo_adapter,
                ExecutionJournal(root / "execution-disabled.sqlite3"),
            ),
            demo_adapter=self.demo_adapter,
            live_policy=approved_policy(),
        )
        disabled_app.config["TESTING"] = True
        state = disabled_app.test_client().get("/api/live-readiness/state").json["state"]
        self.assertFalse(state["ready_for_live_gate"])
        self.assertFalse(state["execution_enabled"])
        self.assertEqual(state["probe"], "disabled")


if __name__ == "__main__":
    unittest.main()
