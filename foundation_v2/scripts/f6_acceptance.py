from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
import psycopg


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
WEB = V2 / "web"
EVIDENCE = V2 / "evidence"


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def run(cmd: list[str], *, env=None, cwd=None) -> subprocess.CompletedProcess:
    completed = subprocess.run(
        cmd,
        cwd=cwd,
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
    )
    if completed.stdout and completed.stdout.strip():
        print(completed.stdout.strip())
    if completed.returncode != 0:
        if completed.stderr and completed.stderr.strip():
            print(completed.stderr.strip(), file=sys.stderr)
        raise SystemExit(completed.returncode)
    return completed


def wait_ready(dsn: str, process: subprocess.Popen) -> None:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("PostgreSQL exited during startup")
        try:
            with psycopg.connect(dsn, connect_timeout=1):
                return
        except Exception:
            time.sleep(0.1)
    raise RuntimeError("PostgreSQL did not become ready")


def wait_http(url: str, process: subprocess.Popen) -> None:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stderr = process.stderr.read() if process.stderr else ""
            raise RuntimeError(f"process exited during startup: {stderr[-2000:]}")
        try:
            response = httpx.get(url, timeout=1.0)
            if response.status_code < 500:
                return
        except Exception:
            pass
        time.sleep(0.1)
    raise RuntimeError(f"HTTP endpoint did not become ready: {url}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pg-bin", required=True)
    parser.add_argument("--evidence-dir", default=str(EVIDENCE))
    args = parser.parse_args()
    pg_bin = Path(args.pg_bin).resolve()
    evidence_dir = Path(args.evidence_dir).resolve()
    initdb = pg_bin / "initdb.exe"
    postgres = pg_bin / "postgres.exe"
    if not initdb.exists() or not postgres.exists():
        raise SystemExit("portable PostgreSQL bin directory is incomplete")

    with tempfile.TemporaryDirectory(prefix="tw-f6-") as temp_raw:
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
        db_dsn = f"host=127.0.0.1 port={port} user=postgres dbname=tw_f6"
        try:
            wait_ready(admin_dsn, server)
            with psycopg.connect(admin_dsn, autocommit=True) as conn:
                conn.execute("CREATE DATABASE tw_f6")
            env = os.environ.copy()
            env["TW_V2_DATABASE_URL"] = db_dsn
            env["TW_V2_ARTIFACT_ROOT"] = str(artifacts)
            env["TW_V2_ALLOW_DESTRUCTIVE_TEST_DB"] = "1"
            existing = env.get("PYTHONPATH", "")
            env["PYTHONPATH"] = os.pathsep.join(item for item in (str(V2), str(ROOT), existing) if item)
            test_run = run(
                [sys.executable, "-B", "-m", "unittest", "discover", "-s", str(V2 / "tests"), "-v"],
                env=env,
                cwd=ROOT,
            )

            sys.path.insert(0, str(V2))
            sys.path.insert(0, str(ROOT))
            from trading_workspace_v2.artifacts import ArtifactStore
            from trading_workspace_v2.contracts import DatasetSource
            from trading_workspace_v2.research import ResearchService
            from trading_workspace_v2.store import PostgresStore

            service = ResearchService(PostgresStore(db_dsn), ArtifactStore(artifacts))
            source = DatasetSource(
                source_id="f6-browser-fixture",
                provider="synthetic-f6",
                instrument_mapping={"EURUSD": "EURUSD"},
                license_use="qa-only",
                retrieved_at_utc="2026-09-22T00:00:00Z",
                export_settings="browser-fixture-v1",
            )
            dataset = service.register_dataset(
                workspace_id="tenant-ui",
                source=source,
                instrument_id="EURUSD",
                timeframe="1m",
                rows=[
                    {
                        "timestamp": 1_710_000_000 + index * 60,
                        "open": 1.08,
                        "high": max(1.08, close) + 0.0002,
                        "low": min(1.08, close) - 0.0002,
                        "close": close,
                        "volume": 100 + index,
                    }
                    for index, close in enumerate((1.0800, 1.0806, 1.0802, 1.0811, 1.0808, 1.0815))
                ],
            )
            job = service.create_job(
                workspace_id="tenant-ui",
                dataset_id=dataset.dataset_id,
                strategy_version="close-delta-v1",
                starting_balance=10_000,
            )
            worker_run = run(
                [sys.executable, "-B", "-m", "trading_workspace_v2.worker", "--once"],
                env=env,
                cwd=ROOT,
            )
            worker_receipt = json.loads(worker_run.stdout.strip().splitlines()[-1])
            if not worker_receipt.get("processed") or worker_receipt.get("job_id") != job.job_id:
                raise RuntimeError("separate worker process did not process the browser fixture job")

            api_port = free_port()
            web_port = free_port()
            api = subprocess.Popen(
                [
                    sys.executable,
                    "-B",
                    "-m",
                    "uvicorn",
                    "trading_workspace_v2.api:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(api_port),
                    "--log-level",
                    "warning",
                ],
                cwd=ROOT,
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            web_env = os.environ.copy()
            web_env["TW_V2_API_TARGET"] = f"http://127.0.0.1:{api_port}"
            browser_root = Path(os.environ.get("LOCALAPPDATA", "")) / "ms-playwright"
            browser_candidates = sorted(browser_root.glob("chromium-*/chrome-win64/chrome.exe"), reverse=True)
            if browser_candidates:
                web_env["TW_V2_CHROME"] = str(browser_candidates[0])
            web = None
            try:
                wait_http(f"http://127.0.0.1:{api_port}/health", api)
                web = subprocess.Popen(
                    ["npm.cmd", "exec", "vite", "--", "--host", "127.0.0.1", "--port", str(web_port), "--strictPort"],
                    cwd=WEB,
                    env=web_env,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                )
                wait_http(f"http://127.0.0.1:{web_port}/", web)
                evidence_dir.mkdir(parents=True, exist_ok=True)
                ui_output = run(
                    [
                        "node",
                        "run_ui_acceptance.mjs",
                        f"http://127.0.0.1:{web_port}",
                        "tenant-ui",
                        job.job_id,
                        str(evidence_dir),
                    ],
                    cwd=WEB,
                    env=web_env,
                )
                ui_receipt = json.loads(ui_output.stdout)
                build_run = run(["npm.cmd", "run", "build"], cwd=WEB)
            finally:
                for process in (web, api):
                    if process is not None and process.poll() is None:
                        process.terminate()
                        try:
                            process.wait(timeout=8)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait(timeout=3)

            completed = service.store.get_job("tenant-ui", job.job_id)
            result = service.get_result("tenant-ui", job.job_id)
            receipt = {
                "schema": "F6-ACCEPTANCE-r1",
                "result": "PASS",
                "scope": "PATH-2 local reference slice; synthetic QA data only; no broker/live/cloud/holdout action",
                "checks": {
                    "python_contract_tests_pass": test_run.returncode == 0,
                    "separate_worker_process": worker_receipt.get("processed") is True,
                    "postgres_job_completed": completed is not None and completed.status == "completed",
                    "immutable_result_read": result is not None and result.get("job_id") == job.job_id,
                    "react_vite_build_pass": build_run.returncode == 0,
                    "browser_desktop_mobile_pass": ui_receipt.get("pass") is True,
                    "broker_execution_capability": False,
                },
                "fixture": {
                    "workspace_id": "tenant-ui",
                    "dataset_sha256": dataset.artifact_sha256,
                    "job_id": job.job_id,
                    "metrics_schema_version": result["metrics_schema_version"],
                },
                "ui": ui_receipt,
                "artifact_hashes": {
                    "desktop_screenshot": sha256(evidence_dir / "f6-desktop.png"),
                    "mobile_screenshot": sha256(evidence_dir / "f6-mobile.png"),
                    "web_package_lock": sha256(WEB / "package-lock.json"),
                },
            }
            receipt_path = evidence_dir / "F6-acceptance-r1.json"
            receipt_path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            print(f"F6_RECEIPT={receipt_path}")
            print(f"F6_RECEIPT_SHA256={sha256(receipt_path)}")
        finally:
            if server.poll() is None:
                server.terminate()
                try:
                    server.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait(timeout=3)
        print("F6_ACCEPTANCE=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
