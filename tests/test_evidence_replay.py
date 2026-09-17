import unittest

from evidence_replay import bars_through_cutoff


class EvidenceReplayTests(unittest.TestCase):
    def test_cutoff_never_returns_future_bar(self):
        bars = [
            {"time": 100, "close": 1.0},
            {"time": 200, "close": 2.0},
            {"time": 300, "close": 3.0},
            {"time": 400, "close": 4.0},
        ]

        visible = bars_through_cutoff(bars, 250)

        self.assertEqual([bar["time"] for bar in visible], [100, 200])
        self.assertTrue(all(bar["time"] <= 250 for bar in visible))
        self.assertEqual(len(bars), 4)

    def test_cutoff_is_inclusive_and_returns_copies(self):
        bars = [{"time": 100, "close": 1.0}, {"time": 200, "close": 2.0}]
        visible = bars_through_cutoff(bars, 200)
        self.assertEqual(len(visible), 2)
        self.assertIsNot(visible[0], bars[0])


if __name__ == "__main__":
    unittest.main()
