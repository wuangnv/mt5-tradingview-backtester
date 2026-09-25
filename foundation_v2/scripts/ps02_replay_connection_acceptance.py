from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import psycopg

from f6_acceptance import free_port, run, wait_ready


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
SOURCE_PATHS = (
    V2 / "trading_workspace_v2" / "execution_semantics.py",
    V2 / "trading_workspace_v2" / "replay_execution.py",
    V2 / "trading_workspace_v2" / "prop_replay.py",
    V2 / "trading_workspace_v2" / "replay.py",
    V2 / "trading_workspace_v2" / "research_engine.py",
    V2 / "trading_workspace_v2" / "contracts.py",
    V2 / "trading_workspace_v2" / "prop_session.py",
    V2 / "trading_workspace_v2" / "store.py",
    V2 / "trading_workspace_v2" / "api.py",
    V2 / "tests" / "test_replay_execution_core.py",
    V2 / "tests" / "test_ps02_replay_prop_connection.py",
    V2 / "tests" / "test_ps02_prop_lifecycle.py",
    V2 / "tests" / "test_u5b_protective_margin.py",
    V2 / "tests" / "test_f7_product_slice.py",
    Path(__file__),
)

TEST_MODULES = (
    "foundation_v2.tests.test_ps00_prop_session_contract",
    "foundation_v2.tests.test_ps01_prop_persistence",
    "foundation_v2.tests.test_ps02_prop_lifecycle",
    "foundation_v2.tests.test_f7_product_slice",
    "foundation_v2.tests.test_u5b_protective_margin",
    "foundation_v2.tests.test_replay_execution_core",
    # Keep this last because earlier regression fixtures may truncate disposable tables.
    "foundation_v2.tests.test_ps02_replay_prop_connection",
)


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

    with tempfile.TemporaryDirectory(prefix="tw-ps02-replay-") as temp_raw:
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
        db_dsn = f"host=127.0.0.1 port={port} user=postgres dbname=tw_ps02_replay"
        try:
            wait_ready(admin_dsn, server)
            with psycopg.connect(admin_dsn, autocommit=True) as conn:
                conn.execute("CREATE DATABASE tw_ps02_replay")

            env = os.environ.copy()
            env["TW_V2_DATABASE_URL"] = db_dsn
            env["TW_V2_ARTIFACT_ROOT"] = str(artifacts)
            env["TW_V2_ALLOW_DESTRUCTIVE_TEST_DB"] = "1"
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
                    *TEST_MODULES,
                    "-v",
                ],
                env=env,
                cwd=ROOT,
            )

            with psycopg.connect(db_dsn) as conn:
                replay_prop_receipts = conn.execute(
                    "SELECT count(*) FROM prop_mutation_receipts WHERE operation_id LIKE 'replay-prop-%'"
                ).fetchone()[0]
                bound_attempts = conn.execute(
                    "SELECT count(*) FROM prop_attempts WHERE resume_json ? 'replay_binding'"
                ).fetchone()[0]
                canonical_replays = conn.execute(
                    """
                    SELECT count(*)
                    FROM workspace_records r
                    JOIN workspace_record_revisions v
                      ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id
                     AND v.revision=r.current_revision
                    WHERE r.kind='replay' AND v.payload_json ? 'execution'
                      AND jsonb_array_length(v.payload_json->'execution'->'ledger') >= 2
                    """
                ).fetchone()[0]

            source_hashes = {
                path.relative_to(ROOT).as_posix(): sha256(path)
                for path in SOURCE_PATHS
            }
            summary_text = "\n".join(item for item in (tests.stdout, tests.stderr) if item)
            match = re.search(r"Ran\s+(\d+)\s+tests?\s+in", summary_text)
            tests_run = int(match.group(1)) if match else None
            checks = {
                "focused_regression_pass": tests.returncode == 0,
                "postgres_replay_prop_receipt_persisted": replay_prop_receipts >= 1,
                "postgres_prop_attempt_bound_to_replay": bound_attempts >= 1,
                "postgres_replay_execution_ledger_persisted": canonical_replays >= 1,
                "broker_execution_capability": False,
            }
            overall_pass = all(
                value
                for name, value in checks.items()
                if name != "broker_execution_capability"
            ) and checks["broker_execution_capability"] is False
            receipt = {
                "schema": "PS02-REPLAY-CONNECTION-r1",
                "at_utc": datetime.now(timezone.utc).isoformat(),
                "result": "PASS" if overall_pass else "FAIL",
                "scope": (
                    "simulation-only canonical Replay market-fill/price-mark ledger feeding persisted Prop lifecycle "
                    "on a fresh disposable PostgreSQL cluster; no broker, holdout, provider or production capability"
                ),
                "checks": checks,
                "postgresql": {
                    "database": "tw_ps02_replay",
                    "ephemeral_cluster": True,
                    "loopback_only": True,
                },
                "tests": {
                    "modules": list(TEST_MODULES),
                    "tests_run": tests_run,
                    "return_code": tests.returncode,
                },
                "source_sha256": source_hashes,
                "residual_scope": [
                    "execution-enabled rewind/branch checkpoint reconstruction",
                    "lower-timeframe or tick intrabar equity path for full equity-rule coverage",
                    "cross-asset marks, financing/calendar accrual and broader D15 quality fixtures",
                    "start/pause/resume, multi-phase carry/reset lifecycle commands",
                    "Prop objective UI, reports/export and Figma acceptance",
                    "broker/demo/live, holdout, paid provider and deployment acceptance",
                ],
            }
            evidence_dir.mkdir(parents=True, exist_ok=True)
            receipt_path = evidence_dir / "PS02-replay-connection-r1.json"
            receipt_path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            print(f"PS02_REPLAY_RECEIPT={receipt_path}")
            print(f"PS02_REPLAY_RECEIPT_SHA256={sha256(receipt_path)}")
            print(f"PS02_REPLAY_CONNECTION={'PASS' if overall_pass else 'FAIL'}")
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
