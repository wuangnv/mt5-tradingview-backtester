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

from f6_acceptance import free_port, run, wait_http, wait_ready


ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "foundation_v2"
WEB = V2 / "web"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
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

    workspace = "tenant-ps03-real"
    with tempfile.TemporaryDirectory(prefix="tw-ps03-") as temp_raw:
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
        db_dsn = f"host=127.0.0.1 port={port} user=postgres dbname=tw_ps03"
        api = None
        web = None
        try:
            wait_ready(admin_dsn, server)
            with psycopg.connect(admin_dsn, autocommit=True) as conn:
                conn.execute("CREATE DATABASE tw_ps03")

            env = os.environ.copy()
            env["TW_V2_DATABASE_URL"] = db_dsn
            env["TW_V2_ARTIFACT_ROOT"] = str(artifacts)
            env["TW_V2_LOCAL_WORKSPACES"] = workspace
            env["TW_V2_LOCAL_IDENTITY"] = "ps03-local-owner"
            existing = env.get("PYTHONPATH", "")
            env["PYTHONPATH"] = os.pathsep.join(item for item in (str(V2), str(ROOT), existing) if item)

            backend_tests = run(
                [
                    sys.executable,
                    "-B",
                    "-m",
                    "unittest",
                    "foundation_v2.tests.test_ps01_prop_persistence",
                    "foundation_v2.tests.test_ps03_prop_reports",
                    "-v",
                ],
                env=env,
                cwd=ROOT,
            )

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
            wait_http(f"http://127.0.0.1:{api_port}/health", api)

            web_env = os.environ.copy()
            web_env["TW_V2_API_TARGET"] = f"http://127.0.0.1:{api_port}"
            web = subprocess.Popen(
                [
                    "node",
                    str(WEB / "node_modules" / "vite" / "bin" / "vite.js"),
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(web_port),
                    "--strictPort",
                ],
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
            ui_run = run(
                [
                    "node",
                    "run_prop_ui_real_acceptance.mjs",
                    f"http://127.0.0.1:{web_port}",
                    workspace,
                    str(evidence_dir),
                ],
                cwd=WEB,
                env=web_env,
            )
            ui_receipt = json.loads(ui_run.stdout)
            build_run = run(["npm.cmd", "run", "build"], cwd=WEB, env=web_env)

            with psycopg.connect(db_dsn) as conn:
                session_count = conn.execute(
                    "SELECT count(*) FROM prop_sessions WHERE workspace_id=%s", (workspace,)
                ).fetchone()[0]
                attempt_count = conn.execute(
                    "SELECT count(*) FROM prop_attempts WHERE workspace_id=%s", (workspace,)
                ).fetchone()[0]

            checks = {
                "prop_persistence_and_report_tests_pass": backend_tests.returncode == 0,
                "real_service_browser_report_flow_pass": ui_receipt.get("status") == "PASS",
                "postgres_session_persisted": session_count >= 1,
                "postgres_attempt_persisted": attempt_count >= 1,
                "report_filter_and_csv_real_api": all(
                    name in ui_receipt.get("checks", [])
                    for name in (
                        "selected_attempt_report_from_real_api",
                        "report_status_and_branch_filters_real_api",
                        "report_csv_export_real_api",
                    )
                ),
                "vite_build_pass": build_run.returncode == 0,
                "broker_execution_capability": False,
            }
            overall_pass = all(value for name, value in checks.items() if name != "broker_execution_capability")
            overall_pass = overall_pass and checks["broker_execution_capability"] is False
            receipt = {
                "schema": "PS03-REPORT-UI-ACCEPTANCE-r1",
                "result": "PASS" if overall_pass else "FAIL",
                "scope": (
                    "PS-03 local disposable PostgreSQL/API/Vite/Playwright report slice: persisted attempt report, "
                    "status/branch filtering, breach explanation, Learn link and CSV export; simulation only"
                ),
                "checks": checks,
                "ui": ui_receipt,
                "artifact_hashes": {
                    Path(path).name: sha256(Path(path)) for path in ui_receipt.get("screenshots", [])
                },
                "residual_scope": [
                    "journal integration and broader U3c contextual links",
                    "licensed real-data Prop journey and final INT-PS recovery acceptance",
                    "Figma Make round-trip and whole-product U1 visual acceptance",
                    "broker/demo/live, holdout, provider and deployment gates",
                ],
            }
            receipt_path = evidence_dir / "PS03-report-ui-acceptance-r1.json"
            receipt_path.write_text(json.dumps(receipt, indent=2, sort_keys=True), encoding="utf-8")
            print(f"PS03_RECEIPT={receipt_path}")
            print(f"PS03_RECEIPT_SHA256={sha256(receipt_path)}")
            print(f"PS03_REPORT_UI_ACCEPTANCE={'PASS' if overall_pass else 'FAIL'}")
            return 0 if overall_pass else 1
        finally:
            for process in (web, api):
                if process is not None and process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=8)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=3)
            if server.poll() is None:
                server.terminate()
                try:
                    server.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait(timeout=3)


if __name__ == "__main__":
    raise SystemExit(main())
