import tempfile
import unittest
from pathlib import Path

from demo_broker import DemoBrokerSimulator
from execution_store import ExecutionJournal
from p5b_demo_rehearsal import DemoRehearsalError, run_demo_rehearsal


class P5BDemoRehearsalTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.journal = ExecutionJournal(
            Path(self.temp_dir.name) / "p5b-execution.sqlite3"
        )
        self.adapter = DemoBrokerSimulator(account_id="demo-approved")

    def tearDown(self):
        self.temp_dir.cleanup()

    def run_rehearsal(self, **overrides):
        values = {
            "expected_account_id": "demo-approved",
            "expected_server": "LOCAL-SIM",
            "max_risk_pct": 0.25,
            "max_risk_amount": 10.0,
            "max_positions": 1,
            "stop_ticks": 20,
        }
        values.update(overrides)
        return run_demo_rehearsal(self.adapter, self.journal, **values)

    def test_read_only_preflight_does_not_trade(self):
        summary = self.run_rehearsal(execute=False)

        self.assertFalse(summary["execute"])
        self.assertFalse(summary["live_execution_enabled"])
        self.assertTrue(summary["preview"]["passed"])
        self.assertEqual(self.adapter.calls, [])

    def test_execute_place_close_reconcile_finishes_flat(self):
        summary = self.run_rehearsal(
            execute=True,
            request_prefix="p5b-test",
        )

        self.assertEqual(summary["place"]["status"], "accepted")
        self.assertEqual(summary["close"]["status"], "closed")
        self.assertEqual(summary["place_reconciled"]["status"], "accepted")
        self.assertEqual(summary["close_reconciled"]["status"], "closed")
        self.assertEqual(summary["place_broker_lookup"]["status"], "accepted")
        self.assertEqual(summary["close_broker_lookup"]["status"], "closed")
        self.assertEqual(summary["final_positions"], [])
        self.assertEqual([item[0] for item in self.adapter.calls], ["place", "close"])

    def test_wrong_identity_fails_before_trade(self):
        with self.assertRaisesRegex(DemoRehearsalError, "account id"):
            self.run_rehearsal(expected_account_id="other-demo", execute=True)

        self.assertEqual(self.adapter.calls, [])

    def test_missing_capability_fails_before_trade(self):
        self.adapter.set_capability("close_position", False)

        with self.assertRaisesRegex(DemoRehearsalError, "close_position"):
            self.run_rehearsal(execute=True)

        self.assertEqual(self.adapter.calls, [])


if __name__ == "__main__":
    unittest.main()
