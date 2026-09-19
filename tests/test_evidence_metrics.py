import unittest

from evidence_metrics import compute_metrics_v1, compute_metrics_v2


class EvidenceMetricsTests(unittest.TestCase):
    def test_p0_baseline_fixture_matches_metrics_v1(self):
        ledger = [
            {
                "trade_id": "1",
                "gross_pnl": 50,
                "fees": 2,
                "net_pnl": 48,
                "planned_risk_budget": 40,
            },
            {
                "trade_id": "2",
                "gross_pnl": -30,
                "fees": 2,
                "net_pnl": -32,
                "planned_risk_budget": 40,
            },
            {
                "trade_id": "3",
                "gross_pnl": 1,
                "fees": 1,
                "net_pnl": 0,
                "planned_risk_budget": 40,
            },
            {
                "trade_id": "4",
                "gross_pnl": 20,
                "fees": 2,
                "net_pnl": 18,
                "planned_risk_budget": 30,
            },
            {
                "trade_id": "5",
                "gross_pnl": -11,
                "fees": 1,
                "net_pnl": -12,
                "planned_risk_budget": 48,
            },
        ]

        metrics = compute_metrics_v1(ledger, 1000)

        self.assertEqual(metrics["metric_schema_version"], "metrics-v1")
        self.assertEqual(metrics["trade_count"], 5)
        self.assertEqual((metrics["wins"], metrics["losses"], metrics["breakeven"]), (2, 2, 1))
        self.assertEqual(metrics["gross_pnl"], 30)
        self.assertEqual(metrics["fees"], 8)
        self.assertEqual(metrics["net_pnl"], 22)
        self.assertEqual(metrics["win_rate_pct"], 40)
        self.assertAlmostEqual(metrics["profit_factor_after_cost"], 1.5)
        self.assertAlmostEqual(metrics["expectancy_net_per_trade"], 4.4)
        self.assertAlmostEqual(metrics["average_realized_r"], 0.15)
        self.assertEqual(metrics["max_drawdown"], 32)
        self.assertAlmostEqual(metrics["max_drawdown_pct"], 32 / 1048 * 100)
        self.assertEqual(metrics["max_loss_streak"], 1)
        self.assertEqual(metrics["ending_balance"], 1022)

    def test_missing_legacy_cost_and_risk_remain_unknown(self):
        metrics = compute_metrics_v1(
            [{"trade_id": "1", "net_pnl": 5, "gross_pnl": None, "fees": None}],
            100,
        )
        self.assertIsNone(metrics["gross_pnl"])
        self.assertIsNone(metrics["fees"])
        self.assertIsNone(metrics["average_realized_r"])

    def test_metrics_v2_empty_sample_is_unknown_not_zero_rate(self):
        metrics = compute_metrics_v2([], 1000)

        self.assertEqual(metrics["metric_schema_version"], "metrics-v2")
        self.assertEqual(metrics["closed_trade_count"], 0)
        self.assertIsNone(metrics["win_rate_pct"])
        self.assertIsNone(metrics["loss_rate_pct"])
        self.assertIsNone(metrics["expectancy_net_per_trade"])
        self.assertIsNone(metrics["profit_factor_after_cost"])
        self.assertEqual(metrics["net_pnl"], 0)
        self.assertEqual(metrics["closed_trade_balance_max_drawdown"], 0)

    def test_metrics_v2_oracle_cost_payoff_drawdown_and_streak(self):
        ledger = [
            {"trade_id": "1", "gross_pnl": 50, "fees": 2, "net_pnl": 48, "planned_risk_budget": 40},
            {"trade_id": "2", "gross_pnl": -30, "fees": 2, "net_pnl": -32, "planned_risk_budget": 40},
            {"trade_id": "3", "gross_pnl": 1, "fees": 1, "net_pnl": 0, "planned_risk_budget": 40},
            {"trade_id": "4", "gross_pnl": -11, "fees": 1, "net_pnl": -12, "planned_risk_budget": 48},
        ]

        metrics = compute_metrics_v2(ledger, 1000)

        # Independent arithmetic oracle: 48 - 32 + 0 - 12 = 4.
        self.assertEqual(metrics["net_pnl"], 4)
        self.assertEqual(metrics["gross_pnl"], 10)
        self.assertEqual(metrics["fees"], 6)
        self.assertAlmostEqual(metrics["profit_factor_after_cost"], 48 / 44)
        self.assertAlmostEqual(metrics["payoff_ratio_after_cost"], 48 / 22)
        self.assertEqual(metrics["max_loss_streak"], 1)  # breakeven resets the streak
        self.assertEqual(metrics["closed_trade_balance_max_drawdown"], 44)
        self.assertAlmostEqual(metrics["closed_trade_balance_max_drawdown_pct"], 44 / 1048 * 100)
        self.assertAlmostEqual(metrics["average_realized_r"], (1.2 - 0.8 + 0 - 0.25) / 4)
        self.assertEqual(metrics["basis"]["costs"], "complete")

    def test_metrics_v2_partial_planned_risk_does_not_publish_partial_average_r(self):
        metrics = compute_metrics_v2(
            [
                {"trade_id": "1", "net_pnl": 10, "gross_pnl": None, "fees": None, "planned_risk_budget": 5},
                {"trade_id": "2", "net_pnl": -4, "gross_pnl": None, "fees": None, "planned_risk_budget": None},
            ],
            100,
        )
        self.assertEqual(metrics["realized_r_known_count"], 1)
        self.assertIsNone(metrics["average_realized_r"])
        self.assertEqual(metrics["basis"]["realized_r"], "incomplete_or_unknown")

    def test_metrics_v2_all_wins_and_all_losses_keep_undefined_ratios_unknown(self):
        all_wins = compute_metrics_v2(
            [
                {"trade_id": "1", "net_pnl": 5, "gross_pnl": 6, "fees": 1},
                {"trade_id": "2", "net_pnl": 3, "gross_pnl": 4, "fees": 1},
            ],
            100,
        )
        self.assertEqual(all_wins["win_rate_pct"], 100)
        self.assertIsNone(all_wins["profit_factor_after_cost"])
        self.assertIsNone(all_wins["payoff_ratio_after_cost"])

        all_losses = compute_metrics_v2(
            [
                {"trade_id": "1", "net_pnl": -5, "gross_pnl": -4, "fees": 1},
                {"trade_id": "2", "net_pnl": -3, "gross_pnl": -2, "fees": 1},
            ],
            100,
        )
        self.assertEqual(all_losses["win_rate_pct"], 0)
        self.assertEqual(all_losses["profit_factor_after_cost"], 0)
        self.assertIsNone(all_losses["payoff_ratio_after_cost"])
        self.assertEqual(all_losses["max_loss_streak"], 2)


if __name__ == "__main__":
    unittest.main()
