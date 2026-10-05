import csv
import gzip
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import pyarrow.parquet as pq

from trading_workspace_v2.tick_history import COLUMNS, DAY_MSC, TickHistoryError, TickHistoryStore


class TickHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.store = TickHistoryStore(self.root / "store")

    def tearDown(self):
        self.temporary.cleanup()

    def capture(self, day=1, rows=None, start=None, end=None, **changes):
        directory = self.root / f"capture-{len(list(self.root.glob('capture-*')))}"
        directory.mkdir()
        start = day * DAY_MSC if start is None else start
        end = (day + 1) * DAY_MSC if end is None else end
        if rows is None:
            rows = [(start + 1000, 1.1, 1.1002, 0, 0, 6, 0)]
        raw = directory / "ticks.csv.gz"
        with gzip.open(raw, "wt", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(COLUMNS)
            writer.writerows(rows)
        receipt = {
            "symbol": "EURUSDm", "provider": "mt5", "server": "Exness-MT5Trial14",
            "account_key": "masked-hash", "mode": "demo", "execution_capability": False,
            "requested_from_msc": start, "requested_to_msc": end, "tick_file": raw.name,
            "raw_sha256": hashlib.sha256(raw.read_bytes()).hexdigest(), "row_count": len(rows),
            "metadata": {"instrument": {"tick_size": "0.00001"}},
        }
        receipt.update(changes)
        path = directory / "receipt.json"
        path.write_text(json.dumps(receipt))
        return path

    def test_real_parquet_preserves_same_ms_duplicates_and_half_open_interval(self):
        stamp = DAY_MSC + 1000
        tick = (stamp, 1.1, 1.1002, 0, 0, 6, 0)
        receipt = self.capture(rows=[tick, tick, (stamp, 1.11, 1.1102, 0, 0, 6, 0), (stamp + 1, 1.12, 1.1202, 0, 0, 6, 0)])
        manifest = self.store.ingest_capture("tenant-a", receipt)
        part = manifest["partitions"][0]
        path = self.root / "store" / "tenant-a" / "ticks" / part["path"]
        self.assertEqual(pq.read_table(path).num_rows, 4)
        rows = list(self.store.iter_ticks("tenant-a", manifest["snapshot_id"], stamp, stamp + 1, batch_size=1))
        self.assertEqual([row["sequence"] for row in rows], [0, 1, 2])
        self.assertEqual([row["bid"] for row in rows], [1.1, 1.1, 1.11])
        self.assertEqual(part["same_millisecond_rows"], 2)
        self.assertEqual(manifest["quality"], "review")

    def test_snapshot_versions_pin_old_day_content_and_reuse_identical_import(self):
        receipt = self.capture()
        first = self.store.ingest_capture("tenant-a", receipt)
        self.assertEqual(first, self.store.ingest_capture("tenant-a", receipt))
        refreshed = self.store.ingest_capture("tenant-a", self.capture(metadata={"instrument": {
            "tick_size": "0.00001", "effective_from_utc": "2026-10-05T00:00:00Z"}}))
        self.assertEqual(first, refreshed)
        second = self.store.ingest_capture("tenant-a", self.capture(day=2))
        third = self.store.ingest_capture("tenant-a", self.capture(rows=[(DAY_MSC + 1000, 2, 2.1, 0, 0, 6, 0)]))
        self.assertEqual(first["row_count"], 1)
        self.assertEqual(second["row_count"], 2)
        self.assertEqual(third["row_count"], 2)
        old = list(self.store.iter_ticks("tenant-a", second["snapshot_id"], DAY_MSC, 2 * DAY_MSC))
        new = list(self.store.iter_ticks("tenant-a", third["snapshot_id"], DAY_MSC, 2 * DAY_MSC))
        self.assertEqual(old[0]["bid"], 1.1)
        self.assertEqual(new[0]["bid"], 2)
        self.assertEqual(self.store.latest("tenant-a", "EURUSDm")["snapshot_id"], third["snapshot_id"])

    def test_unavailable_days_and_unknown_gaps_never_claim_complete_coverage(self):
        start = DAY_MSC
        first = self.store.ingest_capture("tenant-a", self.capture(rows=[
            (start + 1000, 1, 1.1, 0, 0, 6, 0), (start + 180000, 1, 1.1, 0, 0, 6, 0)]))
        self.assertEqual(first["partitions"][0]["intervals_over_60s"], 1)
        self.assertEqual(first["coverage"], "broker_returned_unverified")
        second = self.store.ingest_capture("tenant-a", self.capture(day=2, rows=[]))
        self.assertEqual(second["unavailable_intervals"], [[2 * DAY_MSC, 3 * DAY_MSC]])
        self.store.assert_interval("tenant-a", second["snapshot_id"], start, start + 60000)
        with self.assertRaisesRegex(TickHistoryError, "not downloaded"):
            self.store.assert_interval("tenant-a", second["snapshot_id"], 2 * DAY_MSC, 2 * DAY_MSC + 60000)
        with self.assertRaises(TickHistoryError):
            self.store.ingest_capture("tenant-a", self.capture(rows=[]))
        self.assertEqual(self.store.latest("tenant-a", "EURUSDm")["snapshot_id"], second["snapshot_id"])

    def test_scope_identity_checksums_and_execution_guard(self):
        first = self.store.ingest_capture("tenant-a", self.capture())
        with self.assertRaises(TickHistoryError):
            self.store.load_manifest("tenant-b", first["snapshot_id"])
        for changes in [{"account_key": "other"}, {"server": "other"}, {"execution_capability": True}]:
            with self.subTest(changes=changes), self.assertRaises(TickHistoryError):
                self.store.ingest_capture("tenant-a", self.capture(**changes))
        receipt = self.capture()
        (receipt.parent / "ticks.csv.gz").write_bytes(b"tampered")
        with self.assertRaisesRegex(TickHistoryError, "raw tick checksum"):
            self.store.ingest_capture("tenant-a", receipt)
        part = first["partitions"][0]
        stored = self.root / "store" / "tenant-a" / "ticks" / part["path"]
        stored.write_bytes(b"corrupt parquet")
        with self.assertRaisesRegex(TickHistoryError, "stored tick object checksum"):
            list(self.store.iter_ticks("tenant-a", first["snapshot_id"], DAY_MSC, 2 * DAY_MSC))

    def test_invalid_rows_ranges_and_partial_replacement_fail_closed(self):
        start = DAY_MSC
        first = self.store.ingest_capture("tenant-a", self.capture())
        for rows in [
            [(start + 2, 1, 1.1, 0, 0, 6, 0), (start + 1, 1, 1.1, 0, 0, 6, 0)],
            [(2 * DAY_MSC, 1, 1.1, 0, 0, 6, 0)],
            [(start + 1, float("nan"), 1.1, 0, 0, 6, 0)],
        ]:
            with self.subTest(rows=rows), self.assertRaises(TickHistoryError):
                self.store.ingest_capture("tenant-a", self.capture(rows=rows))
        with self.assertRaisesRegex(TickHistoryError, "replacement must cover"):
            self.store.ingest_capture("tenant-a", self.capture(start=start, end=start + 2000))
        with self.assertRaises(TickHistoryError):
            self.store.ingest_capture("tenant-a", self.capture(end=2 * DAY_MSC + 1))
        with self.assertRaises(TickHistoryError):
            self.store.ingest_capture("tenant-a", self.capture(row_count=2))
        self.assertEqual(self.store.latest("tenant-a", "EURUSDm")["snapshot_id"], first["snapshot_id"])
        self.assertFalse(list((self.root / "store" / "tenant-a" / "ticks" / "objects").glob(".*.parquet")))

    def test_interval_read_skips_unrelated_partitions_without_opening_them(self):
        self.store.ingest_capture("tenant-a", self.capture())
        latest = self.store.ingest_capture("tenant-a", self.capture(day=2))
        unrelated = self.root / "store" / "tenant-a" / "ticks" / latest["partitions"][0]["path"]
        unrelated.write_bytes(b"corrupt unrelated day")
        rows = list(self.store.iter_ticks("tenant-a", latest["snapshot_id"], 2 * DAY_MSC, 3 * DAY_MSC))
        self.assertEqual(len(rows), 1)

    def test_manifest_tampering_is_detected(self):
        manifest = self.store.ingest_capture("tenant-a", self.capture())
        path = self.root / "store" / "tenant-a" / "ticks" / "manifests" / f"{manifest['snapshot_id']}.json"
        manifest["row_count"] = 500
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(TickHistoryError, "manifest checksum"):
            self.store.load_manifest("tenant-a", manifest["snapshot_id"])


if __name__ == "__main__":
    unittest.main()
