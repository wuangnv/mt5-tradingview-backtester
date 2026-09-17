import sqlite3
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

    def _protocol(self, store=None):
        store = store or self.store
        hypothesis = store.create_hypothesis(
            {"title": "Breakout continuation", "thesis": "Continuation after a clean range break."}
        )
        strategy = store.create_strategy_version(
            {
                "hypothesis_id": hypothesis["id"],
                "strategy_key": "range-break",
                "version": "1.0.0",
                "rules": {"entry": "close_above_range", "stop": "range_mid"},
            }
        )
        return store.create_protocol(
            {
                "strategy_version_id": strategy["id"],
                "name": "EURUSD H1 fixture",
                "dataset_id": "fixture-eurusd-h1-v1",
                "dataset_sha256": "a" * 64,
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

    def test_v1_migration_creates_backup_before_adding_dataset_fingerprint(self):
        legacy_path = Path(self.temp_dir.name) / "legacy.sqlite3"
        connection = sqlite3.connect(legacy_path)
        connection.execute(
            """
            CREATE TABLE research_protocols (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at_ms INTEGER NOT NULL,
                strategy_version_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                dataset_id TEXT NOT NULL,
                data_start_ms INTEGER NOT NULL,
                cutoff_ms INTEGER NOT NULL,
                seed INTEGER NOT NULL,
                parameters_json TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            INSERT INTO research_protocols (
                created_at_ms, strategy_version_id, name, dataset_id,
                data_start_ms, cutoff_ms, seed, parameters_json
            ) VALUES (1, 1, 'legacy', 'legacy-v1', 1000, 5000, 0, '{}')
            """
        )
        connection.execute("PRAGMA user_version = 1")
        connection.commit()
        connection.close()

        migrated = ResearchStore(legacy_path)
        backup_path = legacy_path.with_name(f"{legacy_path.name}.v1.bak")
        self.assertTrue(backup_path.is_file())
        self.assertIsNone(migrated.get_protocol(1)["dataset_sha256"])

        backup = sqlite3.connect(backup_path)
        self.assertEqual(backup.execute("PRAGMA user_version").fetchone()[0], 1)
        backup_columns = {
            row[1] for row in backup.execute("PRAGMA table_info(research_protocols)").fetchall()
        }
        backup.close()
        self.assertNotIn("dataset_sha256", backup_columns)

    def test_repro_key_is_semantic_across_database_ids_and_tracks_dataset_content(self):
        budget = {"max_bars": 500, "max_runtime_ms": 5000}
        first_protocol = self._protocol()
        first = self.store.create_run({"protocol_id": first_protocol["id"], "budget": budget})

        other_store = ResearchStore(Path(self.temp_dir.name) / "research-other.sqlite3")
        dummy_hypothesis = other_store.create_hypothesis({"title": "dummy", "thesis": "offset ids"})
        dummy_strategy = other_store.create_strategy_version(
            {
                "hypothesis_id": dummy_hypothesis["id"],
                "strategy_key": "dummy",
                "version": "1.0.0",
                "rules": {"entry": "dummy"},
            }
        )
        other_store.create_protocol(
            {
                "strategy_version_id": dummy_strategy["id"],
                "name": "dummy",
                "dataset_id": "dummy",
                "dataset_sha256": "f" * 64,
                "data_start_ms": 1,
                "cutoff_ms": 2,
                "seed": 0,
                "parameters": {},
            }
        )
        second_protocol = self._protocol(other_store)
        second = other_store.create_run({"protocol_id": second_protocol["id"], "budget": budget})
        self.assertNotEqual(first_protocol["id"], second_protocol["id"])
        self.assertEqual(first["repro_key"], second["repro_key"])

        changed_dataset = self.store.create_protocol(
            {
                "strategy_version_id": first_protocol["strategy_version_id"],
                "name": first_protocol["name"],
                "dataset_id": first_protocol["dataset_id"],
                "dataset_sha256": "b" * 64,
                "data_start_ms": first_protocol["data_start_ms"],
                "cutoff_ms": first_protocol["cutoff_ms"],
                "seed": first_protocol["seed"],
                "parameters": first_protocol["parameters"],
            }
        )
        changed = self.store.create_run({"protocol_id": changed_dataset["id"], "budget": budget})
        self.assertNotEqual(first["repro_key"], changed["repro_key"])

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
