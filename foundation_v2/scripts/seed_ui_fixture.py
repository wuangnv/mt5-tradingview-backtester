from __future__ import annotations

import json
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
for entry in (str(ROOT), str(V2)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.contracts import DatasetSource
from trading_workspace_v2.research import ResearchService
from trading_workspace_v2.store import PostgresStore


def main() -> int:
    store = PostgresStore(os.environ["TW_V2_DATABASE_URL"])
    store.initialize()
    service = ResearchService(store, ArtifactStore(os.environ["TW_V2_ARTIFACT_ROOT"]))
    source = DatasetSource(
        source_id="f6-ui-fixture",
        provider="synthetic-f6",
        instrument_mapping={"EURUSD": "EURUSD"},
        license_use="qa-only",
        retrieved_at_utc="2026-09-22T00:00:00Z",
        export_settings="ui-fixture-v1",
    )
    rows = [
        {
            "timestamp": 1_710_000_000 + index * 60,
            "open": 1.08,
            "high": max(1.08, close) + 0.0002,
            "low": min(1.08, close) - 0.0002,
            "close": close,
            "volume": 100 + index,
        }
        for index, close in enumerate((1.0800, 1.0806, 1.0802, 1.0811, 1.0808, 1.0815))
    ]
    dataset = service.register_dataset(
        workspace_id="tenant-ui",
        source=source,
        instrument_id="EURUSD",
        timeframe="1m",
        rows=rows,
    )
    job = service.create_job(
        workspace_id="tenant-ui",
        dataset_id=dataset.dataset_id,
        strategy_version="close-delta-v1",
        starting_balance=10_000,
    )
    print(json.dumps({"workspace_id": "tenant-ui", "dataset_id": dataset.dataset_id, "job_id": job.job_id}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
