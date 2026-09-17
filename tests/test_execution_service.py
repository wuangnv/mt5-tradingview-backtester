import sqlite3
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
    ExecutionUnknown,
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

    def context(
        self,
        request_id="req-1",
        mode="demo",
        account_id="demo-sim-1",
        account_server="LOCAL-SIM",
    ):
        return ExecutionContext(
            mode=mode,
            account_id=account_id,
            account_server=account_server,
            request_id=request_id,
        )

    def test_replay_local_live_and_account_mismatch_are_denied_before_adapter(self):
        for mode in ("replay", "local", "live"):
            with self.subTest(mode=mode), self.assertRaises(ExecutionDenied):
                self.service.place(self.context(request_id=f"req-{mode}", mode=mode), ORDER)
        with self.assertRaises(ExecutionDenied):
            self.service.place(self.context(request_id="req-other", account_id="other"), ORDER)
        with self.assertRaises(ExecutionDenied):
            self.service.place(
                self.context(request_id="req-server", account_server="OTHER-SERVER"), ORDER
            )
        self.adapter.account_mode = "live"
        with self.assertRaises(ExecutionDenied):
            self.service.place(self.context(request_id="req-live-adapter"), ORDER)
        self.assertEqual(self.adapter.calls, [])

    def test_denied_mode_does_not_read_adapter_snapshots(self):
        class DenyProbeAdapter:
            account_id = "demo-sim-1"
            server_id = "LOCAL-SIM"
            account_mode = "demo"

            def account_snapshot(self):
                raise AssertionError("guard must run before adapter reads")

        service = ExecutionService(DenyProbeAdapter(), self.journal)
        with self.assertRaises(ExecutionDenied):
            service.place(self.context(request_id="deny-before-read", mode="live"), ORDER)

    def test_capability_is_checked_before_send(self):
        self.adapter.set_capability("place_market", False)
        with self.assertRaises(ExecutionDenied):
            self.service.place(self.context("no-market"), ORDER)
        self.assertEqual(self.adapter.calls, [])

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
        self.adapter.set_quote("EURUSD", bid=1.1200, ask=1.1202)
        second = self.service.place(context, ORDER)
        self.assertEqual(first, second)
        self.assertEqual(len(self.adapter.calls), 1)
        with self.assertRaises(ExecutionIntentConflict):
            self.service.place(context, dict(ORDER, volume=0.2))
        self.assertEqual(len(self.adapter.calls), 1)

    def test_prepared_unknown_survives_restart_and_reconciles_without_resend(self):
        context = self.context("crash-window")
        payload = {"order": self.service._normalize_order(ORDER)}
        self.journal.prepare(
            context.request_id,
            context.mode,
            context.account_id,
            context.account_server,
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

    def test_partial_fill_is_explicit_and_preserves_remaining_volume(self):
        self.adapter.next_status = "partial"
        result = self.service.place(self.context("partial-fill"), ORDER)
        self.assertEqual(result["status"], "partial")
        self.assertAlmostEqual(result["filled_volume"], 0.05)
        self.assertAlmostEqual(result["remaining_volume"], 0.05)
        self.assertAlmostEqual(result["position"]["volume"], 0.05)
        self.assertIn("deal", result)

    def test_rejected_result_is_explicit_and_not_resent(self):
        self.adapter.next_status = "rejected"
        context = self.context("rejected-order")
        first = self.service.place(context, ORDER)
        second = self.service.place(context, ORDER)
        self.assertEqual(first["status"], "rejected")
        self.assertEqual(second, first)
        self.assertEqual(len(self.adapter.calls), 1)

    def test_timeout_after_broker_accept_reconciles_without_resend(self):
        self.adapter.next_status = "timeout_accepted"
        context = self.context("timeout-accepted")
        with self.assertRaises(ExecutionUnknown):
            self.service.place(context, ORDER)
        self.assertEqual(self.journal.get(context.request_id)["status"], "unknown")
        self.assertEqual(len(self.adapter.calls), 1)

        self.adapter.next_status = "accepted"
        reconciled = self.service.reconcile(context.request_id)
        self.assertEqual(reconciled["status"], "accepted")
        replayed = self.service.place(context, ORDER)
        self.assertEqual(replayed, reconciled)
        self.assertEqual(len(self.adapter.calls), 1)

    def test_disconnect_blocks_reads_and_snapshot_reports_disconnected(self):
        self.adapter.disconnect()
        with self.assertRaises(ExecutionUnknown):
            self.service.preview(ORDER)
        snapshot = self.service.snapshot()
        self.assertFalse(snapshot["connection"]["connected"])
        self.assertIsNone(snapshot["account"]["balance"])
        self.assertEqual(snapshot["positions"], [])
        self.adapter.reconnect()
        self.assertTrue(self.service.preview(ORDER)["passed"])

    def test_v1_journal_migration_backs_up_and_marks_server_unknown(self):
        legacy_path = Path(self.temp_dir.name) / "legacy.sqlite3"
        connection = sqlite3.connect(legacy_path)
        connection.executescript(
            """
            CREATE TABLE execution_requests (
                request_id TEXT PRIMARY KEY,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                mode TEXT NOT NULL,
                account_id TEXT NOT NULL,
                operation TEXT NOT NULL,
                request_fingerprint TEXT NOT NULL,
                status TEXT NOT NULL,
                response_json TEXT
            );
            PRAGMA user_version = 1;
            """
        )
        connection.execute(
            "INSERT INTO execution_requests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("legacy", 1, 1, "demo", "demo-sim-1", "place", "fp", "unknown", None),
        )
        connection.commit()
        connection.close()

        migrated = ExecutionJournal(legacy_path)
        self.assertEqual(migrated.get("legacy")["account_server"], "")
        check = sqlite3.connect(legacy_path)
        try:
            self.assertEqual(check.execute("PRAGMA user_version").fetchone()[0], 2)
        finally:
            check.close()
        self.assertEqual(len(list(legacy_path.parent.glob("legacy.sqlite3.v1-*.bak"))), 1)


if __name__ == "__main__":
    unittest.main()
