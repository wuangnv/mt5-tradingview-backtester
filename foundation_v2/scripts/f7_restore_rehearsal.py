from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

import psycopg


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
for entry in (str(ROOT), str(V2)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.contracts import DatasetSource, PlaybookDraft
from trading_workspace_v2.product import ProductService
from trading_workspace_v2.research import ResearchService
from trading_workspace_v2.store import PostgresStore


def run(command: list[str]) -> None:
    completed = subprocess.run(command, text=True, capture_output=True, encoding="utf-8", errors="replace")
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout or "command failed").strip())


def database_dsn(host: str, port: int, user: str, database: str) -> str:
    return f"host={host} port={port} user={user} dbname={database}"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def table_counts(store: PostgresStore) -> dict[str, int]:
    names = ("workspaces", "datasets", "research_jobs", "workspace_records", "workspace_record_revisions")
    with store.connect() as conn:
        return {name: int(conn.execute(f"SELECT count(*) AS n FROM {name}").fetchone()["n"]) for name in names}


def seed(store: PostgresStore, artifacts: ArtifactStore) -> dict:
    research = ResearchService(store, artifacts)
    product = ProductService(store)
    source = DatasetSource(
        source_id="f7-restore-fixture",
        provider="synthetic-f7",
        instrument_mapping={"EURUSD": "EURUSD"},
        license_use="qa-only",
        retrieved_at_utc="2026-09-22T00:00:00Z",
        export_settings="restore-rehearsal-v1",
    )
    dataset = research.register_dataset(
        workspace_id="restore-tenant",
        source=source,
        instrument_id="EURUSD",
        timeframe="1m",
        rows=[
            {"timestamp": 1000, "open": 1.10, "high": 1.11, "low": 1.09, "close": 1.10, "volume": 10},
            {"timestamp": 1060, "open": 1.10, "high": 1.12, "low": 1.10, "close": 1.11, "volume": 11},
            {"timestamp": 1120, "open": 1.11, "high": 1.13, "low": 1.10, "close": 1.12, "volume": 12},
        ],
    )
    job = research.create_job(
        workspace_id="restore-tenant",
        dataset_id=dataset.dataset_id,
        strategy_version="close-delta-v1",
        starting_balance=10_000,
    )
    result = research.run_one()
    if result is None or result.job_id != job.job_id:
        raise RuntimeError("restore fixture worker did not complete")
    playbook = product.create_playbook(
        "restore-tenant",
        PlaybookDraft(
            name="Restore fixture",
            status="frozen",
            execution_capability="manual-only",
            rules={"entry": "fixture"},
        ),
    )
    completed = store.get_job("restore-tenant", job.job_id)
    return {
        "dataset_id": dataset.dataset_id,
        "dataset_sha256": dataset.artifact_sha256,
        "job_id": job.job_id,
        "result_sha256": completed.result_sha256,
        "playbook_id": playbook["record_id"],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pg-bin", default=os.environ.get("TW_V2_PG_BIN"))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--user", default="postgres")
    parser.add_argument("--admin-db", default="postgres")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    if not args.pg_bin:
        workspace = ROOT.parents[1]
        candidates = sorted(
            workspace.glob(
                "planning/mt5-tradingview-backtester/research/foundation-validation/*/pg-dist/pgsql/bin"
            ),
            reverse=True,
        )
        args.pg_bin = str(candidates[0]) if candidates else None
    if not args.pg_bin:
        raise SystemExit("portable PostgreSQL bin was not found; use --pg-bin or TW_V2_PG_BIN")

    pg_bin = Path(args.pg_bin).resolve()
    pg_dump = pg_bin / "pg_dump.exe"
    pg_restore = pg_bin / "pg_restore.exe"
    for binary in (pg_dump, pg_restore):
        if not binary.is_file():
            raise SystemExit(f"missing PostgreSQL tool: {binary.name}")

    suffix = uuid4().hex[:10]
    source_db = f"tw_restore_src_{suffix}"
    target_db = f"tw_restore_dst_{suffix}"
    admin_dsn = database_dsn(args.host, args.port, args.user, args.admin_db)
    with psycopg.connect(admin_dsn, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{source_db}"')
        conn.execute(f'CREATE DATABASE "{target_db}"')

    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="tw-f7-restore-") as temp_raw:
        temp = Path(temp_raw)
        source_artifacts = temp / "source-artifacts"
        target_artifacts = temp / "target-artifacts"
        dump_path = temp / "metadata.dump"
        source_store = PostgresStore(database_dsn(args.host, args.port, args.user, source_db))
        source_store.initialize()
        fixture = seed(source_store, ArtifactStore(source_artifacts))
        source_counts = table_counts(source_store)

        run(
            [
                str(pg_dump),
                "-h",
                args.host,
                "-p",
                str(args.port),
                "-U",
                args.user,
                "-Fc",
                "-f",
                str(dump_path),
                source_db,
            ]
        )
        shutil.copytree(source_artifacts, target_artifacts)
        run(
            [
                str(pg_restore),
                "-h",
                args.host,
                "-p",
                str(args.port),
                "-U",
                args.user,
                "-d",
                target_db,
                "--no-owner",
                str(dump_path),
            ]
        )

        target_store = PostgresStore(database_dsn(args.host, args.port, args.user, target_db))
        target_counts = table_counts(target_store)
        restored_dataset = target_store.get_dataset("restore-tenant", fixture["dataset_id"])
        restored_job = target_store.get_job("restore-tenant", fixture["job_id"])
        restored_playbook = target_store.get_record("restore-tenant", "playbook", fixture["playbook_id"])
        target_artifact_store = ArtifactStore(target_artifacts)
        rows = target_artifact_store.read_dataset(restored_dataset.artifact_path, restored_dataset.artifact_sha256)
        result = target_artifact_store.read_json(restored_job.result_path, restored_job.result_sha256)

        checks = {
            "metadata_counts_match": source_counts == target_counts,
            "dataset_hash_match": restored_dataset.artifact_sha256 == fixture["dataset_sha256"],
            "result_hash_match": restored_job.result_sha256 == fixture["result_sha256"],
            "dataset_artifact_readable": len(rows) == 3,
            "result_artifact_readable": result.get("job_id") == fixture["job_id"],
            "playbook_revision_restored": restored_playbook is not None and restored_playbook["revision"] == 1,
            "cross_tenant_denied_by_scope": target_store.get_job("other-tenant", fixture["job_id"]) is None,
        }
        receipt = {
            "schema": "F7-RESTORE-REHEARSAL-r1",
            "result": "PASS" if all(checks.values()) else "FAIL",
            "scope": "temporary PostgreSQL metadata dump/restore plus immutable artifact directory copy; synthetic fixture only",
            "checks": checks,
            "source_counts": source_counts,
            "target_counts": target_counts,
            "fixture": fixture,
            "dump_sha256": sha256(dump_path),
            "broker_execution_capability": False,
        }
        output.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps(receipt, sort_keys=True))
        return 0 if receipt["result"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
