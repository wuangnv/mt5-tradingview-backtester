from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
for entry in (str(ROOT), str(V2)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.artifact_backup import create_backup_bundle, restore_backup_files, verify_backup_bundle
from trading_workspace_v2.contracts import ChartAnnotationDraft, DatasetSource, PlaybookDraft
from trading_workspace_v2.product import ProductService
from trading_workspace_v2.research import ResearchService
from trading_workspace_v2.replay import ReplayService
from trading_workspace_v2.replay_analytics import build_replay_analytics_view
from trading_workspace_v2.store import PostgresStore


def run(command: list[str]) -> str:
    completed = subprocess.run(command, text=True, capture_output=True, encoding="utf-8", errors="replace", timeout=120)
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout or "command failed").strip())
    return completed.stdout.strip()


def database_dsn(host: str, port: int, user: str, database: str) -> str:
    return make_conninfo(host=host, port=port, user=user, dbname=database)


@contextmanager
def disposable_databases(admin_dsn: str):
    suffix = uuid4().hex[:10]
    databases = (f"tw_restore_src_{suffix}", f"tw_restore_dst_{suffix}")
    created = []
    try:
        with psycopg.connect(admin_dsn, autocommit=True, connect_timeout=5) as conn:
            for name in databases:
                conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
                created.append(name)
        yield databases
    finally:
        with psycopg.connect(admin_dsn, autocommit=True, connect_timeout=5) as conn:
            for name in reversed(created):
                conn.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def table_counts(store: PostgresStore) -> dict[str, int]:
    with store.connect() as conn:
        names = conn.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name"
        ).fetchall()
        return {
            row["table_name"]: int(conn.execute(
                sql.SQL("SELECT count(*) AS n FROM {}").format(sql.Identifier(row["table_name"]))
            ).fetchone()["n"])
            for row in names
        }


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
            status="draft",
            execution_capability="manual-only",
            rules={"entry": "fixture"},
        ),
    )
    playbook = product.freeze_playbook("restore-tenant", playbook["record_id"], playbook["revision"])
    completed = store.get_job("restore-tenant", job.job_id)
    replay = ReplayService(store, artifacts)
    session = replay.create("restore-tenant", dataset.dataset_id)
    session_id = session["record_id"]
    replay.update_metadata(
        "restore-tenant", session_id, session["revision"],
        {"name": "Restore replay", "description": "Synthetic restore fixture"},
    )
    session = replay.view("restore-tenant", session_id)
    session = replay.initialize_execution(
        "restore-tenant", session_id, session["revision"],
        instrument_spec={
            "instrument_id": "EURUSD", "asset_class": "fx", "base_ccy": "EUR",
            "quote_ccy": "USD", "account_ccy": "USD", "tick_size": "0.0001",
            "pip_size": "0.0001", "contract_size": "100000", "quantity_min": "0.01",
            "quantity_step": "0.01", "effective_from_utc": "1970-01-01T00:00:00Z", "effective_to_utc": "",
        },
        cost_model={
            "version": "restore-cost-v1", "spread_basis": "bid_ask_embedded",
            "commission_per_side_account": "1", "minimum_fee_account": "0",
            "slippage_price_per_side": "0", "financing_account": "0",
            "quote_to_account_rate": "1", "account_ccy": "USD", "rounding_decimals": 2,
        },
        spread_price="0", timeframe_seconds=60, starting_balance="10000",
    )
    session = replay.queue_market_order(
        "restore-tenant", session_id, session["revision"], operation_id="restore-order",
        side="BUY", quantity="0.01", stop_loss="1.09", take_profit="1.12",
    )
    session = replay.step("restore-tenant", session_id, session["revision"], steps=2)
    branch = replay.branch("restore-tenant", session_id, session["revision"], cursor_index=1)
    annotation = product.create_annotation("restore-tenant", ChartAnnotationDraft(
        annotation_type="horizontal-line", instrument_id="EURUSD", timeframe="1m",
        cutoff_timestamp=1060, anchors=[{"timestamp": 1060, "price": 1.12}],
        source="restore-fixture", run_id=session_id, label="Restore drawing",
    ))
    annotation = product.update_annotation(
        "restore-tenant", annotation["record_id"], annotation["revision"],
        {**annotation["payload"], "label": "Revised restore drawing"},
    )
    return {
        "dataset_id": dataset.dataset_id,
        "dataset_sha256": dataset.artifact_sha256,
        "job_id": job.job_id,
        "result_sha256": completed.result_sha256,
        "playbook_id": playbook["record_id"],
        "playbook_revision": playbook["revision"],
        "session_id": session_id,
        "branch_id": branch["record_id"],
        "annotation_id": annotation["record_id"],
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
    if args.host not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit("restore rehearsal requires an explicitly selected loopback PostgreSQL host")

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

    admin_dsn = database_dsn(args.host, args.port, args.user, args.admin_db)
    with psycopg.connect(admin_dsn, connect_timeout=5) as conn:
        server_major = int(conn.execute("SHOW server_version_num").fetchone()[0]) // 10000
        server_version = conn.execute("SHOW server_version").fetchone()[0]
    tool_versions = {binary.name: run([str(binary), "--version"]) for binary in (pg_dump, pg_restore)}
    for name, version in tool_versions.items():
        match = re.search(r"PostgreSQL\)?\s+(\d+)", version)
        if match is None or int(match.group(1)) != server_major:
            raise SystemExit(f"{name} must match PostgreSQL server major {server_major}; select --pg-bin explicitly")

    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with disposable_databases(admin_dsn) as (source_db, target_db), tempfile.TemporaryDirectory(prefix="tw-f7-restore-") as temp_raw:
        temp = Path(temp_raw)
        source_artifacts = temp / "source-artifacts"
        dump_path = temp / "metadata.dump"
        source_store = PostgresStore(database_dsn(args.host, args.port, args.user, source_db))
        source_store.initialize()
        fixture = seed(source_store, ArtifactStore(source_artifacts))
        source_counts = table_counts(source_store)
        source_replay = ReplayService(source_store, ArtifactStore(source_artifacts))
        expected_records = {kind: source_store.list_records("restore-tenant", kind) for kind in ("replay", "annotation")}
        expected_history = source_replay.analytics_record("restore-tenant", fixture["session_id"], cursor_index=0)
        expected_analytics = build_replay_analytics_view(source_replay.analytics_record("restore-tenant", fixture["session_id"]))

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
        # This synthetic source has no running workers/writers. A live backup
        # must establish the same quiescence before pg_dump and reference capture.
        backup_bundle = temp / "backup-bundle"
        backup_manifest = create_backup_bundle(
            source_artifacts, dump_path, backup_bundle,
            artifact_references={str(path.relative_to(source_artifacts)): sha256(path) for path in source_artifacts.rglob("*") if path.is_file()},
            snapshot_id=source_db, mutations_quiesced=True,
        )
        restored_files = temp / "restored-files"
        checked_dump = restore_backup_files(backup_bundle, restored_files)
        target_artifacts = restored_files / "artifacts"
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
                str(checked_dump),
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
        restored_replay = ReplayService(target_store, target_artifact_store)
        restored_history = restored_replay.analytics_record("restore-tenant", fixture["session_id"], cursor_index=0)
        restored_analytics = build_replay_analytics_view(restored_replay.analytics_record("restore-tenant", fixture["session_id"]))
        restored_session = restored_replay.view("restore-tenant", fixture["session_id"])
        restored_branch = restored_replay.view("restore-tenant", fixture["branch_id"])
        restored_annotation = target_store.get_record("restore-tenant", "annotation", fixture["annotation_id"])

        checks = {
            "backup_bundle_verified": verify_backup_bundle(backup_bundle) == backup_manifest,
            "metadata_counts_match": source_counts == target_counts,
            "dataset_hash_match": restored_dataset.artifact_sha256 == fixture["dataset_sha256"],
            "result_hash_match": restored_job.result_sha256 == fixture["result_sha256"],
            "dataset_artifact_readable": len(rows) == 3,
            "result_artifact_readable": result.get("job_id") == fixture["job_id"],
            "playbook_revision_restored": restored_playbook is not None and restored_playbook["revision"] == fixture["playbook_revision"] and restored_playbook["payload"]["status"] == "frozen",
            "cross_tenant_denied_by_scope": target_store.get_job("other-tenant", fixture["job_id"]) is None,
            "replay_records_and_revisions_restored": all(target_store.list_records("restore-tenant", kind) == records for kind, records in expected_records.items()),
            "historical_execution_projection_restored": restored_history == expected_history,
            "historical_read_keeps_canonical_cursor": restored_session["canonical_cursor_index"] == 2,
            "branch_lineage_and_cutoff_restored": restored_branch["payload"]["parent_session_id"] == fixture["session_id"] and restored_branch["canonical_cursor_index"] == 1,
            "drawing_revision_restored": restored_annotation["revision"] == 2 and restored_annotation["payload"]["label"] == "Revised restore drawing",
            "replay_cross_tenant_denied": target_store.get_record("other-tenant", "replay", fixture["session_id"]) is None,
            "canonical_execution_analytics_restored": restored_analytics == expected_analytics,
            "canonical_trade_oracle_matches": restored_analytics["metrics"]["closed_trade_count"] == 1 and restored_analytics["metrics"]["net_pnl"] == 18,
        }
        receipt = {
            "schema": "F7-RESTORE-REHEARSAL-r2",
            "result": "PASS" if all(checks.values()) else "FAIL",
            "scope": "temporary PostgreSQL metadata dump/restore plus immutable artifact directory copy; synthetic fixture only",
            "checks": checks,
            "source_counts": source_counts,
            "target_counts": target_counts,
            "fixture": fixture,
            "dump_sha256": sha256(dump_path),
            "broker_execution_capability": False,
            "runtime": {"postgres_server": server_version, "tools": tool_versions},
        }
    receipt["temporary_databases_removed"] = True
    output.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(receipt, sort_keys=True))
    return 0 if receipt["result"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
