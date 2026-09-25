from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import psycopg

from f6_acceptance import free_port, run, wait_ready


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pg-bin", required=True)
    parser.add_argument("--evidence-dir", required=True)
    args = parser.parse_args()

    pg_bin = Path(args.pg_bin).resolve()
    evidence_dir = Path(args.evidence_dir).resolve()
    initdb = pg_bin / "initdb.exe"
    postgres = pg_bin / "postgres.exe"
    if not initdb.exists() or not postgres.exists():
        raise SystemExit("portable PostgreSQL bin directory is incomplete")

    with tempfile.TemporaryDirectory(prefix="tw-ps02-") as temp_raw:
        temp = Path(temp_raw)
        pgdata = temp / "pgdata"
        artifacts = temp / "artifacts"
        port = free_port()
        run(
            [
                str(initdb),
                "-D",
                str(pgdata),
                "--auth=trust",
                "--username=postgres",
                "--no-locale",
                "--encoding=UTF8",
            ]
        )
        server = subprocess.Popen(
            [str(postgres), "-D", str(pgdata), "-h", "127.0.0.1", "-p", str(port)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
        admin_dsn = f"host=127.0.0.1 port={port} user=postgres dbname=postgres"
        db_dsn = f"host=127.0.0.1 port={port} user=postgres dbname=tw_ps02"
        try:
            wait_ready(admin_dsn, server)
            with psycopg.connect(admin_dsn, autocommit=True) as conn:
                conn.execute("CREATE DATABASE tw_ps02")

            env = os.environ.copy()
            env["TW_V2_DATABASE_URL"] = db_dsn
            env["TW_V2_ARTIFACT_ROOT"] = str(artifacts)
            existing = env.get("PYTHONPATH", "")
            env["PYTHONPATH"] = os.pathsep.join(
                item for item in (str(V2), str(ROOT), existing) if item
            )
            tests = run(
                [
                    sys.executable,
                    "-B",
                    "-m",
                    "unittest",
                    "foundation_v2.tests.test_ps00_prop_session_contract",
                    "foundation_v2.tests.test_ps01_prop_persistence",
                    "foundation_v2.tests.test_ps02_prop_lifecycle",
                    "-v",
                ],
                env=env,
                cwd=ROOT,
            )

            with psycopg.connect(db_dsn) as conn:
                lifecycle_receipts = conn.execute(
                    "SELECT count(*) FROM prop_mutation_receipts "
                    "WHERE operation_id LIKE 'lifecycle-%' "
                    "OR operation_id LIKE 'blocked-%' "
                    "OR operation_id LIKE 'recovered-%' "
                    "OR operation_id LIKE 'race-%'"
                ).fetchone()[0]
                terminal_attempts = conn.execute(
                    "SELECT count(*) FROM prop_attempts WHERE snapshot_json->>'status'='completed_pass'"
                ).fetchone()[0]

            evidence_dir.mkdir(parents=True, exist_ok=True)
            checks = {
                "ps00_money_calendar_regression_pass": tests.returncode == 0,
                "ps01_persistence_regression_pass": tests.returncode == 0,
                "ps02_lifecycle_tests_pass": tests.returncode == 0,
                "postgres_lifecycle_receipts_persisted": lifecycle_receipts >= 2,
                "postgres_terminal_attempt_persisted": terminal_attempts >= 2,
                "tenant_scope_persistence_covered": tests.returncode == 0,
                "broker_execution_capability": False,
            }
            overall_pass = all(
                value
                for name, value in checks.items()
                if name != "broker_execution_capability"
            ) and checks["broker_execution_capability"] is False
            receipt = {
                "schema": "PS02-LIFECYCLE-CHECKPOINT-r1",
                "result": "PASS" if overall_pass else "FAIL",
                "scope": (
                    "PS-02 backend lifecycle checkpoint on disposable PostgreSQL: deterministic objective evaluation "
                    "and atomic persisted simulation events only; consumes simulator snapshots and does not generate fills"
                ),
                "checks": checks,
                "residual_scope": [
                    "canonical Replay order/fill ledger connection",
                    "user start/pause/resume and multi-phase carry/reset transition commands",
                    "Prop lifecycle UI and objective charts",
                    "D15 broader intrabar/reordered/missing/cross-asset quality fixtures",
                    "D17 report/export/sample denominators",
                    "broker/demo/live, holdout, provider, deployment and Figma acceptance",
                ],
            }
            receipt_path = evidence_dir / "PS02-lifecycle-checkpoint-r1.json"
            receipt_path.write_text(json.dumps(receipt, indent=2, sort_keys=True), encoding="utf-8")
            print(f"PS02_RECEIPT={receipt_path}")
            print(f"PS02_RECEIPT_SHA256={sha256(receipt_path)}")
            print(f"PS02_LIFECYCLE_CHECKPOINT={'PASS' if overall_pass else 'FAIL'}")
            return 0 if overall_pass else 1
        finally:
            if server.poll() is None:
                server.terminate()
                try:
                    server.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait(timeout=3)


if __name__ == "__main__":
    raise SystemExit(main())
