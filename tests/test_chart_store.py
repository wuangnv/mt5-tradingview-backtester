import tempfile
import unittest
from pathlib import Path

from chart_store import ChartConflict, ChartStore, ChartValidationError


def annotation(label="breakout", cutoff_ms=7_200_000):
    return {
        "kind": "zone",
        "instrument_id": "EURUSD",
        "timeframe": "H1",
        "cutoff_ms": cutoff_ms,
        "anchors": [
            {"time_utc": 3600, "price": 1.1000},
            {"time_utc": 7200, "price": 1.1020},
        ],
        "source": {"kind": "replay", "id": "run-1"},
        "strategy_version_id": "range-break@1.0.0",
        "label": label,
    }


class ChartStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = ChartStore(Path(self.temp.name) / "chart.sqlite3")

    def tearDown(self):
        self.temp.cleanup()

    def test_annotation_revision_delete_restore_preserves_anchor_contract(self):
        created = self.store.create_annotation(annotation())
        updated_payload = annotation("retest")
        updated_payload["anchors"][1]["price"] = 1.1030
        updated = self.store.update_annotation(created["id"], updated_payload, 1)
        self.assertEqual(updated["revision"], 2)
        self.assertEqual(updated["label"], "retest")
        deleted = self.store.delete_annotation(created["id"], 2)
        self.assertTrue(deleted["deleted"])
        restored = self.store.restore_revision(created["id"], 1, 3)
        self.assertFalse(restored["deleted"])
        self.assertEqual(restored["label"], "breakout")
        self.assertEqual([item["revision"] for item in self.store.history(created["id"])], [1, 2, 3, 4])

    def test_annotation_rejects_future_anchor_and_stale_revision(self):
        payload = annotation(cutoff_ms=3_600_000)
        with self.assertRaisesRegex(ChartValidationError, "exceeds replay cutoff"):
            self.store.create_annotation(payload)

        created = self.store.create_annotation(annotation())
        with self.assertRaises(ChartConflict):
            self.store.update_annotation(created["id"], annotation("stale"), 9)

    def test_layout_requires_optimistic_revision(self):
        first = self.store.save_layout("practice", {"panels": [{"symbol": "EURUSD", "timeframe": "H1"}]})
        self.assertEqual(first["revision"], 1)
        second = self.store.save_layout("practice", {"panels": [{"symbol": "EURUSD", "timeframe": "H4"}]}, 1)
        self.assertEqual(second["revision"], 2)
        with self.assertRaises(ChartConflict):
            self.store.save_layout("practice", {"panels": []}, 1)


if __name__ == "__main__":
    unittest.main()
