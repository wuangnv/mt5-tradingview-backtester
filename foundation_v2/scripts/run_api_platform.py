"""Own and supervise the loopback Rust API and its Python domain/research workers."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import ctypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from uuid import uuid4

FOUNDATION = Path(__file__).resolve().parents[1]
PROJECT = FOUNDATION.parent
sys.path.insert(0, str(FOUNDATION))


class PreflightError(RuntimeError):
    pass


def configuration(args):
    from psycopg.conninfo import conninfo_to_dict, make_conninfo

    config = conninfo_to_dict(os.environ.get("TW_V2_DATABASE_URL", ""))
    if config.get("host") not in {"127.0.0.1", "localhost", "::1"} or (config.get("hostaddr") is not None and config["hostaddr"] not in {"127.0.0.1", "::1"}):
        raise PreflightError("TW_V2_DATABASE_URL must identify the existing loopback database.")
    config["dbname"] = args.database_name
    env = dict(os.environ)
    env.update(TW_V2_DATABASE_URL=make_conninfo(**config),
               TW_V2_ARTIFACT_ROOT=str(args.artifact_root.resolve()),
               TW_V2_LOCAL_WORKSPACES="tenant-a", TW_V2_LOCAL_IDENTITY="local-owner",
               TW_V2_AUTH_MODE="local-trusted-identity", TW_V2_RUST_BIND=f"127.0.0.1:{args.port}",
               TW_V2_OPENAPI_PATH=str(FOUNDATION / "contracts/openapi.json"),
               PYTHONPATH=os.pathsep.join((str(FOUNDATION), str(PROJECT))),
               TW_V2_LEARN_WORKSPACE_ID="tenant-a",
               TW_V2_EDUCATION_ROOT=str(PROJECT.parents[1] / "education"))
    return env


def database_preflight(env, *, migrate=False, backup_confirmed=False, require_idle=False, allow_pending=False):
    import psycopg
    from psycopg.rows import dict_row
    from trading_workspace_v2.migrations import MIGRATION_DIRECTORY, apply_migrations

    with psycopg.connect(env["TW_V2_DATABASE_URL"], row_factory=dict_row, connect_timeout=5) as conn:
        exists = conn.execute("SELECT to_regclass('public.tw_schema_migrations') AS name").fetchone()["name"]
        tables = conn.execute("SELECT count(*) AS count FROM pg_tables WHERE schemaname='public'").fetchone()["count"]
        versions = {} if not exists else {r["version"]: r["sha256"] for r in conn.execute(
            "SELECT version,sha256 FROM tw_schema_migrations").fetchall()}
        expected = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in sorted(MIGRATION_DIRECTORY.glob("[0-9][0-9][0-9][0-9]_*.sql"))}
        if not expected or any(name not in expected or expected[name] != digest for name, digest in versions.items()):
            raise PreflightError("Database migration authority/checksum mismatch; restore the matching code before launch.")
        if require_idle or migrate:
            for table in ("research_jobs", "api_commands"):
                present = conn.execute("SELECT to_regclass(%s) AS name", (f"public.{table}",)).fetchone()["name"]
                if present and conn.execute(f"SELECT count(*) AS count FROM {table} WHERE status IN ('queued','running')").fetchone()["count"]:
                    raise PreflightError("A research/API job is active. Finish or cancel it before restart/migration.")
            present = conn.execute("SELECT to_regclass('public.download_job_snapshots') AS name").fetchone()["name"]
            if present and conn.execute("SELECT count(*) AS count FROM download_job_snapshots WHERE snapshot->>'status' IN ('queued','running','pausing')").fetchone()["count"]:
                raise PreflightError("A download is active. Pause it and wait until paused before restart/migration.")
        pending = sorted(set(expected) - set(versions))
        if pending and not migrate and not allow_pending:
            raise PreflightError("Schema migrations pending: " + ", ".join(pending) +
                                 ". Back up DB AND artifacts, then use --migrate --backup-confirmed (existing DB).")
        if pending and migrate:
            if tables and not backup_confirmed:
                raise PreflightError("Existing database requires a verified DB/artifact backup and --backup-confirmed before migration.")
            apply_migrations(conn)
        return {"schema_current": not pending or migrate, "migration_count": len(expected),
                "pending": [] if migrate else pending, "applied": pending if migrate else []}


def assert_no_legacy_download(root):
    # File checkpoints are still authoritative before explicit adoption into PostgreSQL.
    for checkpoint in (p for source in ("qdm", "dukascopy") for p in (root / source).glob("**/job.json")):
        try:
            value = json.loads(checkpoint.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise PreflightError("A legacy download checkpoint cannot be verified; nothing was stopped.") from None
        if value.get("status") in {"queued", "running", "pausing"}:
            raise PreflightError("A legacy download is active. Pause it before restarting or migrating.")


def validate_paths(args, *, need_binary=True):
    if not args.artifact_root.is_dir():
        raise PreflightError("Artifact directory is missing; restore it before launch.")
    if args.download_engine == "qdm" and not (args.qdm_home / "qdmcli.exe").is_file():
        raise PreflightError("Licensed local qdmcli.exe is missing; set --qdm-home or explicitly use --download-engine none.")
    if need_binary and not args.rust_binary.is_file():
        raise PreflightError("Rust release binary is missing. Run --build before launching.")


def port_is_free(port):
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def process_identity(pid):
    """PID, kernel creation time and executable prevent acting on a recycled PID."""
    if os.name != "nt":
        raise PreflightError("Managed restart ownership checks currently require Windows.")
    from ctypes import wintypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        if ctypes.get_last_error() == 87:  # No process currently has this PID.
            return None
        raise PreflightError("Cannot open owned process for identity verification; no stop was authorized.")
    try:
        times = [wintypes.FILETIME() for _ in range(4)]
        size = wintypes.DWORD(32768)
        buffer = ctypes.create_unicode_buffer(size.value)
        if not kernel.GetProcessTimes(handle, *[ctypes.byref(t) for t in times]):
            raise PreflightError("Cannot verify owned process identity.")
        if times[1].dwHighDateTime or times[1].dwLowDateTime:
            return None
        if not kernel.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
            # A graceful shutdown can finish between time and image queries.
            # An exited process may remain queryable while Popen holds its handle.
            exit_code = wintypes.DWORD()
            if kernel.GetExitCodeProcess(handle, ctypes.byref(exit_code)) and exit_code.value != 259:
                return None
            raise PreflightError("Cannot verify owned process identity.")
        return {"pid": pid, "created": (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime,
                "executable": str(Path(buffer.value).resolve())}
    finally:
        kernel.CloseHandle(handle)


def manifest_write(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


@contextmanager
def runtime_lock(manifest):
    import msvcrt
    manifest.parent.mkdir(parents=True, exist_ok=True)
    with manifest.with_suffix(".lock").open("a+b") as handle:
        if handle.seek(0, 2) == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise PreflightError("This runtime profile already has a supervisor; no second runtime was started.") from None
        try:
            yield
        finally:
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)


def sanitize_log(line, env):
    from psycopg.conninfo import conninfo_to_dict
    values = [env.get("TW_V2_DATABASE_URL", ""), os.environ.get("TW_V2_DATABASE_URL", "")]
    values.extend(value for key, value in env.items() if any(word in key.upper() for word in ("PASSWORD", "TOKEN", "SECRET", "API_KEY")))
    values.append(conninfo_to_dict(env["TW_V2_DATABASE_URL"]).get("password", ""))
    for value in sorted(set(values), key=len, reverse=True):
        if value:
            line = line.replace(value, "[redacted]")
    return line


def copy_log(stream, output, env):
    try:
        for raw in iter(stream.readline, b""):
            output.write(sanitize_log(raw.decode("utf-8", errors="replace"), env).encode("utf-8"))
            output.flush()
    finally:
        stream.close()


def owned_manifest(args):
    value = json.loads(args.manifest.read_text(encoding="utf-8"))
    if value.get("project") != str(PROJECT.resolve()) or value.get("port") != args.port:
        raise PreflightError("Runtime ownership manifest belongs to another project/port.")
    run_id = value.get("run_id", "")
    if len(run_id) != 32 or any(c not in "0123456789abcdef" for c in run_id):
        raise PreflightError("Runtime ownership manifest has an invalid run identity.")
    marker = args.manifest.parent / f"platform-{run_id}.stop"
    if value.get("stop_file") != str(marker.resolve()):
        raise PreflightError("Runtime shutdown marker is outside its expected owner scope.")
    python_paths = {Path(sys.executable).resolve(), Path(getattr(sys, "_base_executable", sys.executable)).resolve()}
    expected = {"supervisor": python_paths, "api": {args.rust_binary.resolve()},
                "domain": python_paths, "research": python_paths}
    for role, entry in value.get("processes", {}).items():
        if role not in expected or Path(entry["executable"]).resolve() not in expected[role]:
            raise PreflightError("Runtime executable ownership mismatch.")
        if process_identity(entry["pid"]) != entry:
            raise PreflightError("Runtime process changed or exited; stale manifest cannot stop it.")
    if set(value.get("processes", {})) != set(expected):
        raise PreflightError("Runtime ownership manifest is incomplete.")
    return value, marker


def stop_owned(args):
    value, marker = owned_manifest(args)
    marker.write_text("stop\n", encoding="ascii")
    deadline = time.monotonic() + 55
    while time.monotonic() < deadline:
        if all(process_identity(entry["pid"]) != entry for entry in value["processes"].values()):
            print("Owned runtime stopped.", flush=True)
            return
        time.sleep(0.25)
    raise PreflightError("Owned runtime did not stop within deadline; no unrelated process was killed.")


def worker_ready(env):
    import psycopg
    with psycopg.connect(env["TW_V2_DATABASE_URL"], connect_timeout=3) as conn:
        return conn.execute("SELECT EXISTS(SELECT 1 FROM api_command_workers WHERE heartbeat_at_utc > CURRENT_TIMESTAMP - interval '10 seconds' AND worker_id LIKE %s)",
                            (env["TW_V2_COMMAND_WORKER_PREFIX"] + "-%",)).fetchone()[0]


def supervise(args, env):
    if not port_is_free(args.port):
        raise PreflightError("Loopback API port is occupied. Use the guarded restart script; no process was stopped.")
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    if args.manifest.exists():
        try:
            previous = json.loads(args.manifest.read_text(encoding="utf-8"))
            parent = previous.get("processes", {}).get("supervisor")
            if parent and process_identity(parent["pid"]) == parent:
                raise PreflightError("A managed runtime is already alive; use guarded restart.")
        except (ValueError, KeyError):
            raise PreflightError("Invalid previous manifest; verify ownership before removing it.") from None
    run_id = uuid4().hex
    stop_file = args.manifest.parent / f"platform-{run_id}.stop"
    env["TW_V2_SHUTDOWN_FILE"] = str(stop_file.resolve())
    env["TW_V2_COMMAND_WORKER_PREFIX"] = f"platform-{run_id}"
    state = {"run_id": run_id, "project": str(PROJECT.resolve()), "port": args.port,
             "stop_file": str(stop_file.resolve()), "ready": False,
             "processes": {"supervisor": process_identity(os.getpid())}}
    commands = {
        "domain": [sys.executable, "-B", "-m", "trading_workspace_v2.api_command_worker",
                   "--server-origin", f"http://127.0.0.1:{args.port}", "--download-engine", args.download_engine,
                   "--concurrency", "4", "--qdm-home", str(args.qdm_home)],
        "research": [sys.executable, "-B", "-m", "trading_workspace_v2.worker", "--max-active-jobs", "1"],
        "api": [str(args.rust_binary)],
    }
    if args.adopt_legacy_downloads:
        commands["domain"].append("--adopt-legacy-downloads")
    children, logs, log_threads = {}, [], []
    env["PYTHONUNBUFFERED"] = "1"
    try:
        for role in ("domain", "research", "api"):
            if role == "api":
                deadline = time.monotonic() + 30
                while not worker_ready(env):
                    if any(p.poll() is not None for p in children.values()) or time.monotonic() > deadline:
                        raise PreflightError("Domain worker did not advertise readiness; API was not started.")
                    time.sleep(0.25)
            output = (args.manifest.parent / f"platform-{run_id}-{role}.out.log").open("ab")
            error = (args.manifest.parent / f"platform-{run_id}-{role}.err.log").open("ab")
            logs.extend((output, error))
            child = subprocess.Popen(commands[role], cwd=FOUNDATION, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            children[role] = child
            for stream, destination in ((child.stdout, output), (child.stderr, error)):
                thread = threading.Thread(target=copy_log, args=(stream, destination, env), daemon=True)
                thread.start()
                log_threads.append(thread)
            state["processes"][role] = process_identity(child.pid)
            manifest_write(args.manifest, state)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if any(p.poll() is not None for p in children.values()):
                raise PreflightError("A runtime child exited during startup; inspect sanitized role logs.")
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{args.port}/health/ready", timeout=2) as response:
                    if json.load(response).get("ok"):
                        state["ready"] = True
                        manifest_write(args.manifest, state)
                        break
            except (OSError, ValueError):
                pass
            time.sleep(0.25)
        if not state["ready"]:
            raise PreflightError("Rust API readiness deadline exceeded.")
        print(f"Rust offline API ready on loopback port {args.port}; domain/research workers supervised.", flush=True)
        while not stop_file.exists():
            if any(p.poll() is not None for p in children.values()):
                raise PreflightError("A runtime child exited; stopping only this owned runtime.")
            time.sleep(0.25)
    finally:
        stop_file.write_text("stop\n", encoding="ascii")
        deadline = time.monotonic() + 45
        while any(p.poll() is None for p in children.values()) and time.monotonic() < deadline:
            time.sleep(0.25)
        for role, child in children.items():
            # Popen holds the process handle; no tree kill or port-owner kill is used.
            if child.poll() is None:
                print(f"Owned {role} shutdown deadline reached; terminating its process handle.", flush=True)
                child.kill()
            child.wait(timeout=5)
        for thread in log_threads:
            thread.join(timeout=5)
        for log in logs:
            log.close()
        state["ready"] = False
        state["stopped"] = True
        manifest_write(args.manifest, state)


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--port", type=int, default=8010)
    result.add_argument("--database-name", default="trading_workspace_v2_exness_history")
    result.add_argument("--artifact-root", type=Path, default=FOUNDATION / ".runtime/exness-market-data")
    result.add_argument("--qdm-home", type=Path, default=FOUNDATION / ".runtime/quantdatamanager")
    result.add_argument("--download-engine", choices=("qdm", "dukascopy", "none"), default="qdm")
    result.add_argument("--rust-binary", type=Path, default=FOUNDATION / "api-rust/target/release/trading-workspace-api.exe")
    result.add_argument("--manifest", type=Path, default=FOUNDATION / ".runtime/api-platform/owner.json")
    result.add_argument("--check-only", action="store_true")
    result.add_argument("--allow-pending-migrations", action="store_true", help="Read-only preflight reports pending versions; cannot start workers with these.")
    result.add_argument("--require-idle", action="store_true", help="Fail if queued/running jobs or legacy downloads exist.")
    result.add_argument("--setup-only", action="store_true", help="Build/apply explicitly selected migrations and exit without starting services.")
    result.add_argument("--stop", action="store_true")
    result.add_argument("--build", action="store_true")
    result.add_argument("--migrate", action="store_true")
    result.add_argument("--backup-confirmed", action="store_true")
    result.add_argument("--adopt-legacy-downloads", action="store_true")
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    if not 1024 <= args.port <= 65535:
        raise PreflightError("Port must be between 1024 and 65535.")
    if args.check_only and (args.build or args.migrate or args.stop or args.adopt_legacy_downloads):
        raise PreflightError("--check-only cannot be combined with actions.")
    if args.allow_pending_migrations and not (args.check_only or args.stop):
        raise PreflightError("--allow-pending-migrations requires --check-only or guarded --stop.")
    env = configuration(args)
    validate_paths(args, need_binary=not args.build)
    assert_no_legacy_download(args.artifact_root) if (args.stop or args.migrate or args.require_idle) else None
    summary = database_preflight(env, migrate=args.migrate, backup_confirmed=args.backup_confirmed,
                                 require_idle=args.stop or args.require_idle, allow_pending=args.allow_pending_migrations)
    if args.check_only:
        print(json.dumps({"check_only": True, "port_free": port_is_free(args.port), **summary}))
        return 0
    if args.stop:
        stop_owned(args)
        return 0
    if args.build:
        cargo = shutil.which("cargo") or str(Path.home() / ".cargo/bin/cargo.exe")
        subprocess.run([cargo, "build", "--release", "--locked", "--manifest-path", str(FOUNDATION / "api-rust/Cargo.toml")],
                       check=True, timeout=600, cwd=FOUNDATION)
    if args.setup_only:
        print(json.dumps({"setup_only": True, **summary}))
        return 0
    with runtime_lock(args.manifest):
        supervise(args, env)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(0)
    except Exception as exc:
        # Driver/compiler/provider exception text can contain credentials or paths.
        print(str(exc) if isinstance(exc, PreflightError) else f"Runtime failed ({type(exc).__name__}); configuration values were not printed.", file=sys.stderr)
        raise SystemExit(1)
