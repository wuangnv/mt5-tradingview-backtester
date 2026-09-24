import csv
import tempfile
import unittest
from pathlib import Path

from data_contracts import InstrumentSpec, SourceSpec
from data_import import import_csv
from research_engine import ResearchEngineDataDenied, ResearchEngineRunner
from research_store import ResearchStore
from research_validation import (
    ResearchReconciliationError,
    research_analytics_report,
    validate_engine_result,
)


class U5ResearchEngineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.data_root = self.root / "data"
        self.data_root.mkdir()
        self.store = ResearchStore(self.data_root / "research.sqlite3")

    def tearDown(self):
        self.temp.cleanup()

    def _import_dataset(self, holdout_policy=None):
        csv_path = self.root / "bars.csv"
        rows = [
            (0, 1.0000, 1.0100, 0.9900, 1.0000),
            (3600, 1.0000, 1.0200, 0.9950, 1.0150),
            (7200, 1.0150, 1.0400, 1.0100, 1.0350),
            (10800, 1.0360, 1.0450, 1.0200, 1.0400),
            (14400, 1.0400, 1.0420, 1.0000, 1.0050),
            (18000, 1.0040, 1.0100, 0.9700, 0.9750),
            (21600, 0.9740, 0.9900, 0.9600, 0.9650),
            (25200, 0.9650, 0.9850, 0.9550, 0.9800),
        ]
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["time", "open", "high", "low", "close", "volume"])
            for row in rows:
                writer.writerow([*row, 100])
        source = SourceSpec.from_mapping(
            {
                "source_id": "u5-fixture",
                "provider": "offline-fixture",
                "instrument_mapping": {"EURUSD": "EURUSD"},
                "license_use": "test-only",
                "retrieved_at_utc": "2026-09-19T00:00:00Z",
                "export_settings": "fixture",
            }
        )
        instrument = InstrumentSpec.from_mapping(
            {
                "instrument_id": "EURUSD",
                "asset_class": "fx",
                "base_ccy": "EUR",
                "quote_ccy": "USD",
                "account_ccy": "USD",
                "tick_size": "0.0001",
                "pip_size": "0.0001",
                "contract_size": "100000",
                "quantity_min": "0.01",
                "quantity_step": "0.01",
                "effective_from_utc": "2026-01-01T00:00:00Z",
                "effective_to_utc": "",
            }
        )
        return import_csv(
            csv_path,
            self.data_root,
            source,
            instrument,
            3600,
            holdout_policy=holdout_policy,
        )["manifest"]

    def _run(self, manifest, cutoff_ms=28_800_000):
        hypothesis = self.store.create_hypothesis({"title": "Breakout", "thesis": "Closed-bar breakout"})
        strategy = self.store.create_strategy_version(
            {
                "hypothesis_id": hypothesis["id"],
                "strategy_key": "bar-breakout",
                "version": "1.0.0",
                "maturity": "frozen",
                "capability_status": "engine-supported",
                "rules": {
                    "engine": "bar-breakout-v1",
                    "lookback": 2,
                    "hold_bars": 1,
                    "direction": "both",
                    "quantity": 0.1,
                    "planned_stop_distance_price": 0.002,
                },
            }
        )
        protocol = self.store.create_protocol(
            {
                "strategy_version_id": strategy["id"],
                "name": "U5 fixture",
                "dataset_id": manifest["dataset_id"],
                "dataset_sha256": manifest["normalized_sha256"],
                "data_start_ms": 0,
                "cutoff_ms": cutoff_ms,
                "seed": 7,
                "parameters": {
                    "starting_balance": 10000,
                    "spread_price": 0.0002,
                    "cost_model": {
                        "version": "fixture-cost-v1",
                        "spread_basis": "bid_ask_embedded",
                        "commission_per_side_account": 1.0,
                        "minimum_fee_account": 0,
                        "slippage_price_per_side": 0,
                        "financing_account": 0,
                        "quote_to_account_rate": 1,
                        "account_ccy": "USD",
                        "rounding_decimals": 2,
                    },
                },
            }
        )
        return self.store.create_run(
            {"protocol_id": protocol["id"], "budget": {"max_bars": 100, "max_runtime_ms": 5000}}
        )

    def test_engine_runs_dataset_to_ledger_metrics_and_is_reproducible(self):
        manifest = self._import_dataset()
        first = self._run(manifest)
        runner = ResearchEngineRunner(self.store, self.data_root)
        completed = runner.execute(first["id"])
        self.assertEqual(completed["status"], "completed")
        result = completed["result"]
        self.assertEqual(result["engine_version"], "bar-breakout-v1")
        self.assertGreaterEqual(len(result["ledger"]), 1)
        self.assertEqual(result["metrics"]["closed_trade_count"], len(result["ledger"]))
        self.assertTrue(all(item["open_time_utc"] >= item["signal_time_utc"] for item in result["ledger"]))
        self.assertTrue(all(item["fees"] >= 0 for item in result["ledger"]))

        second = self.store.create_run(
            {
                "protocol_id": first["protocol_id"],
                "budget": {"max_bars": 100, "max_runtime_ms": 5000},
            }
        )
        second_completed = runner.execute(second["id"])
        first_business = {key: result[key] for key in ("strategy", "dataset", "assumptions", "signals", "ledger", "metrics")}
        second_business = {key: second_completed["result"][key] for key in first_business}
        self.assertEqual(first_business, second_business)

        validation = validate_engine_result(result)
        self.assertTrue(validation["reconciled"])
        self.assertIn("mae_mfe", validation["blocked_by_data"])

        analytics = research_analytics_report(result)
        self.assertTrue(analytics["reconciled"])
        self.assertEqual(
            len(analytics["planned_vs_realized_r"]),
            analytics["metrics"]["closed_trade_count"],
        )
        self.assertTrue(analytics["breakdowns"]["utc_close_day"])
        self.assertIn("prop_rule_evaluation", analytics["blocked_by_data"])

        tampered = dict(result)
        tampered["ledger"] = [dict(item) for item in result["ledger"]]
        tampered["ledger"][0]["net_pnl"] += 1
        with self.assertRaises(ResearchReconciliationError):
            validate_engine_result(tampered)

    def test_engine_refuses_locked_holdout(self):
        manifest = self._import_dataset({"mode": "metadata_only", "from_utc": 18000})
        run = self._run(manifest, cutoff_ms=21_600_000)
        with self.assertRaises(ResearchEngineDataDenied):
            ResearchEngineRunner(self.store, self.data_root).execute(run["id"])
        self.assertEqual(self.store.get_run(run["id"])["status"], "failed")


if __name__ == "__main__":
    unittest.main()
