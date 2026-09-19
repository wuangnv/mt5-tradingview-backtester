import unittest

from analytics_read_model import AnalyticsReadModel, AnalyticsValidationError, normalize_filters


def run_record(
    run_id,
    *,
    ready=True,
    symbol="EURUSD",
    timeframe="H1",
    dataset="fixture-v1",
    requested_range=None,
    cost="cost-v1",
    risk="risk-v1",
):
    if requested_range is None:
        requested_range = {"from": "2026-01-01", "to": "2026-01-31"}
    return {
        "run_id": str(run_id),
        "starting_balance": 1000.0,
        "status": "completed",
        "strategy_id": "fixture-strategy",
        "strategy_version": "v1",
        "data": {
            "symbol": symbol,
            "timeframe": timeframe,
            "dataset_id": dataset,
            "requested_range": requested_range,
        },
        "assumptions": {"cost_model_version": cost, "risk_model_version": risk},
        "comparison": {"ready": ready, "reasons": [] if ready else ["cost_model_unknown"]},
    }


class FakeEvidenceStore:
    def __init__(self):
        self.runs = {
            "1": run_record(1),
            "2": run_record(2),
            "3": run_record(3, ready=False, cost=None),
            "4": run_record(4, dataset="fixture-v2"),
            "5": run_record(5, requested_range={"from": "2026-02-01", "to": "2026-02-28"}),
        }
        self.ledgers = {
            "1": [
                {
                    "trade_id": "a",
                    "close_time_utc": "2026-01-01T10:00:00+00:00",
                    "side": "BUY",
                    "net_pnl": 10.0,
                    "gross_pnl": 11.0,
                    "fees": 1.0,
                    "planned_risk_budget": 5.0,
                },
                {
                    "trade_id": "b",
                    "close_time_utc": "2026-01-02T10:00:00+00:00",
                    "side": "SELL",
                    "net_pnl": -6.0,
                    "gross_pnl": -5.0,
                    "fees": 1.0,
                    "planned_risk_budget": 5.0,
                },
                {
                    "trade_id": "c",
                    "close_time_utc": "2026-01-03T10:00:00+00:00",
                    "side": "BUY",
                    "net_pnl": 0.0,
                    "gross_pnl": 1.0,
                    "fees": 1.0,
                    "planned_risk_budget": 5.0,
                },
            ],
            "2": [],
            "3": [],
            "4": [],
            "5": [],
        }

    def get_run(self, run_id):
        return self.runs[str(run_id)]

    def get_ledger(self, run_id):
        return list(self.ledgers[str(run_id)])


class R2AnalyticsReadModelTests(unittest.TestCase):
    def setUp(self):
        self.model = AnalyticsReadModel(FakeEvidenceStore())

    def test_one_read_model_applies_filter_to_metrics_ledger_and_scope(self):
        view = self.model.run_view("1", {"side": "BUY", "outcome": "win"})

        self.assertEqual(view["scope"]["selected_trade_count"], 1)
        self.assertEqual(view["scope"]["total_trade_count"], 3)
        self.assertEqual([trade["trade_id"] for trade in view["ledger"]], ["a"])
        self.assertEqual(view["metrics"]["closed_trade_count"], 1)
        self.assertEqual(view["metrics"]["net_pnl"], 10)
        self.assertEqual(view["scope"]["filters"]["side"], "buy")
        self.assertIn("not full account equity", view["scope"]["balance_curve_scope"])

    def test_time_filter_is_timezone_aware_and_consistent(self):
        view = self.model.run_view(
            "1",
            {
                "from_close_utc": "2026-01-02T00:00:00Z",
                "to_close_utc": "2026-01-03T00:00:00+00:00",
            },
        )
        self.assertEqual([trade["trade_id"] for trade in view["ledger"]], ["b"])
        with self.assertRaisesRegex(AnalyticsValidationError, "include a timezone"):
            normalize_filters({"from_close_utc": "2026-01-01T00:00:00"})

    def test_compare_blocks_ranking_when_basis_is_unknown(self):
        comparable = self.model.compare(["1", "2"])
        self.assertTrue(comparable["ranking_allowed"])
        self.assertEqual(comparable["reasons"], [])

        blocked = self.model.compare(["1", "3"])
        self.assertFalse(blocked["ranking_allowed"])
        self.assertIn("run_3:comparison_not_ready", blocked["reasons"])
        self.assertIn("run_3:cost_model_unknown", blocked["reasons"])
        self.assertIn("cost_model_mismatch", blocked["reasons"])

        dataset_mismatch = self.model.compare(["1", "4"])
        self.assertFalse(dataset_mismatch["ranking_allowed"])
        self.assertIn("dataset_id_mismatch", dataset_mismatch["reasons"])

        range_mismatch = self.model.compare(["1", "5"])
        self.assertFalse(range_mismatch["ranking_allowed"])
        self.assertIn("requested_range_mismatch", range_mismatch["reasons"])


if __name__ == "__main__":
    unittest.main()
