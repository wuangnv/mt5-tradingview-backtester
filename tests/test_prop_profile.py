import unittest

from prop_profile import evaluate_prop_profile


PROFILE = {
    "profile_id": "fixture-prop",
    "terms_version": "2026-09-19-test",
    "effective_from": "2026-09-19",
    "reset_timezone": "Europe/Prague",
    "breach_at_boundary": True,
    "cost_basis": "separate",
    "total_drawdown": {"type": "trailing", "amount": 1000, "basis": "equity"},
    "daily_loss": {"amount": 500, "basis": "equity"},
}


class PropProfileTests(unittest.TestCase):
    def test_missing_path_inputs_block_instead_of_claiming_pass(self):
        result = evaluate_prop_profile(
            PROFILE,
            {"starting_balance": 10000, "balance": 9900, "daily_start_equity": 10000},
        )
        self.assertEqual(result["status"], "blocked_by_data")
        self.assertIn("missing_equity", result["blocked_by_data"])
        self.assertIn("missing_high_water_mark", result["blocked_by_data"])
        self.assertIn("missing_costs_total", result["blocked_by_data"])

    def test_trailing_and_daily_boundaries_include_separate_costs(self):
        result = evaluate_prop_profile(
            PROFILE,
            {
                "starting_balance": 10000,
                "balance": 9600,
                "equity": 9505,
                "high_water_mark": 10500,
                "daily_start_equity": 10000,
                "costs_total": 5,
                "costs_today": 5,
            },
        )
        self.assertEqual(result["status"], "breached")
        self.assertEqual(result["total_drawdown"]["floor"], 9500)
        self.assertEqual(result["total_drawdown"]["current"], 9500)
        self.assertTrue(result["total_drawdown"]["breached"])
        self.assertEqual(result["daily_loss"]["current"], 9500)
        self.assertTrue(result["daily_loss"]["breached"])


if __name__ == "__main__":
    unittest.main()
