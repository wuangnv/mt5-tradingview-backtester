from __future__ import annotations

import csv
import os
import tempfile
import unittest
from pathlib import Path

from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.contracts import DatasetSource
from trading_workspace_v2.data_ingest import DataImportError, DataIngestService, preview_csv
from trading_workspace_v2.research import ResearchService
from trading_workspace_v2.retained import InstrumentSpec
from trading_workspace_v2.store import PostgresStore


def source_fixture():
    return DatasetSource(
        source_id="fixture-source-v2",
        provider="offline-fixture",
        instrument_mapping={"EURUSDm": "EURUSDm"},
        license_use="test-only",
        retrieved_at_utc="2026-09-22T00:00:00Z",
        export_settings="fixture-only",
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


@unittest.skipUnless(os.getenv("TW_V2_DATABASE_URL"), "U2 PostgreSQL fixture not configured")
class U2DataIngestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dsn = os.environ["TW_V2_DATABASE_URL"]
        cls.store = PostgresStore(cls.dsn)
        cls.store.initialize()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.artifacts = ArtifactStore(self.root / "artifacts")
        self.service = DataIngestService(self.store, self.artifacts)
        self.research = ResearchService(self.store, self.artifacts)
        with self.store.connect() as conn:
            conn.execute("TRUNCATE workspace_record_revisions,workspace_records,research_jobs,datasets,workspaces CASCADE")
            conn.commit()

    def tearDown(self):
        self.temp.cleanup()

    def write_csv(self, rows, name="bars.csv"):
        path = self.root / name
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["time", "open", "high", "low", "close", "volume"])
            writer.writeheader()
            writer.writerows(rows)
        return path

    def test_preview_and_import_preserve_identity_range_and_raw_copy(self):
        path = self.write_csv(
            [
                {"time": "2026-01-05T00:00:00Z", "open": "1.1", "high": "1.2", "low": "1.0", "close": "1.15", "volume": "10"},
                {"time": "2026-01-05T01:00:00Z", "open": "1.15", "high": "1.22", "low": "1.1", "close": "1.2", "volume": "11"},
            ]
        )
        preview = preview_csv(path, source_fixture(), instrument_fixture(), 3600)
        manifest = self.service.import_csv(
            workspace_id="tenant-data",
            path=path,
            source=source_fixture(),
            instrument=instrument_fixture(),
            timeframe_seconds=3600,
        )

        self.assertEqual(manifest.dataset_id, preview["dataset_id"])
        self.assertEqual(manifest.row_count, preview["row_count"])
        self.assertEqual(manifest.available_range, preview["available_range"])
        self.assertEqual(manifest.raw_sha256, preview["raw_sha256"])
        self.assertEqual(manifest.normalized_sha256, preview["normalized_sha256"])
        self.assertEqual(manifest.quality["disposition"], "pass")
        self.assertEqual(len(self.artifacts.read_dataset(manifest.artifact_path, manifest.artifact_sha256)), 2)
        raw = self.artifacts.root / manifest.raw_artifact_path
        self.assertEqual(raw.read_bytes(), path.read_bytes())
        with self.assertRaisesRegex(DataImportError, "immutable import refuses overwrite"):
            self.service.import_csv(
                workspace_id="tenant-data",
                path=path,
                source=source_fixture(),
                instrument=instrument_fixture(),
                timeframe_seconds=3600,
            )

    def test_preview_exposes_duplicates_order_gaps_and_locked_holdout_metadata(self):
        path = self.write_csv(
            [
                {"time": "2026-01-05T02:00:00Z", "open": 1, "high": 2, "low": 1, "close": 1, "volume": 1},
                {"time": "2026-01-05T00:00:00Z", "open": 1, "high": 2, "low": 1, "close": 1, "volume": 1},
                {"time": "2026-01-05T00:00:00Z", "open": 1, "high": 2, "low": 1, "close": 1, "volume": 1},
            ]
        )
        preview = preview_csv(
            path,
            source_fixture(),
            instrument_fixture(),
            3600,
            holdout_policy={"mode": "metadata_only", "from_utc": 1_900_000_000},
            gap_classifier=lambda start, end: "missing_expected",
        )
        self.assertEqual(preview["quality"]["duplicates"], 1)
        self.assertEqual(preview["quality"]["out_of_order"], 1)
        self.assertEqual(preview["quality"]["gaps"][0]["classification"], "missing_expected")
        self.assertEqual(preview["quality"]["disposition"], "review")
        self.assertEqual(preview["holdout_policy"]["mode"], "metadata_only")

        manifest = self.service.import_csv(
            workspace_id="tenant-data",
            path=path,
            source=source_fixture(),
            instrument=instrument_fixture(),
            timeframe_seconds=3600,
            holdout_policy={"mode": "metadata_only", "from_utc": 1_900_000_000},
            gap_classifier=lambda start, end: "missing_expected",
        )
        with self.assertRaisesRegex(ValueError, "not QA-approved: review"):
            self.research.create_job(
                workspace_id="tenant-data",
                dataset_id=manifest.dataset_id,
                strategy_version="close-delta-v1",
                starting_balance=10_000,
            )

    def test_same_inputs_are_reproducible_and_instrument_change_changes_identity(self):
        path = self.write_csv(
            [
                {"time": "2026-01-05T00:00:00Z", "open": 1, "high": 2, "low": 1, "close": 1.5, "volume": 1},
                {"time": "2026-01-05T01:00:00Z", "open": 1.5, "high": 2, "low": 1, "close": 1.6, "volume": 2},
            ]
        )
        first = preview_csv(path, source_fixture(), instrument_fixture(), 3600)
        second = preview_csv(path, source_fixture(), instrument_fixture(), 3600)
        self.assertEqual(first["preview_id"], second["preview_id"])
        self.assertEqual(first["dataset_id"], second["dataset_id"])
        changed = InstrumentSpec.from_mapping({**instrument_fixture().__dict__, "contract_size": "1000"})
        third = preview_csv(path, source_fixture(), changed, 3600)
        self.assertNotEqual(first["dataset_id"], third["dataset_id"])

    def test_naive_time_and_insufficient_dataset_fail_closed(self):
        naive = self.write_csv(
            [{"time": "2026-01-05T00:00:00", "open": 1, "high": 2, "low": 1, "close": 1.5, "volume": 1}],
            "naive.csv",
        )
        with self.assertRaisesRegex(DataImportError, "must include timezone"):
            preview_csv(naive, source_fixture(), instrument_fixture(), 3600)

        one = self.write_csv(
            [{"time": "2026-01-05T00:00:00Z", "open": 1, "high": 2, "low": 1, "close": 1.5, "volume": 1}],
            "one.csv",
        )
        with self.assertRaisesRegex(DataImportError, "at least two rows"):
            self.service.import_csv(
                workspace_id="tenant-data",
                path=one,
                source=source_fixture(),
                instrument=instrument_fixture(),
                timeframe_seconds=3600,
            )

    def test_holdout_metadata_never_authorizes_content_past_boundary(self):
        path = self.write_csv(
            [
                {"time": "2026-01-05T00:00:00Z", "open": 1, "high": 2, "low": 1, "close": 1.5, "volume": 1},
                {"time": "2026-01-05T01:00:00Z", "open": 1.5, "high": 2, "low": 1, "close": 1.6, "volume": 2},
            ],
            "holdout.csv",
        )
        boundary = 1_767_571_200  # 2026-01-05T00:00:00Z
        with self.assertRaisesRegex(DataImportError, "crosses the locked holdout boundary"):
            preview_csv(
                path,
                source_fixture(),
                instrument_fixture(),
                3600,
                holdout_policy={"mode": "metadata_only", "from_utc": boundary},
            )
        with self.assertRaisesRegex(DataImportError, "holdout content access is not allowed"):
            preview_csv(
                path,
                source_fixture(),
                instrument_fixture(),
                3600,
                holdout_policy={"mode": "unlocked", "from_utc": boundary},
            )


if __name__ == "__main__":
    unittest.main()
