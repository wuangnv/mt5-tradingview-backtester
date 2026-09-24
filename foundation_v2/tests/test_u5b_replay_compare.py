from __future__ import annotations

import sys
import unittest
from pathlib import Path


HERE = Path(__file__).resolve()
V2 = HERE.parents[1]
if str(V2) not in sys.path:
    sys.path.insert(0, str(V2))

from trading_workspace_v2.research_validation import (
    ResearchReconciliationError,
    compare_replay_research_cutoff,
)


class U5bReplayComparisonTests(unittest.TestCase):
    def _protocol(self, cutoff: int) -> dict:
        return {
            "dataset": {"artifact_sha256": "dataset-sha", "timeframe_seconds": 60},
            "range": {"from_utc": 0, "to_utc": cutoff + 60},
        }

    def test_matching_replay_cutoff_is_reconciled_without_future_inference(self):
        rows = [
            {"timestamp": 0},
            {"timestamp": 60},
            {"timestamp": 120},
        ]
        result = compare_replay_research_cutoff(
            replay_view={
                "visible_rows": rows[:2],
                "cutoff_timestamp": 60,
                "has_future_rows": True,
                "dataset_sha256": "dataset-sha",
            },
            research_protocol=self._protocol(60),
            rows=rows,
        )
        self.assertTrue(result["reconciled"])
        self.assertTrue(result["future_rows_hidden"])
        self.assertEqual(result["visible_row_count"], 2)

    def test_missing_cutoff_fails_closed(self):
        with self.assertRaisesRegex(ResearchReconciliationError, "cutoff"):
            compare_replay_research_cutoff(
                replay_view={
                    "visible_rows": [{"timestamp": 0}],
                    "has_future_rows": False,
                    "dataset_sha256": "dataset-sha",
                },
                research_protocol=self._protocol(0),
                rows=[{"timestamp": 0}],
            )

    def test_tampered_visible_prefix_fails_closed(self):
        rows = [{"timestamp": 0, "close": 1.0}, {"timestamp": 60, "close": 1.1}]
        with self.assertRaisesRegex(ResearchReconciliationError, "immutable source prefix"):
            compare_replay_research_cutoff(
                replay_view={
                    "visible_rows": [{"timestamp": 0, "close": 9.9}],
                    "cutoff_timestamp": 0,
                    "has_future_rows": True,
                    "dataset_sha256": "dataset-sha",
                },
                research_protocol=self._protocol(0),
                rows=rows,
            )

    def test_completed_replay_matches_exact_research_boundary(self):
        rows = [{"timestamp": 0}, {"timestamp": 60}]
        result = compare_replay_research_cutoff(
            replay_view={
                "visible_rows": rows,
                "cutoff_timestamp": 60,
                "has_future_rows": False,
                "dataset_sha256": "dataset-sha",
            },
            research_protocol=self._protocol(60),
            rows=rows,
        )
        self.assertFalse(result["future_rows_hidden"])

    def test_mismatched_dataset_or_future_flag_fails_closed(self):
        rows = [{"timestamp": 0}, {"timestamp": 60}]
        for replay_view in (
            {
                "visible_rows": rows[:1],
                "cutoff_timestamp": 0,
                "has_future_rows": False,
                "dataset_sha256": "dataset-sha",
            },
            {
                "visible_rows": rows[:1],
                "cutoff_timestamp": 0,
                "has_future_rows": True,
                "dataset_sha256": "other-sha",
            },
        ):
            with self.subTest(replay_view=replay_view), self.assertRaises(ResearchReconciliationError):
                compare_replay_research_cutoff(
                    replay_view=replay_view,
                    research_protocol=self._protocol(0),
                    rows=rows,
                )


if __name__ == "__main__":
    unittest.main()
