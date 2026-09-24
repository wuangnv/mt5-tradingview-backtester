import csv
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from data_contracts import CostModel, InstrumentSpec, SourceSpec
from data_benchmark import benchmark_preview
from data_costs import calculate_round_trip_cost
from data_import import DataImportError, import_csv, preview_csv
from data_news import visible_events
from workspace_data import DataAccessDenied, DataProviderRegistry, LocalChunksProvider, StaticMetadataProvider


def source_fixture():
    return SourceSpec.from_mapping(
        {
            "source_id": "fixture-source-v1",
            "provider": "offline-fixture",
            "instrument_mapping": {"EURUSDm": "EURUSDm"},
            "license_use": "test-only",
            "retrieved_at_utc": "2026-09-19T00:00:00Z",
            "export_settings": "fixture-only",
        }
    )


def instrument_fixture():
    return InstrumentSpec.from_mapping(
        {
            "instrument_id": "EURUSDm",
            "asset_class": "fx",
            "base_ccy": "EUR",
            "quote_ccy": "USD",
            "account_ccy": "USD",
            "tick_size": "0.00001",
            "pip_size": "0.0001",
            "contract_size": "100000",
            "quantity_min": "0.01",
            "quantity_step": "0.01",
            "effective_from_utc": "2025-01-01T00:00:00Z",
            "effective_to_utc": "",
        }
    )


class U2DataFoundationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def _write_csv(self, rows, name="bars.csv"):
        path = self.root / name
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["time", "open", "high", "low", "close", "volume"])
            writer.writeheader()
            writer.writerows(rows)
        return path

    def test_d01_preview_import_preserves_hash_count_range_and_refuses_overwrite(self):
        path = self._write_csv(
            [
                {"time": "2026-01-05T00:00:00Z", "open": "1.1", "high": "1.2", "low": "1.0", "close": "1.15", "volume": "10"},
                {"time": "2026-01-05T01:00:00Z", "open": "1.15", "high": "1.22", "low": "1.1", "close": "1.2", "volume": "11"},
            ]
        )
        preview = preview_csv(path, source_fixture(), instrument_fixture(), 3600)
        imported = import_csv(path, self.root / "imported", source_fixture(), instrument_fixture(), 3600)
        manifest = imported["manifest"]
        self.assertEqual(preview["raw_sha256"], manifest["raw_sha256"])
        self.assertEqual(preview["normalized_sha256"], manifest["normalized_sha256"])
        self.assertEqual(manifest["normalized_sha256"], manifest["normalized_copy_sha256"])
        self.assertEqual(preview["row_count"], 2)
        self.assertEqual(preview["available_range"], manifest["available_range"])
        self.assertEqual(preview["source"]["instrument_mapping"], {"EURUSDm": "EURUSDm"})
        self.assertEqual(preview["instrument"]["contract_size"], "100000")
        self.assertEqual(preview["raw_partition"]["byte_count"], path.stat().st_size)
        self.assertEqual(preview["raw_partition"]["schema"], ["time", "open", "high", "low", "close", "volume"])
        self.assertEqual(preview["raw_partition"]["timezone_policy"], "unix-seconds-or-explicit-offset")
        self.assertEqual(manifest["raw_copy_sha256"], hashlib.sha256(path.read_bytes()).hexdigest())
        with self.assertRaisesRegex(DataImportError, "immutable import refuses overwrite"):
            import_csv(path, self.root / "imported", source_fixture(), instrument_fixture(), 3600)

    def test_d02_time_order_duplicates_and_gap_classification_are_explicit(self):
        path = self._write_csv(
            [
                {"time": "2026-01-05T02:00:00+00:00", "open": 1, "high": 2, "low": 1, "close": 1, "volume": 1},
                {"time": "2026-01-05T00:00:00Z", "open": 1, "high": 2, "low": 1, "close": 1, "volume": 1},
                {"time": "2026-01-05T00:00:00Z", "open": 1, "high": 2, "low": 1, "close": 1, "volume": 1},
            ]
        )
        preview = preview_csv(
            path,
            source_fixture(),
            instrument_fixture(),
            3600,
            gap_classifier=lambda start, end: "missing_expected",
        )
        self.assertEqual(preview["quality"]["duplicates"], 1)
        self.assertEqual(preview["row_count"], 3)
        self.assertEqual(preview["unique_row_count"], 2)
        self.assertEqual(preview["quality"]["out_of_order"], 1)
        self.assertEqual(preview["quality"]["gaps"][0]["classification"], "missing_expected")
        self.assertEqual(preview["quality"]["gaps"][0]["missing_intervals"], 1)

        naive = self._write_csv(
            [{"time": "2026-01-05T00:00:00", "open": 1, "high": 2, "low": 1, "close": 1, "volume": 1}],
            "naive.csv",
        )
        with self.assertRaisesRegex(DataImportError, "must include timezone"):
            preview_csv(naive, source_fixture(), instrument_fixture(), 3600)

        empty = self._write_csv([], "empty.csv")
        empty_preview = preview_csv(empty, source_fixture(), instrument_fixture(), 3600)
        self.assertEqual(empty_preview["row_count"], 0)
        self.assertIsNone(empty_preview["available_range"])
        self.assertEqual(empty_preview["quality"]["disposition"], "missing_data")

        weekend = self._write_csv(
            [
                {"time": "2026-01-02T21:00:00Z", "open": 1, "high": 2, "low": 1, "close": 1, "volume": 1},
                {"time": "2026-01-05T00:00:00Z", "open": 1, "high": 2, "low": 1, "close": 1, "volume": 1},
            ],
            "weekend.csv",
        )
        weekend_preview = preview_csv(
            weekend,
            source_fixture(),
            instrument_fixture(),
            3600,
            gap_classifier=lambda start, end: "scheduled_closed",
        )
        self.assertEqual(weekend_preview["quality"]["gaps"][0]["classification"], "scheduled_closed")

    def test_d03_bid_ask_costs_include_two_sided_commission_without_spread_double_count(self):
        model = CostModel.from_mapping(
            {
                "version": "fixture-cost-v1",
                "spread_basis": "bid_ask_embedded",
                "commission_per_side_account": "1.50",
                "minimum_fee_account": "0",
                "slippage_price_per_side": "0.00001",
                "financing_account": "0.40",
                "quote_to_account_rate": "1",
                "account_ccy": "USD",
                "rounding_decimals": 2,
            }
        )
        buy = calculate_round_trip_cost(model, "BUY", "0.10", "100000", "1.1000", "1.1002", "1.1010", "1.1012")
        sell = calculate_round_trip_cost(model, "SELL", "0.10", "100000", "1.1010", "1.1012", "1.1000", "1.1002")
        self.assertEqual(buy["gross_account"], 8.0)
        self.assertEqual(sell["gross_account"], 8.0)
        self.assertEqual(buy["spread_cost_account"], 0.0)
        self.assertEqual(buy["commission_account"], 3.0)
        self.assertEqual(buy["slippage_account"], 0.2)
        self.assertEqual(buy["financing_account"], 0.4)
        self.assertEqual(buy["net_account"], 4.4)

    def test_d04_news_visibility_blocks_future_revision_and_labels_archive_proxy(self):
        events = [
            {
                "event_id": "known-before",
                "currency": "USD",
                "scheduled_time_utc": 200,
                "known_at_utc": 100,
                "event_type": "CPI",
                "impact_source": "fixture",
                "time_precision": "second",
                "revision_source": "initial",
            },
            {
                "event_id": "known-after",
                "currency": "USD",
                "scheduled_time_utc": 200,
                "known_at_utc": 180,
                "event_type": "CPI revision",
                "impact_source": "fixture",
                "time_precision": "second",
                "revision_source": "revision",
            },
            {
                "event_id": "archive-only",
                "currency": "EUR",
                "scheduled_time_utc": 120,
                "known_at_utc": None,
                "event_type": "PMI",
                "impact_source": "fixture",
                "time_precision": "minute",
                "revision_source": "archive",
            },
        ]
        visible = visible_events(events, 150)
        self.assertEqual([event["event_id"] for event in visible], ["known-before"])
        proxy = visible_events(events, 150, allow_archive_proxy=True)
        self.assertEqual([event["event_id"] for event in proxy], ["archive-only", "known-before"])
        self.assertEqual(proxy[0]["point_in_time_status"], "archive_proxy")

    def test_d04_history_read_is_decision_time_bounded_and_holdout_locked(self):
        chunks = self.root / "chunks" / "EURUSD" / "H1"
        chunks.mkdir(parents=True)
        bars = [
            {"time": 0, "open": 1, "high": 2, "low": 1, "close": 1.5, "volume": 1},
            {"time": 3600, "open": 1.5, "high": 2, "low": 1, "close": 1.6, "volume": 1},
            {"time": 7200, "open": 1.6, "high": 2, "low": 1, "close": 1.7, "volume": 1},
        ]
        (chunks / "meta.json").write_text(
            json.dumps(
                {
                    "symbol": "EURUSD",
                    "timeframe": "H1",
                    "count": len(bars),
                    "firstTime": 0,
                    "lastTime": 7200,
                    "chunks": [{"index": 0, "count": len(bars), "firstTime": 0, "lastTime": 7200}],
                }
            ),
            encoding="utf-8",
        )
        (chunks / "chunk_000000.json").write_text(json.dumps({"bars": bars}), encoding="utf-8")
        registry = DataProviderRegistry([LocalChunksProvider(self.root / "chunks")])

        visible = registry.read_through("local-chunks", "EURUSD", "H1", 7200, before_bars=10, holdout_from_utc=7200)
        self.assertEqual([bar["time"] for bar in visible], [0, 3600])
        self.assertTrue(all(bar["available_at"] <= 7200 for bar in visible))
        with self.assertRaisesRegex(DataAccessDenied, "locked holdout boundary"):
            registry.read_through("local-chunks", "EURUSD", "H1", 10800, holdout_from_utc=7200)

    def test_d07_same_inputs_are_reproducible_and_provider_boundary_is_replaceable(self):
        path = self._write_csv(
            [{"time": "2026-01-05T00:00:00Z", "open": 1, "high": 2, "low": 1, "close": 1.5, "volume": 1}]
        )
        first = preview_csv(path, source_fixture(), instrument_fixture(), 3600, holdout_policy={"mode": "metadata_only", "from_utc": 999})
        second = preview_csv(path, source_fixture(), instrument_fixture(), 3600, holdout_policy={"mode": "metadata_only", "from_utc": 999})
        self.assertEqual(first["preview_id"], second["preview_id"])
        self.assertEqual(first["dataset_id"], second["dataset_id"])

        changed_instrument = InstrumentSpec.from_mapping(
            {
                **instrument_fixture().__dict__,
                "contract_size": "1000",
            }
        )
        changed = preview_csv(path, source_fixture(), changed_instrument, 3600, holdout_policy={"mode": "metadata_only", "from_utc": 999})
        self.assertNotEqual(first["dataset_id"], changed["dataset_id"])

        registry = DataProviderRegistry(
            [
                StaticMetadataProvider("fixture-a", [{"dataset_key": "a"}]),
                StaticMetadataProvider("fixture-b", [{"dataset_key": "b"}], {"read_metadata": True, "news": True}),
            ]
        )
        self.assertEqual([item["provider_id"] for item in registry.list_datasets()], ["fixture-a", "fixture-b"])
        capabilities = {item["provider_id"]: item["capabilities"] for item in registry.capabilities()}
        self.assertFalse(capabilities["fixture-a"].get("news", False))
        self.assertTrue(capabilities["fixture-b"]["news"])

    def test_metadata_catalog_does_not_read_chunk_content(self):
        chunks = self.root / "chunks" / "EURUSD" / "H1"
        chunks.mkdir(parents=True)
        (chunks / "meta.json").write_text(
            json.dumps(
                {
                    "symbol": "EURUSD",
                    "timeframe": "H1",
                    "count": 2,
                    "firstTime": 0,
                    "lastTime": 3600,
                    "chunks": [{"index": 0, "count": 2, "firstTime": 0, "lastTime": 3600}],
                }
            ),
            encoding="utf-8",
        )
        # Deliberately invalid content: metadata catalog must not parse/hash it.
        (chunks / "chunk_000000.json").write_bytes(b"not-json-and-not-readable-as-bars")
        datasets = LocalChunksProvider(self.root / "chunks").list_datasets()
        self.assertEqual(datasets[0]["rows"], 2)
        self.assertIsNone(datasets[0]["content_sha256"])
        self.assertEqual(datasets[0]["quality_status"], "unverified_local_cache")

    def test_d12_benchmark_records_workload_memory_and_semantic_identity(self):
        path = self._write_csv(
            [
                {"time": "2026-01-05T00:00:00Z", "open": 1, "high": 2, "low": 1, "close": 1.5, "volume": 1},
                {"time": "2026-01-05T01:00:00Z", "open": 1.5, "high": 2, "low": 1, "close": 1.6, "volume": 2},
            ]
        )
        result = benchmark_preview(path, source_fixture(), instrument_fixture(), 3600, "unit fixture")
        self.assertEqual(result["workload"]["rows"], 2)
        self.assertGreaterEqual(result["cold"]["elapsed_ms"], 0)
        self.assertGreater(result["cold"]["python_peak_bytes"], 0)
        self.assertGreater(result["warm"]["python_peak_bytes"], 0)
        self.assertTrue(result["semantic_identity_preserved"])


if __name__ == "__main__":
    unittest.main()
