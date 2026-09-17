import unittest

from research_fixture import reproduce_fixture


class ResearchFixtureTests(unittest.TestCase):
    def test_same_fixture_is_deterministic_and_excludes_future_bars(self):
        first_time = 1_742_788_800
        second_time = 1_742_792_400
        future_time = 1_742_796_000
        bars = [
            {"time": first_time, "close": 1.0},
            {"time": second_time, "close": 1.1},
            {"time": future_time, "close": 9.9},
        ]
        cutoff_ms = second_time * 1000
        first = reproduce_fixture(bars, cutoff_ms, 17, {"spread": 0.8})
        second = reproduce_fixture(bars, cutoff_ms, 17, {"spread": 0.8})
        self.assertEqual(first, second)
        self.assertEqual(first["input_bar_count"], 3)
        self.assertEqual(first["visible_bar_count"], 2)
        self.assertEqual(first["observed_until_ms"], cutoff_ms)

    def test_future_value_does_not_change_visible_fixture_checksum(self):
        first_time = 1_742_788_800
        second_time = 1_742_792_400
        future_time = 1_742_796_000
        base = [
            {"time": first_time, "close": 1.0},
            {"time": second_time, "close": 1.1},
            {"time": future_time, "close": 9.9},
        ]
        changed_future = [dict(bar) for bar in base]
        changed_future[-1]["close"] = -12345
        cutoff_ms = second_time * 1000
        first = reproduce_fixture(base, cutoff_ms, 17)
        second = reproduce_fixture(changed_future, cutoff_ms, 17)
        self.assertEqual(first["fixture_checksum"], second["fixture_checksum"])


if __name__ == "__main__":
    unittest.main()
