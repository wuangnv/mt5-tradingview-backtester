"""Create a verified local PostgreSQL + full artifact backup before API cutover."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import traceback
from uuid import uuid4

FOUNDATION = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(FOUNDATION))

import psycopg
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from trading_workspace_v2.artifact_backup import create_backup_bundle, verify_backup_bundle
from trading_workspace_v2.artifacts import ArtifactStore, sha256_file


class BackupPreflightError(RuntimeError):
    pass


def require_stopped_port(port: int) -> None:
    if not 1 <= port <= 65535:
        raise BackupPreflightError("Invalid loopback API port.")
    for family, address in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
        with socket.socket(family, socket.SOCK_STREAM) as probe:
            if family == socket.AF_INET6:
                probe.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
            if os.name == "nt":
                probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            try:
                probe.bind((address, port))
            except OSError:
                raise BackupPreflightError("API loopback port is occupied or cannot be verified stopped; nothing was stopped.") from None


def database_preflight(config: dict) -> int:
    with psycopg.connect(make_conninfo(**config), connect_timeout=5) as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        for table in ("research_jobs", "api_commands"):
            present = conn.execute("SELECT to_regclass(%s)", (f"public.{table}",)).fetchone()[0]
            if present and conn.execute(f"SELECT count(*) FROM {table} WHERE status IN ('queued','running')").fetchone()[0]:
                raise BackupPreflightError("Research/API jobs are queued or running; finish/cancel them before backup.")
        present = conn.execute("SELECT to_regclass('public.download_job_snapshots')").fetchone()[0]
        if present and conn.execute("SELECT count(*) FROM download_job_snapshots WHERE snapshot->>'status' IN ('queued','running','pausing')").fetchone()[0]:
            raise BackupPreflightError("Download jobs are active; wait for a verified paused/terminal state.")
        if conn.execute("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'").fetchone()[0]:
            raise BackupPreflightError("Other database clients remain connected; stop API/workers/tools before backup.")
        return int(conn.execute("SELECT pg_database_size(current_database())").fetchone()[0])


def artifact_references(root: Path) -> tuple[dict[str, str], int]:
    store = ArtifactStore(root)
    references, total = {}, 0
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        store._path(relative)
        if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
            raise BackupPreflightError("Artifact symlink/junction cannot be backed up safely.")
        if path.is_dir():
            continue
        if not path.is_file():
            raise BackupPreflightError("Artifact tree contains a non-regular file.")
        if path.name.endswith(".tmp"):
            # Canceled downloads retain resumable partial bytes. Preserve them;
            # an arbitrary publication temp has no terminal ownership proof.
            checkpoint = path.parent / "job.json"
            try:
                terminal = relative.parts[0] in {"qdm", "dukascopy"} and checkpoint.is_file() and json.loads(
                    checkpoint.read_text(encoding="utf-8")).get("status") in {"paused", "completed", "failed", "canceled", "cancelled"}
            except (OSError, ValueError):
                terminal = False
            if not terminal:
                raise BackupPreflightError("Unfinished temporary file has no verified paused/terminal download owner.")
        if path.name == "job.json" and relative.parts[0] in {"qdm", "dukascopy"}:
            try:
                checkpoint = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                raise BackupPreflightError("Legacy download checkpoint cannot be verified.") from None
            if checkpoint.get("status") not in {"paused", "completed", "failed", "canceled", "cancelled"}:
                raise BackupPreflightError("Legacy download checkpoint is active or has an unknown state.")
        references[relative.as_posix()] = sha256_file(path)
        total += path.stat().st_size
    return references, total


def configuration(args) -> dict:
    try:
        config = conninfo_to_dict(os.environ.get("TW_V2_DATABASE_URL", ""))
    except Exception:
        raise BackupPreflightError("Database environment configuration is invalid.") from None
    if config.get("host") not in {"127.0.0.1", "localhost", "::1"} or config.get("hostaddr", config["host"]) not in {"127.0.0.1", "localhost", "::1"}:
        raise BackupPreflightError("Backup requires the existing loopback database.")
    config["dbname"] = args.database_name
    config["application_name"] = "tw-quiesced-backup-preflight"
    return config


def dump_database(config: dict, pg_dump: Path, target: Path, *, timeout: int) -> None:
    env = dict(os.environ)
    # Values stay in the child environment. No DSN/password appears in argv or
    # captured error output; service files must not override this explicit target.
    for key in ("PGSERVICE", "PGSERVICEFILE", "PGHOSTADDR", "PGOPTIONS"):
        env.pop(key, None)
    env.update(PGHOST=config["host"], PGPORT=str(config.get("port", "5432")), PGDATABASE=config["dbname"])
    if config.get("user"):
        env["PGUSER"] = config["user"]
    if config.get("password") is not None:
        env["PGPASSWORD"] = config["password"]
    env["PGCONNECT_TIMEOUT"] = "5"
    completed = subprocess.run([str(pg_dump), "--no-password", "--format=custom", "--file", str(target)],
                               env=env, capture_output=True, timeout=timeout)
    if completed.returncode:
        raise BackupPreflightError("pg_dump failed; no backup was accepted. Check PostgreSQL permissions/version without exposing connection secrets.")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-name", default="trading_workspace_v2_exness_history")
    parser.add_argument("--artifact-root", type=Path, default=FOUNDATION / ".runtime/exness-market-data")
    parser.add_argument("--pg-bin", type=Path, default=os.environ.get("TW_V2_PG_BIN"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--port", type=int, default=8010)
    parser.add_argument("--mutations-quiesced", action="store_true")
    parser.add_argument("--max-backup-bytes", type=int, default=1024 ** 4)
    parser.add_argument("--dump-timeout", type=int, default=1800)
    args = parser.parse_args(argv)
    if not args.mutations_quiesced:
        parser.error("--mutations-quiesced is required after stopping API/workers and every artifact writer.")
    try:
        config = configuration(args)
        require_stopped_port(args.port)
        root = args.artifact_root.resolve()
        if not root.is_dir():
            raise BackupPreflightError("Existing artifact directory is missing.")
        snapshot = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:12]
        runtime = (FOUNDATION / ".runtime").resolve()
        output = (args.output or runtime / "api-platform-backups" / snapshot).resolve()
        if runtime not in output.parents or output == root or root in output.parents or output in root.parents or output.exists():
            raise BackupPreflightError("Backup must be a new ignored .runtime directory outside the artifact tree.")
        binary = None if args.pg_bin is None else args.pg_bin / ("pg_dump.exe" if os.name == "nt" else "pg_dump")
        if binary is None or not binary.is_file():
            raise BackupPreflightError("Set --pg-bin/TW_V2_PG_BIN to the audited PostgreSQL bin directory.")
        database_bytes = database_preflight(config)
        references, artifact_bytes = artifact_references(root)
        estimate = artifact_bytes + database_bytes * 3 + 1024 ** 3
        if args.max_backup_bytes <= 0 or artifact_bytes + database_bytes > args.max_backup_bytes:
            raise BackupPreflightError("Backup exceeds the declared byte budget.")
        parent = output.parent
        parent.mkdir(parents=True, exist_ok=True)
        if shutil.disk_usage(parent).free < estimate:
            raise BackupPreflightError("Insufficient disk space for artifacts, temporary dump and safety reserve.")
        with tempfile.TemporaryDirectory(prefix=".tw-dump-", dir=parent) as temporary:
            dump = Path(temporary) / "metadata.dump"
            dump_database(config, binary.resolve(), dump, timeout=args.dump_timeout)
            require_stopped_port(args.port)
            database_preflight(config)
            if dump.stat().st_size + artifact_bytes > args.max_backup_bytes:
                raise BackupPreflightError("Actual dump exceeds the declared byte budget.")
            manifest = create_backup_bundle(root, dump, output, artifact_references=references,
                                            snapshot_id=snapshot, mutations_quiesced=True)
            if artifact_references(root)[0] != references:
                raise BackupPreflightError("Artifact files changed during backup; bundle is not accepted.")
            require_stopped_port(args.port)
            database_preflight(config)
            verify_backup_bundle(output, max_bytes=args.max_backup_bytes)
        print(json.dumps({"result": "PASS", "bundle": str(output), "snapshot_id": snapshot,
                          "manifest_sha256": sha256_file(output / "bundle/results/manifest.json"),
                          "artifact_files": len(references), "backup_bytes": sum(entry["size_bytes"] for entry in manifest["files"])}))
        return 0
    except Exception as exc:
        # psycopg/subprocess exceptions may contain DSNs; only our explicit safe
        # messages are emitted. An incomplete directory is retained for diagnosis.
        last = traceback.extract_tb(exc.__traceback__)[-1]
        message = str(exc) if isinstance(exc, BackupPreflightError) else (
            f"Backup failed ({type(exc).__name__} at {last.name}:{last.lineno}); no backup was accepted. "
            "No service was stopped and no database was modified.")
        if isinstance(exc, OSError) and exc.filename:
            message += f" File path length: {len(str(exc.filename))}; file: {Path(exc.filename).name}."
        print(message, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
