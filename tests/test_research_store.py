import tempfile
import unittest
from pathlib import Path

from research_store import ResearchConflict, ResearchStore, ResearchValidationError


class ResearchStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "research.sqlite3"
        self.store = ResearchStore(self.db_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def _protocol(self):
        hypothesis = self.store.create_hypothesis(
            {"title": "Breakout continuation", "thesis": "Continuation after a clean range break."}
        )
        strategy = self.store.create_strategy_version(
            {
                "hypothesis_id": hypothesis["id"],
                "strategy_key": "range-break",
                "version": "1.0.0",
                "rules": {"entry": "close_above_range", "stop": "range_mid"},
            }
        )
        return self.store.create_protocol(
            {
                "strategy_version_id": strategy["id"],
                "name": "EURUSD H1 fixture",
                "dataset_id": "fixture-eurusd-h1-v1",
                "data_start_ms": 1000,
                "cutoff_ms": 5000,
                "seed": 7,
                "parameters": {"spread_pips": 0.8},
            }
        )

    def test_same_immutable_spec_and_budget_produce_same_repro_key(self):
        protocol = self._protocol()
        budget = {"max_bars": 500, "max_runtime_ms": 5000}
        first = self.store.create_run({"protocol_id": protocol["id"], "budget": budget})
        second = self.store.create_run({"protocol_id": protocol["id"], "budget": budget})
        self.assertEqual(first["repro_key"], second["repro_key"])
        self.assertEqual(first["status"], "planned")
        self.assertEqual(first["budget"], budget)

    def test_strategy_version_is_unique_and_immutable_by_contract(self):
        protocol = self._protocol()
        strategy = self.store.get_strategy_version(protocol["strategy_version_id"])
        with self.assertRaises(ResearchConflict):
            self.store.create_strategy_version(
                {
                    "hypothesis_id": strategy["hypothesis_id"],
                    "strategy_key": strategy["strategy_key"],
                    "version": strategy["version"],
                    "rules": {"entry": "different"},
                }
            )

    def test_budget_must_exist_before_run_is_created(self):
        protocol = self._protocol()
        with self.assertRaises(ResearchValidationError):
            self.store.create_run({"protocol_id": protocol["id"], "budget": {"max_bars": 0}})

    def test_future_data_is_rejected_and_valid_completion_is_terminal(self):
        protocol = self._protocol()
        run = self.store.create_run(
            {
                "protocol_id": protocol["id"],
                "budget": {"max_bars": 100, "max_runtime_ms": 1000},
            }
        )
        self.store.start_run(run["id"])
        with self.assertRaises(ResearchValidationError):
            self.store.complete_run(
                run["id"], {"observed_until_ms": 5001, "result": {"trades": 1}}
            )
        completed = self.store.complete_run(
            run["id"], {"observed_until_ms": 5000, "result": {"trades": 1}}
        )
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(completed["result"]["trades"], 1)
        with self.assertRaises(ResearchConflict):
            self.store.cancel_run(run["id"], "too late")

    def test_failed_and_cancelled_are_explicit_terminal_states(self):
        protocol = self._protocol()
        failed = self.store.create_run(
            {
                "protocol_id": protocol["id"],
                "budget": {"max_bars": 10, "max_runtime_ms": 100},
            }
        )
        failed = self.store.fail_run(failed["id"], "fixture parser rejected input")
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(failed["terminal_reason"], "fixture parser rejected input")

        cancelled = self.store.create_run(
            {
                "protocol_id": protocol["id"],
                "budget": {"max_bars": 10, "max_runtime_ms": 100},
            }
        )
        cancelled = self.store.cancel_run(cancelled["id"], "budget review")
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertEqual(cancelled["terminal_reason"], "budget review")


if __name__ == "__main__":
    unittest.main()
