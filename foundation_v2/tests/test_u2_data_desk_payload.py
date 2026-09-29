from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
import sys

from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
for entry in (str(ROOT), str(V2)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from trading_workspace_v2.api import CsvDataImportRequest, _materialize_csv_payload
from trading_workspace_v2.contracts import DatasetSource
from trading_workspace_v2.data_ingest import DataImportError, preview_csv
from trading_workspace_v2.retained import InstrumentSpec


def source_fixture() -> DatasetSource:
    return DatasetSource(
        source_id="data-desk-payload-fixture",
        provider="offline-fixture",
        instrument_mapping={"EURUSDm": "EURUSDm"},
        license_use="test-only",
        retrieved_at_utc="2026-09-29T00:00:00Z",
        export_settings="payload-test-v1",
    )


def instrument_fixture() -> InstrumentSpec:
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


def csv_text(rows: str) -> str:
    return "time,open,high,low,close,volume\n" + rows


class DataDeskPayloadTests(unittest.TestCase):
    def test_valid_preview_has_hash_quality_and_locked_holdout_metadata(self):
        payload = csv_text(
            "2026-01-05T00:00:00Z,1.1,1.2,1.0,1.15,10\n"
            "2026-01-05T01:00:00Z,1.15,1.22,1.1,1.2,11\n"
        )
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "valid.csv"
            path.write_text(payload, encoding="utf-8")
            preview = preview_csv(
                path,
                source_fixture(),
                instrument_fixture(),
                3600,
                holdout_policy={"mode": "metadata_only", "from_utc": 1_800_000_000},
            )

        self.assertEqual(preview["quality"]["disposition"], "pass")
        self.assertEqual(preview["row_count"], 2)
        self.assertEqual(preview["unique_row_count"], 2)
        self.assertRegex(preview["raw_sha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(preview["normalized_sha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(preview["dataset_id"], r"^dataset-[0-9a-f]{64}$")
        self.assertEqual(preview["holdout_policy"], {"mode": "metadata_only", "from_utc": 1_800_000_000})

    def test_quality_report_marks_duplicates_and_out_of_order_rows(self):
        payload = csv_text(
            "2026-01-05T02:00:00Z,1,2,1,1.5,1\n"
            "2026-01-05T00:00:00Z,1,2,1,1.5,1\n"
            "2026-01-05T00:00:00Z,1,2,1,1.5,1\n"
        )
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "quality.csv"
            path.write_text(payload, encoding="utf-8")
            preview = preview_csv(path, source_fixture(), instrument_fixture(), 3600)

        self.assertEqual(preview["quality"]["duplicates"], 1)
        self.assertEqual(preview["quality"]["out_of_order"], 1)
        self.assertEqual(preview["quality"]["disposition"], "review")

    def test_missing_columns_and_naive_timezone_fail_closed(self):
        with tempfile.TemporaryDirectory() as root:
            missing = Path(root) / "missing.csv"
            missing.write_text("time,open,high,low\n1,1,2,1\n", encoding="utf-8")
            with self.assertRaisesRegex(DataImportError, "missing required columns: close"):
                preview_csv(missing, source_fixture(), instrument_fixture(), 3600)

            naive = Path(root) / "naive.csv"
            naive.write_text(
                csv_text("2026-01-05T00:00:00,1,2,1,1.5,1\n"),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(DataImportError, "ISO time must include timezone"):
                preview_csv(naive, source_fixture(), instrument_fixture(), 3600)

    def test_payload_contract_rejects_paths_and_enforces_size(self):
        body = CsvDataImportRequest.model_validate(
            {
                "csv_text": csv_text("1,1,2,1,1.5,1\n1,1.5,2,1,1.6,1\n"),
                "source": source_fixture().model_dump(mode="json"),
                "instrument": instrument_fixture().__dict__,
                "timeframe_seconds": 3600,
            }
        )
        with _materialize_csv_payload(body.csv_text) as path:
            self.assertTrue(path.is_file())
            self.assertEqual(path.read_text(encoding="utf-8"), body.csv_text)
        self.assertFalse(path.exists())

        with self.assertRaises(ValidationError):
            CsvDataImportRequest.model_validate(
                {
                    **body.model_dump(mode="json"),
                    "path": "C:/should-never-be-read.csv",
                }
            )
        with self.assertRaisesRegex(ValueError, "10 MiB import limit"):
            with _materialize_csv_payload("x" * (10 * 1024 * 1024 + 1)):
                pass


if __name__ == "__main__":
    unittest.main()
