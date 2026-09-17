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


if __name__ == "__main__":
    unittest.main()
