import unittest

from research_fixture import reproduce_fixture


class ResearchFixtureTests(unittest.TestCase):
    def test_same_fixture_is_deterministic_and_excludes_future_bars(self):
        bars = [
            {"time": 1000, "close": 1.0},
            {"time": 2000, "close": 1.1},
            {"time": 6000, "close": 9.9},
        ]
        first = reproduce_fixture(bars, 5000, 17, {"spread": 0.8})
        second = reproduce_fixture(bars, 5000, 17, {"spread": 0.8})
        self.assertEqual(first, second)
        self.assertEqual(first["input_bar_count"], 3)
        self.assertEqual(first["visible_bar_count"], 2)
        self.assertEqual(first["observed_until_ms"], 2000)

    def test_future_value_does_not_change_visible_fixture_checksum(self):
        base = [
            {"time": 1000, "close": 1.0},
            {"time": 2000, "close": 1.1},
            {"time": 6000, "close": 9.9},
        ]
        changed_future = [dict(bar) for bar in base]
        changed_future[-1]["close"] = -12345
        first = reproduce_fixture(base, 5000, 17)
        second = reproduce_fixture(changed_future, 5000, 17)
        self.assertEqual(first["fixture_checksum"], second["fixture_checksum"])


if __name__ == "__main__":
    unittest.main()
