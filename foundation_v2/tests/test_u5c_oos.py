from __future__ import annotations

import unittest

from trading_workspace_v2.research_oos import (
    ResearchValidationPlanError,
    build_bounded_sweep,
    build_walk_forward_plan,
    summarize_sweep_outcomes,
)


TIMEFRAME = 60


def rows(count: int) -> list[dict]:
    return [{"timestamp": index * TIMEFRAME, "close": 100 + index} for index in range(count)]


class U5cWalkForwardTests(unittest.TestCase):
    def test_expanding_walk_forward_is_chronological_with_purge_and_embargo(self):
        plan = build_walk_forward_plan(
            rows(24),
            timeframe_seconds=TIMEFRAME,
            train_bars=8,
            oos_bars=4,
            step_bars=4,
            purge_bars=2,
            embargo_bars=1,
            overlap_bars=2,
            max_folds=3,
        )

        self.assertEqual(plan["fold_count"], 3)
        first, second, third = plan["folds"]
        self.assertEqual((first["train"]["start_index"], first["train"]["stop_index"]), (0, 6))
        self.assertEqual((first["purge"]["start_index"], first["purge"]["stop_index"]), (6, 8))
        self.assertEqual((first["embargo"]["start_index"], first["embargo"]["stop_index"]), (8, 9))
        self.assertEqual((first["oos"]["start_index"], first["oos"]["stop_index"]), (9, 13))
        self.assertEqual(second["train"]["start_index"], 0)
        self.assertEqual(second["oos"]["start_index"], 13)
        self.assertEqual(third["oos"]["start_index"], 17)
        for fold in plan["folds"]:
            self.assertLessEqual(fold["train"]["to_utc"], fold["oos"]["from_utc"])

    def test_rolling_walk_forward_keeps_fixed_training_width_before_purge(self):
        plan = build_walk_forward_plan(
            rows(22),
            timeframe_seconds=TIMEFRAME,
            train_bars=8,
            oos_bars=3,
            step_bars=3,
            purge_bars=1,
            embargo_bars=1,
            expanding=False,
            max_folds=3,
        )

        self.assertEqual(plan["folds"][0]["train"]["start_index"], 0)
        self.assertEqual(plan["folds"][1]["train"]["start_index"], 3)
        self.assertEqual(plan["folds"][2]["train"]["start_index"], 6)
        self.assertTrue(all(fold["train"]["bar_count"] == 7 for fold in plan["folds"]))

    def test_known_overlap_requires_matching_purge(self):
        with self.assertRaisesRegex(ResearchValidationPlanError, "smaller than the declared overlap"):
            build_walk_forward_plan(
                rows(20),
                timeframe_seconds=TIMEFRAME,
                train_bars=8,
                oos_bars=4,
                purge_bars=1,
                overlap_bars=2,
            )

    def test_locked_holdout_is_metadata_only_and_never_opened(self):
        plan = build_walk_forward_plan(
            rows(16),
            timeframe_seconds=TIMEFRAME,
            train_bars=8,
            oos_bars=4,
            purge_bars=1,
            embargo_bars=1,
            holdout_policy={"mode": "metadata_only", "from_utc": 16 * TIMEFRAME},
        )
        self.assertEqual(plan["holdout"], {"access": False, "from_utc": 16 * TIMEFRAME})

        with self.assertRaisesRegex(ResearchValidationPlanError, "reach locked holdout"):
            build_walk_forward_plan(
                rows(17),
                timeframe_seconds=TIMEFRAME,
                train_bars=8,
                oos_bars=4,
                purge_bars=1,
                holdout_policy={"mode": "metadata_only", "from_utc": 16 * TIMEFRAME},
            )
        with self.assertRaisesRegex(ResearchValidationPlanError, "never authorizes holdout"):
            build_walk_forward_plan(
                rows(16),
                timeframe_seconds=TIMEFRAME,
                train_bars=8,
                oos_bars=4,
                holdout_policy={"mode": "unlocked", "from_utc": 16 * TIMEFRAME},
            )

    def test_nonchronological_rows_fail_closed(self):
        fixture = rows(16)
        fixture[4], fixture[5] = fixture[5], fixture[4]
        with self.assertRaisesRegex(ResearchValidationPlanError, "strictly chronological"):
            build_walk_forward_plan(
                fixture,
                timeframe_seconds=TIMEFRAME,
                train_bars=8,
                oos_bars=4,
            )


class U5cBoundedSweepTests(unittest.TestCase):
    def test_sweep_is_deterministic_bounded_and_reports_truncation(self):
        sweep = build_bounded_sweep(
            {"lookback": [2, 4, 8], "hold_bars": [1, 2]},
            max_trials=4,
        )

        self.assertEqual(sweep["search_space_size"], 6)
        self.assertEqual(sweep["trial_count"], 4)
        self.assertTrue(sweep["truncated"])
        self.assertEqual(
            [trial["parameters"] for trial in sweep["trials"]],
            [
                {"hold_bars": 1, "lookback": 2},
                {"hold_bars": 1, "lookback": 4},
                {"hold_bars": 1, "lookback": 8},
                {"hold_bars": 2, "lookback": 2},
            ],
        )

    def test_outcome_accounting_keeps_failed_and_canceled_trials(self):
        sweep = build_bounded_sweep({"lookback": [2, 4, 8]}, max_trials=3)
        summary = summarize_sweep_outcomes(
            sweep,
            [
                {"trial_id": "trial-0001", "status": "completed"},
                {"trial_id": "trial-0002", "status": "failed"},
                {"trial_id": "trial-0003", "status": "canceled"},
            ],
        )
        self.assertTrue(summary["fully_accounted"])
        self.assertEqual(summary["status_counts"], {"canceled": 1, "completed": 1, "failed": 1})

        with self.assertRaisesRegex(ResearchValidationPlanError, "every planned trial"):
            summarize_sweep_outcomes(
                sweep,
                [
                    {"trial_id": "trial-0001", "status": "completed"},
                    {"trial_id": "trial-0002", "status": "failed"},
                ],
            )


if __name__ == "__main__":
    unittest.main()
