import unittest

from replay_provenance import build_replay_evidence


class FakeHistoryStore:
    def __init__(self, bars):
        self.bars = list(bars)
        self.calls = []

    def load(self, symbol, timeframe, from_time=None, to_time=None):
        self.calls.append((symbol, timeframe, from_time, to_time))
        return [bar for bar in self.bars if from_time <= bar["time"] <= to_time]


class ReplayProvenanceTests(unittest.TestCase):
    def test_builds_deterministic_content_addressed_metadata(self):
        report = {
            "symbol": "EURUSD",
            "timeframe": "H1",
            "startBalance": 10000,
            "replayRange": {"from": 3600, "to": 10800},
        }
        history = FakeHistoryStore(
            [
                {"time": 3600, "open": 1.0, "high": 1.1, "low": 0.9, "close": 1.05, "volume": 10},
                {"time": 7200, "open": 1.05, "high": 1.2, "low": 1.0, "close": 1.10, "volume": 20},
                {"time": 10800, "open": 1.10, "high": 1.2, "low": 1.0, "close": 1.08, "volume": 30},
            ]
        )

        first = build_replay_evidence(report, history)
        second = build_replay_evidence(report, history)

        self.assertEqual(first, second)
        self.assertEqual(first["artifact_schema_version"], "replay-evidence-v2")
        self.assertTrue(first["data"]["dataset_id"].startswith("local-bars-sha256:"))
        self.assertEqual(first["data"]["quality_status"], "local_content_hashed_unverified")
        self.assertEqual(first["assumptions"]["cost_model_version"], "virtual-zero-cost-v1")
        self.assertEqual(history.calls[0], ("EURUSD", "H1", 3600, 10800))

    def test_refuses_empty_or_invalid_replay_range(self):
        with self.assertRaises(ValueError):
            build_replay_evidence(
                {"symbol": "EURUSD", "timeframe": "H1", "startBalance": 10000, "replayRange": {"from": 10, "to": 1}},
                FakeHistoryStore([]),
            )

        with self.assertRaises(ValueError):
            build_replay_evidence(
                {"symbol": "EURUSD", "timeframe": "H1", "startBalance": 10000, "replayRange": {"from": 1, "to": 10}},
                FakeHistoryStore([]),
            )

