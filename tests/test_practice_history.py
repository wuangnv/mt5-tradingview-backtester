import json
import tempfile
import unittest
from pathlib import Path

from practice_history import ReadOnlyHistoryReader


class PracticeHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name) / "chunks"
        directory = self.root / "EURUSD" / "H1"
        directory.mkdir(parents=True)
        bars = [
            {"time": 0, "open": 1.00, "high": 1.05, "low": 0.99, "close": 1.02, "volume": 10},
            {"time": 3600, "open": 1.02, "high": 1.08, "low": 1.01, "close": 1.06, "volume": 20},
            {"time": 7200, "open": 1.06, "high": 1.09, "low": 1.03, "close": 1.04, "volume": 30},
            {"time": 10800, "open": 1.04, "high": 1.07, "low": 1.00, "close": 1.01, "volume": 40},
            {"time": 14400, "open": 1.01, "high": 1.06, "low": 0.98, "close": 1.05, "volume": 50},
        ]
        self.meta_path = directory / "meta.json"
        self.chunk_path = directory / "chunk_000000.json"
        self.meta_path.write_text(
            json.dumps(
                {
                    "symbol": "EURUSD",
                    "timeframe": "H1",
                    "count": len(bars),
                    "firstTime": 0,
                    "lastTime": 14400,
                    "chunks": [{"index": 0, "count": len(bars), "firstTime": 0, "lastTime": 14400}],
                }
            ),
            encoding="utf-8",
        )
        self.chunk_path.write_text(json.dumps({"bars": bars}), encoding="utf-8")
        self.original_meta = self.meta_path.read_bytes()
        self.original_chunk = self.chunk_path.read_bytes()
        self.reader = ReadOnlyHistoryReader(self.root)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_load_through_never_returns_future_bar_and_does_not_write(self):
        bars = self.reader.load_through("EURUSD", "H1", 10800, before_bars=20)
        self.assertEqual([bar["time"] for bar in bars], [0, 3600, 7200])
        self.assertTrue(all(bar["available_at"] <= 10800 for bar in bars))
        self.assertEqual(self.meta_path.read_bytes(), self.original_meta)
        self.assertEqual(self.chunk_path.read_bytes(), self.original_chunk)

    def test_previous_next_anchor_and_provenance_are_deterministic(self):
        self.assertEqual(self.reader.bar_at_or_before("EURUSD", "H1", 5400)["time"], 3600)
        self.assertEqual(self.reader.previous_bar_time("EURUSD", "H1", 10800), 7200)
        self.assertEqual(self.reader.next_bar_time("EURUSD", "H1", 10800), 14400)
        first = self.reader.provenance("EURUSD", "H1")
        second = self.reader.provenance("EURUSD", "H1")
        self.assertEqual(first, second)
        self.assertTrue(first["source_id"].startswith("local-chunks-v1:EURUSD:H1:"))


if __name__ == "__main__":
    unittest.main()
