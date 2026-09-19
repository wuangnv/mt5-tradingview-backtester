import itertools
import unittest

from risk_lab import (
    RiskLabValidationError,
    breakeven_win_rate,
    compounded_loss_scenario,
    streak_occurrence_probability,
    streak_scenario,
)


def enumerate_streak_probability(loss_probability, streak_length, horizon):
    total = 0.0
    for outcomes in itertools.product((0, 1), repeat=horizon):
        losses = sum(outcomes)
        weight = (loss_probability ** losses) * ((1.0 - loss_probability) ** (horizon - losses))
        run = 0
        hit = False
        for outcome in outcomes:
            run = run + 1 if outcome else 0
            if run >= streak_length:
                hit = True
                break
        if hit:
            total += weight
    return total


class RiskLabModelTests(unittest.TestCase):
    def test_streak_recurrence_matches_spec_and_independent_enumeration(self):
        self.assertAlmostEqual(streak_occurrence_probability(0.5, 2, 2), 0.25)
        self.assertAlmostEqual(streak_occurrence_probability(0.5, 2, 3), 0.375)
        for q, k, n in ((0.2, 2, 5), (0.35, 3, 6), (0.7, 2, 6)):
            self.assertAlmostEqual(
                streak_occurrence_probability(q, k, n),
                enumerate_streak_probability(q, k, n),
                places=12,
            )

    def test_streak_edge_cases_and_q_power_are_distinct(self):
        self.assertEqual(streak_occurrence_probability(0, 3, 10), 0.0)
        self.assertEqual(streak_occurrence_probability(1, 3, 2), 0.0)
        self.assertEqual(streak_occurrence_probability(1, 3, 3), 1.0)
        self.assertEqual(streak_occurrence_probability(0.5, 2, 0), 0.0)
        self.assertAlmostEqual(streak_occurrence_probability(0.25, 1, 4), 1 - 0.75**4)
        scenario = streak_scenario(0.5, 2, 3)
        self.assertAlmostEqual(scenario["next_k_all_losses_probability"], 0.25)
        self.assertAlmostEqual(scenario["at_least_one_streak_probability"], 0.375)

    def test_invalid_streak_inputs_and_computation_cap_fail_closed(self):
        for args in ((-0.1, 2, 3), (1.1, 2, 3), (0.5, 0, 3), (0.5, 2, -1)):
            with self.subTest(args=args), self.assertRaises(RiskLabValidationError):
                streak_occurrence_probability(*args)
        with self.assertRaisesRegex(RiskLabValidationError, "state cap"):
            streak_occurrence_probability(0.5, 1000, 3000)

    def test_fixed_fraction_equity_path_and_recovery(self):
        scenario = compounded_loss_scenario(10000, 0.01, 10)
        expected = 10000 * (0.99**10)
        drawdown = 1 - (0.99**10)
        self.assertAlmostEqual(scenario["ending_equity"], expected)
        self.assertAlmostEqual(scenario["drawdown_fraction"], drawdown)
        self.assertAlmostEqual(scenario["recovery_fraction"], drawdown / (1 - drawdown))
        self.assertEqual(len(scenario["path"]), 11)
        with self.assertRaises(RiskLabValidationError):
            compounded_loss_scenario(10000, 1.0, 2)

    def test_breakeven_and_expectancy_use_one_explicit_cost_basis(self):
        gross = breakeven_win_rate(2, 1, 0.1, 0.5)
        self.assertAlmostEqual(gross["breakeven_win_rate"], 1.1 / 3.0)
        self.assertAlmostEqual(gross["expectancy"], 0.4)
        net = breakeven_win_rate(2, 1, 0, 0.5)
        self.assertAlmostEqual(net["breakeven_win_rate"], 1 / 3)
        self.assertIn("already net", net["assumptions"][1])


if __name__ == "__main__":
    unittest.main()
