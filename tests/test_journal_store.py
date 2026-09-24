import tempfile
import unittest
from pathlib import Path

from journal_store import JournalConflict, JournalStore


class JournalStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store = JournalStore(Path(self.temp_dir.name) / "journal.sqlite3")
        self.source = {
            "source_kind": "replay",
            "evidence_run_id": "1",
            "trade_id": "1001",
            "symbol": "EURUSD",
            "timeframe": "H1",
            "evidence_schema_version": "legacy-replay-session-v1",
            "data_source_id": "local-chunks-v1:EURUSD:H1:fixture",
            "data_meta_sha256": "a" * 64,
            "decision_time_ms": 200000,
            "fill_open_time_ms": 200000,
            "fill_close_time_ms": 400000,
            "fill_side": "BUY",
            "fill_quantity": 0.1,
            "fill_entry": 1.06,
            "fill_exit": 1.01,
        }

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_update_creates_revision_without_mutating_fill_or_provenance(self):
        created = self.store.create(
            self.source,
            {
                "intended_entry": 1.05,
                "intended_stop": 1.00,
                "intended_target": 1.10,
                "execution_grade": "followed",
                "rule_checks": {"entry": True},
                "notes": "first",
            },
        )
        updated = self.store.update(
            created["id"],
            {
                "intended_entry": 1.04,
                "intended_stop": 0.99,
                "intended_target": 1.11,
                "execution_grade": "deviated",
                "rule_checks": {"entry": False},
                "notes": "second",
            },
        )
        self.assertEqual(updated["review"]["revision"], 2)
        self.assertEqual(updated["fill"], created["fill"])
        self.assertEqual(updated["source"], created["source"])
        history = self.store.history(created["id"])
        self.assertEqual([item["revision"] for item in history], [1, 2])
        self.assertEqual(history[0]["notes"], "first")
        self.assertEqual(history[1]["notes"], "second")

    def test_one_journal_entry_per_replay_trade(self):
        self.store.create(self.source, {"notes": "first"})
        with self.assertRaises(JournalConflict):
            self.store.create(self.source, {"notes": "duplicate"})

    def test_no_trade_decision_has_revision_history_without_fake_fill(self):
        source = {
            "source_kind": "replay-cursor",
            "source_ref": "run-1:cursor-7200000",
            "symbol": "EURUSD",
            "timeframe": "H1",
            "decision_time_ms": 7200000,
            "setup_version_id": "range-break@0.2.0",
        }
        created = self.store.create_decision(
            source,
            {
                "disposition": "no-trade",
                "observation": "Price is still inside the range.",
                "hypothesis": "Breakout condition is not satisfied.",
                "decision": "Skip this bar.",
                "tags": ["range", "discipline", "range"],
                "notes": "fixture",
            },
        )
        self.assertNotIn("fill", created)
        self.assertEqual(created["review"]["tags"], ["range", "discipline"])
        updated = self.store.update_decision(
            created["id"],
            {
                "disposition": "missed-trade",
                "observation": "Signal appeared after the recorded skip.",
                "hypothesis": "The original rule interpretation may be too strict.",
                "decision": "Review the rule; do not rewrite the historical decision.",
                "tags": ["review"],
                "notes": "second revision",
            },
        )
        self.assertEqual(updated["source"], created["source"])
        self.assertEqual(updated["review"]["revision"], 2)
        history = self.store.decision_history(created["id"])
        self.assertEqual([item["revision"] for item in history], [1, 2])
        self.assertEqual(history[0]["disposition"], "no-trade")
        self.assertEqual(history[1]["disposition"], "missed-trade")

        with self.assertRaises(JournalConflict):
            self.store.create_decision(source, {"disposition": "observation"})


if __name__ == "__main__":
    unittest.main()
