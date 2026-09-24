"""Run the U2 D12 benchmark on a generated, clearly synthetic CSV fixture."""

import csv
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data_benchmark import benchmark_preview  # noqa: E402
from data_contracts import InstrumentSpec, SourceSpec  # noqa: E402


ROWS = 20000


def main():
    source = SourceSpec.from_mapping(
        {
            "source_id": "u2-benchmark-fixture-v1",
            "provider": "generated-offline-fixture",
            "instrument_mapping": {"EURUSD-QA": "EURUSD-QA"},
            "license_use": "qa-only",
            "retrieved_at_utc": "2026-09-19T00:00:00Z",
            "export_settings": "not-for-export",
        }
    )
    instrument = InstrumentSpec.from_mapping(
        {
            "instrument_id": "EURUSD-QA",
            "asset_class": "fx",
            "base_ccy": "EUR",
            "quote_ccy": "USD",
            "account_ccy": "USD",
            "tick_size": "0.00001",
            "pip_size": "0.0001",
            "contract_size": "100000",
            "quantity_min": "0.01",
            "quantity_step": "0.01",
            "effective_from_utc": "2026-01-01T00:00:00Z",
            "effective_to_utc": "",
        }
    )
    with tempfile.TemporaryDirectory() as temp_dir:
        path = Path(temp_dir) / "u2-20k.csv"
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["time", "open", "high", "low", "close", "volume"])
            for index in range(ROWS):
                timestamp = 1767225600 + index * 60
                base = 1.1 + (index % 100) * 0.000001
                writer.writerow([timestamp, f"{base:.6f}", f"{base + 0.0002:.6f}", f"{base - 0.0002:.6f}", f"{base + 0.00005:.6f}", 100 + index % 20])
        result = benchmark_preview(path, source, instrument, 60, "20k synthetic M1 bars")
        print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
