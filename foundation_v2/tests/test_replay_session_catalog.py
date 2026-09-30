from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
for entry in (str(ROOT), str(V2)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from trading_workspace_v2.replay import ReplayService


class CatalogStore:
    def __init__(self, records, manifests):
        self.records = records
        self.manifests = manifests

    def list_records(self, workspace_id, kind):
        assert workspace_id == "tenant-a"
        assert kind == "replay"
        return self.records

    def get_dataset(self, workspace_id, dataset_id):
        assert workspace_id == "tenant-a"
        return self.manifests.get(dataset_id)


class ReplaySessionCatalogTests(unittest.TestCase):
    def test_catalog_is_metadata_only_and_marks_missing_dataset(self):
        records = [
            {
                "record_id": "session-1",
                "revision": 3,
                "created_at_utc": "2026-09-30T00:00:00Z",
                "updated_at_utc": "2026-09-30T00:01:00Z",
                "payload": {
                    "dataset_id": "dataset-1",
                    "cursor_index": 7,
                    "branch_id": "branch-1",
                    "parent_session_id": None,
                    "parent_revision": None,
                    "status": "paused",
                    "execution": {"ledger": [{"secret": "must-not-leak"}]},
                    "visible_rows": [{"close": 999}],
                },
            },
            {
                "record_id": "session-missing",
                "revision": 1,
                "created_at_utc": "2026-09-29T00:00:00Z",
                "updated_at_utc": "2026-09-29T00:00:00Z",
                "payload": {
                    "dataset_id": "deleted-dataset",
                    "cursor_index": 0,
                    "branch_id": "branch-2",
                    "status": "paused",
                },
            },
        ]
        manifests = {
            "dataset-1": SimpleNamespace(
                instrument_id="EURUSD",
                timeframe="1m",
                timeframe_seconds=60,
                row_count=100,
            )
        }

        items = ReplayService(CatalogStore(records, manifests), artifacts=None).list_sessions("tenant-a")

        self.assertEqual([item["record_id"] for item in items], ["session-1", "session-missing"])
        self.assertEqual(items[0]["instrument_id"], "EURUSD")
        self.assertTrue(items[0]["dataset_available"])
        self.assertTrue(items[0]["has_execution"])
        self.assertNotIn("visible_rows", items[0])
        self.assertNotIn("execution", items[0])
        self.assertFalse(items[1]["dataset_available"])
        self.assertIsNone(items[1]["instrument_id"])

    def test_catalog_rejects_corrupt_payload_instead_of_publishing_it(self):
        record = {
            "record_id": "corrupt",
            "revision": 1,
            "created_at_utc": "2026-09-30T00:00:00Z",
            "updated_at_utc": "2026-09-30T00:00:00Z",
            "payload": ["not", "an", "object"],
        }
        with self.assertRaisesRegex(RuntimeError, "payload is invalid"):
            ReplayService(CatalogStore([record], {}), artifacts=None).list_sessions("tenant-a")


if __name__ == "__main__":
    unittest.main()
