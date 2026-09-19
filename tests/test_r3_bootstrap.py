import unittest

from risk_bootstrap import (
    MAX_BOOTSTRAP_HORIZON,
    MAX_PATHS,
    RiskLabCancelled,
    RiskLabInsufficientData,
    block_bootstrap_simulation,
    bootstrap_eligibility,
    day_blocks,
)
from risk_lab import RiskLabValidationError


def eligible_fixture():
    run = {
        "run_id": "fixture-r3b",
        "status": "completed",
        "starting_balance": 10000.0,
        "data": {
            "dataset_id": "fixture-dataset-v1",
            "requested_range": {"from": "2026-01-01", "to": "2026-01-10"},
        },
        "assumptions": {
            "cost_model_version": "cost-v1",
            "risk_model_version": "risk-v1",
        },
    }
    pnl = [80, -40, 30, -50, 20, 60, -30, 25, -45, 70, -20, 35, -55, 65, -25, 40, -35, 50, -15, 45]
    ledger = []
    for index, value in enumerate(pnl):
        day = 1 + index // 4
        hour = index % 4
        ledger.append(
            {
                "trade_id": str(index + 1),
                "close_time_utc": f"2026-01-{day:02d}T{10 + hour:02d}:00:00Z",
                "net_pnl": float(value),
            }
        )
    return run, ledger


class RiskLabBootstrapTests(unittest.TestCase):
    def test_day_blocks_preserve_order_inside_utc_day(self):
        _, ledger = eligible_fixture()
        blocks = day_blocks(list(reversed(ledger)))
        self.assertEqual(len(blocks), 5)
        self.assertEqual(blocks[0]["utc_date"], "2026-01-01")
        self.assertEqual(blocks[0]["net_pnl"], [80.0, -40.0, 30.0, -50.0])

    def test_eligibility_exposes_missing_sample_and_provenance(self):
        run, ledger = eligible_fixture()
        run["data"]["dataset_id"] = None
        run["assumptions"]["cost_model_version"] = None
        result = bootstrap_eligibility(run, ledger[:3])
        self.assertFalse(result["eligible"])
        self.assertIn("dataset_id_unknown", result["reasons"])
        self.assertIn("cost_model_unknown", result["reasons"])
        self.assertIn("requires_at_least_20_closed_trades", result["reasons"])
        self.assertIn("requires_at_least_5_utc_day_blocks", result["reasons"])

    def test_bootstrap_is_reproducible_and_reports_uncertainty_metadata(self):
        run, ledger = eligible_fixture()
        kwargs = {
            "seed": 1729,
            "path_count": 400,
            "horizon": 20,
            "breach_drawdown_fraction": 0.02,
        }
        first = block_bootstrap_simulation(run, ledger, **kwargs)
        second = block_bootstrap_simulation(run, ledger, **kwargs)
        self.assertEqual(first, second)
        self.assertEqual(first["model_version"], "block-bootstrap-v1")
        self.assertEqual(first["method"]["sampling_unit"], "UTC close date")
        self.assertEqual(first["inputs"]["seed"], 1729)
        self.assertEqual(first["inputs"]["path_count"], 400)
        self.assertGreaterEqual(first["results"]["breach_rate"], 0.0)
        self.assertLessEqual(first["results"]["breach_rate"], 1.0)
        self.assertGreaterEqual(first["results"]["breach_monte_carlo_se"], 0.0)
        self.assertIn("p50", first["results"]["max_drawdown_fraction"])
        self.assertIn("p50", first["results"]["max_loss_streak"])

    def test_bootstrap_cancellation_and_caps_fail_closed(self):
        run, ledger = eligible_fixture()
        with self.assertRaises(RiskLabCancelled):
            block_bootstrap_simulation(
                run,
                ledger,
                seed=1,
                path_count=100,
                horizon=20,
                breach_drawdown_fraction=0.10,
                cancel_check=lambda: True,
            )
        with self.assertRaises(RiskLabValidationError):
            block_bootstrap_simulation(
                run,
                ledger,
                seed=1,
                path_count=MAX_PATHS + 1,
                horizon=20,
                breach_drawdown_fraction=0.10,
            )
        with self.assertRaisesRegex(RiskLabValidationError, "workload cap"):
            block_bootstrap_simulation(
                run,
                ledger,
                seed=1,
                path_count=MAX_PATHS,
                horizon=MAX_BOOTSTRAP_HORIZON,
                breach_drawdown_fraction=0.10,
            )

    def test_simulation_refuses_ineligible_run_before_sampling(self):
        run, ledger = eligible_fixture()
        run["assumptions"]["risk_model_version"] = None
        with self.assertRaisesRegex(RiskLabInsufficientData, "risk_model_unknown"):
            block_bootstrap_simulation(
                run,
                ledger,
                seed=1,
                path_count=100,
                horizon=20,
                breach_drawdown_fraction=0.10,
            )


if __name__ == "__main__":
    unittest.main()
