from __future__ import annotations

import csv
import json
import os
import platform
import sys
import tempfile
import time
import tracemalloc
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
for entry in (str(ROOT), str(V2)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from trading_workspace_v2.contracts import DatasetSource
from trading_workspace_v2.data_ingest import preview_csv
from trading_workspace_v2.retained import InstrumentSpec


def fixture_source() -> DatasetSource:
    return DatasetSource(
        source_id="u2-benchmark-v2",
        provider="generated-offline-fixture",
        instrument_mapping={"EURUSD": "EURUSD"},
        license_use="qa-only",
        retrieved_at_utc="2026-09-22T00:00:00Z",
        export_settings="20k-synthetic-m1-v2",
    )


def fixture_instrument() -> InstrumentSpec:
    return InstrumentSpec.from_mapping(
        {
            "instrument_id": "EURUSD",
            "asset_class": "fx",
            "base_ccy": "EUR",
            "quote_ccy": "USD",
            "account_ccy": "USD",
            "tick_size": "0.00001",
            "pip_size": "0.0001",
            "contract_size": "100000",
            "quantity_min": "0.01",
            "quantity_step": "0.01",
            "effective_from_utc": "2020-01-01T00:00:00Z",
            "effective_to_utc": None,
        }
    )


def write_fixture(path: Path, rows: int = 20_000) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["time", "open", "high", "low", "close", "volume"])
        start = 1_700_000_000
        for index in range(rows):
            price = 1.05 + index / 10_000_000
            writer.writerow(
                [
                    start + index * 60,
                    f"{price:.5f}",
                    f"{price + 0.0002:.5f}",
                    f"{price - 0.0002:.5f}",
                    f"{price + 0.0001:.5f}",
                    100 + index % 50,
                ]
            )


def measure(path: Path) -> dict:
    tracemalloc.start()
    started = time.perf_counter()
    preview = preview_csv(path, fixture_source(), fixture_instrument(), 60)
    elapsed_ms = (time.perf_counter() - started) * 1000
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return {
        "elapsed_ms": round(elapsed_ms, 3),
        "python_peak_bytes": peak,
        "dataset_id": preview["dataset_id"],
        "row_count": preview["row_count"],
        "quality_disposition": preview["quality"]["disposition"],
    }


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="tw-u2-benchmark-") as temp_dir:
        path = Path(temp_dir) / "u2-20k.csv"
        write_fixture(path)
        cold = measure(path)
        warm = measure(path)
        result = {
            "schema": "U2-D12-BENCHMARK-v2",
            "fixture": "20k synthetic M1 bars",
            "platform": platform.platform(),
            "machine": platform.machine(),
            "python": sys.version.split()[0],
            "cpu_count": os.cpu_count(),
            "cold": cold,
            "warm": warm,
            "semantic_identity_preserved": cold["dataset_id"] == warm["dataset_id"],
        }
        print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
