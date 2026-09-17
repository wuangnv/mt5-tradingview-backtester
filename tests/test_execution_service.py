import tempfile
import unittest
from pathlib import Path

from demo_broker import DemoBrokerSimulator
from execution_service import (
    ExecutionContext,
    ExecutionDenied,
    ExecutionIntentConflict,
    ExecutionRiskDenied,
    ExecutionService,
)
from execution_store import ExecutionJournal, fingerprint


ORDER = {
    "symbol": "EURUSD",
    "side": "buy",
    "volume": 0.1,
    "stop_loss": 1.0952,
    "take_profit": 1.1102,
}


class ExecutionServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "execution.sqlite3"
        self.adapter = DemoBrokerSimulator()
        self.journal = ExecutionJournal(self.db_path)
        self.service = ExecutionService(self.adapter, self.journal)

    def tearDown(self):
        self.temp_dir.cleanup()

    def context(self, request_id="req-1", mode="demo", account_id="demo-sim-1"):
        return ExecutionContext(mode=mode, account_id=account_id, request_id=request_id)

    def test_replay_local_live_and_account_mismatch_are_denied_before_adapter(self):
        for mode in ("replay", "local", "live"):
            with self.subTest(mode=mode), self.assertRaises(ExecutionDenied):
                self.service.place(self.context(request_id=f"req-{mode}", mode=mode), ORDER)
        with self.assertRaises(ExecutionDenied):
            self.service.place(self.context(request_id="req-other", account_id="other"), ORDER)
        self.assertEqual(self.adapter.calls, [])

    def test_denied_mode_does_not_read_adapter_snapshots(self):
        class DenyProbeAdapter:
            account_id = "demo-sim-1"

            def account_snapshot(self):
                raise AssertionError("guard must run before adapter reads")

        service = ExecutionService(DenyProbeAdapter(), self.journal)
        with self.assertRaises(ExecutionDenied):
            service.place(self.context(request_id="deny-before-read", mode="live"), ORDER)

    def test_preview_enforces_stop_risk_and_volume_step(self):
        preview = self.service.preview(ORDER)
        self.assertTrue(preview["passed"])
        self.assertAlmostEqual(preview["estimated_stop_risk"], 50.0)
        too_risky = self.service.preview(dict(ORDER, stop_loss=1.0802))
        self.assertFalse(too_risky["passed"])
        self.assertIn("estimated stop risk exceeds configured limit", too_risky["reasons"])
        with self.assertRaises(ExecutionRiskDenied):
            self.service.preview(dict(ORDER, volume=0.105))
        with self.assertRaises(ExecutionRiskDenied):
            self.service.preview(dict(ORDER, take_profit=1.0900))

    def test_preview_rejects_unknown_symbol_as_validation_error(self):
        from execution_service import ExecutionValidationError

        with self.assertRaises(ExecutionValidationError):
            self.service.preview(dict(ORDER, symbol="UNKNOWN"))

    def test_duplicate_request_is_not_resent_and_intent_is_bound(self):
        context = self.context("same-request")
        first = self.service.place(context, ORDER)
        second = self.service.place(context, ORDER)
        self.assertEqual(first, second)
        self.assertEqual(len(self.adapter.calls), 1)
        with self.assertRaises(ExecutionIntentConflict):
            self.service.place(context, dict(ORDER, volume=0.2))
        self.assertEqual(len(self.adapter.calls), 1)

    def test_prepared_unknown_survives_restart_and_reconciles_without_resend(self):
        context = self.context("crash-window")
        preview = self.service.preview(ORDER)
        payload = {"order": preview["order"], "risk": {"entry_price": preview["entry_price"]}}
        self.journal.prepare(
            context.request_id,
            context.mode,
            context.account_id,
            "place",
            fingerprint(payload),
        )

        restarted_adapter = DemoBrokerSimulator()
        restarted = ExecutionService(restarted_adapter, ExecutionJournal(self.db_path))
        unknown = restarted.place(context, ORDER)
        self.assertEqual(unknown["status"], "unknown")
        self.assertEqual(restarted_adapter.calls, [])

        restarted_adapter.set_result(
            context.request_id,
            {"status": "accepted", "broker_order_id": "reconciled-42"},
        )
        reconciled = restarted.reconcile(context.request_id)
        self.assertEqual(reconciled["status"], "accepted")
        self.assertEqual(reconciled["broker_order_id"], "reconciled-42")
        replayed = restarted.place(context, ORDER)
        self.assertEqual(replayed, reconciled)
        self.assertEqual(restarted_adapter.calls, [])


if __name__ == "__main__":
    unittest.main()
