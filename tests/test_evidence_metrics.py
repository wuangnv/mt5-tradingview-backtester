import unittest

from evidence_metrics import compute_metrics_v1


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


if __name__ == "__main__":
    unittest.main()
