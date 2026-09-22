"""Focused U5 checks, restricted to the named local disposable PostgreSQL fixture."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import psycopg


PROJECT = Path(__file__).resolve().parents[2]
V2 = PROJECT / "foundation_v2"
sys.path[:0] = [str(PROJECT), str(V2)]
MODULES = (
    "test_u5_engine_oracle", "test_u5_engine_path2", "test_u5_nautilus", "test_u2_data_ingest",
    "test_u3_playbook_journal", "test_f7_product_slice", "test_fh1_job_lifecycle",
    "test_fh2_workspace_auth", "test_reference_slice", "test_contracts", "test_u2_provider_boundary",
)


def hashes():
    paths = list((V2 / "trading_workspace_v2").glob("*.py")) + [V2 / "uv.lock", Path(__file__)]
    paths += [V2 / "tests" / f"{name}.py" for name in MODULES]
    paths += [PROJECT / name for name in ("data_contracts.py", "data_costs.py", "evidence_metrics.py")]
    return {path.relative_to(PROJECT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(paths)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if PROJECT not in output.parents or output.exists():
        raise SystemExit("evidence output must be a new path inside the project")
    dsn = os.environ["TW_V2_DATABASE_URL"]
    with psycopg.connect(dsn) as conn:
        database, data_dir, version = conn.execute("SELECT current_database(),current_setting('data_directory'),version()").fetchone()
        if conn.info.host != "127.0.0.1" or database != "tw_u5_resume_20260922":
            raise SystemExit("refusing tests outside the named local U5 fixture database")
        if Path(data_dir).resolve() != (V2 / ".runtime" / "f7-pgdata-20260922").resolve():
            raise SystemExit("PostgreSQL data directory is not the disposable project fixture")
    os.environ["TW_V2_ALLOW_DESTRUCTIVE_TEST_DB"] = "1"
    before = hashes()
    records = []
    with tempfile.TemporaryDirectory(prefix="u5-integrated-", dir=V2 / ".runtime") as temp:
        os.environ["TW_V2_ARTIFACT_ROOT"] = temp
        for name in MODULES:
            stream = io.StringIO()
            suite = unittest.defaultTestLoader.loadTestsFromName(f"foundation_v2.tests.{name}")
            result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
            log = stream.getvalue()
            print(log, flush=True)
            records.append({"module": name, "tests": result.testsRun, "skipped": len(result.skipped),
                            "passed": result.wasSuccessful() and not result.skipped, "log": log})
    stable = before == hashes()
    payload = {"schema": "u5-focused-validation-v1", "at_utc": datetime.now(timezone.utc).isoformat(),
               "scope": "local synthetic software and PostgreSQL integration; no empirical/broker/UI acceptance",
               "database": database, "data_directory": data_dir, "postgresql_version": version,
               "source_sha256": before, "source_unchanged_during_tests": stable, "checks": records,
               "passed": stable and all(item["passed"] for item in records)}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return 0 if payload["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
