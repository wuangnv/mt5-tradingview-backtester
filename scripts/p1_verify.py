"""Read-only acceptance verifier for a P1 replay-session database."""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from evidence_store import EvidenceStore


class VerificationIncomplete(RuntimeError):
    def __init__(self, available_runs):
        super().__init__("P1 verification requires at least two persisted runs")
        self.available_runs = available_runs


def verify(db_path):
    path = Path(db_path)
    before_mtime = path.stat().st_mtime_ns
    store = EvidenceStore(path)
    runs = store.list_runs(2)
    if len(runs) < 2:
        raise VerificationIncomplete(len(runs))

    verified = []
    for summary in runs:
        run_id = summary["run_id"]
        detail = store.get_run(run_id)
        ledger = store.get_ledger(run_id)
        metrics = store.get_metrics(run_id)
        bundle = store.build_evidence_bundle(run_id)
        if bundle["run"] != detail or bundle["ledger"] != ledger or bundle["metrics"] != metrics:
            raise RuntimeError(f"run {run_id} export bundle differs from the read model")
        verified.append(
            {
                "run_id": run_id,
                "artifact_schema_version": detail["artifact_schema_version"],
                "metric_schema_version": metrics["metric_schema_version"],
                "comparison_ready": detail["comparison"]["ready"],
            }
        )

    after_mtime = path.stat().st_mtime_ns
    if after_mtime != before_mtime:
        raise RuntimeError("database mtime changed during read-only verification")
    if "mt5_data" in sys.modules or "app" in sys.modules:
        raise RuntimeError("P1 verification imported a legacy MT5 application module")

    return {
        "success": True,
        "run_count_verified": len(verified),
        "runs": verified,
        "database_mtime_unchanged": True,
        "mt5_modules_imported": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("db_path", help="Path to an existing replay-session SQLite database")
    args = parser.parse_args()
    try:
        result = verify(args.db_path)
    except VerificationIncomplete as exc:
        result = {
            "success": False,
            "error": {
                "code": "INSUFFICIENT_RUNS",
                "message": str(exc),
                "available_runs": exc.available_runs,
                "required_runs": 2,
            },
        }
        print(json.dumps(result, indent=2))
        raise SystemExit(2) from None
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
