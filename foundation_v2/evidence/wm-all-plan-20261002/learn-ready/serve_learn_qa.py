"""Assigned isolated Learn QA service; no persistent config or learner writes."""

from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import re
import socket
import sys
from pathlib import Path

import psycopg
import uvicorn
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from starlette.responses import JSONResponse

HERE = Path(__file__).resolve().parent
FOUNDATION = HERE.parents[2]
PROJECT = FOUNDATION.parent
WORKSPACE = PROJECT.parent.parent
EDUCATION = WORKSPACE / "education"
DATABASE = "trading_workspace_v2_ui_20261001"
PORT = 8030


def main():
    attempt = sys.argv[1] if len(sys.argv) > 1 else "attempt-r1"
    if not re.fullmatch(r"attempt-r\d+", attempt):
        raise RuntimeError("Learn QA attempt must be a bounded local attempt name")
    output = HERE / attempt
    output.mkdir(parents=True, exist_ok=True)
    config = conninfo_to_dict(os.environ["TW_V2_DATABASE_URL"])
    if config.get("host") not in {"127.0.0.1", "localhost", "::1"}:
        raise RuntimeError("Learn QA requires inherited loopback PostgreSQL")
    # The coordinator authorized only this task-local database-name substitution.
    config["dbname"] = DATABASE
    dsn = make_conninfo(**config)
    with psycopg.connect(dsn, autocommit=True, connect_timeout=5) as conn:
        database, address, port = conn.execute(
            "SELECT current_database(), host(inet_server_addr()), inet_server_port()"
        ).fetchone()
    ip = ipaddress.ip_address(address)
    loopback = ip.is_loopback or (
        getattr(ip, "ipv4_mapped", None) is not None and ip.ipv4_mapped.is_loopback
    )
    if database != DATABASE or not loopback:
        raise RuntimeError("Learn QA actual database/server is outside assigned scope")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", PORT))

    before = {
        name: hashlib.sha256((EDUCATION / name).read_bytes()).hexdigest()
        for name in ("course.json", "progress.json")
    }
    # Avoid api.py's environment-driven global app initialization. This removes
    # the inherited variable only inside this short-lived service child process.
    os.environ.pop("TW_V2_DATABASE_URL", None)
    sys.path[:0] = [str(FOUNDATION), str(PROJECT)]
    from trading_workspace_v2.api import create_app
    from trading_workspace_v2.auth import LocalWorkspaceAuthorization

    app = create_app(
        dsn=dsn,
        artifact_root=WORKSPACE / ".artifacts/wm-learn-ready-20261002/artifacts",
        authorization=LocalWorkspaceAuthorization.for_local_owner(
            ["tenant-a", "tenant-b"], identity_id="learn-qa-owner"
        ),
        learn_roots={"tenant-a": EDUCATION},
    )

    @app.middleware("http")
    async def only_read_learn(request, call_next):
        if request.method != "GET":
            return JSONResponse({"detail": "learn_qa_read_only"}, status_code=403)
        if request.url.path not in {
            "/qa/health",
            "/api/v2/learn/overview",
            "/api/v2/learn/glossary",
        } and not request.url.path.startswith("/api/v2/learn/resources/"):
            return JSONResponse({"detail": "learn_qa_scope_denied"}, status_code=403)
        return await call_next(request)

    @app.get("/qa/health")
    def health():
        return {
            "scope": "isolated-real-learn-qa",
            "read_only": True,
            "attempt": attempt,
            "pid": os.getpid(),
        }

    metadata = {
        "attempt": attempt,
        "database": database,
        "server_loopback": loopback,
        "server_port": port,
        "api_port": PORT,
        "pid": os.getpid(),
        "configured_learn_workspaces": ["tenant-a"],
        "unconfigured_member": "tenant-b",
        "course_progress_before": before,
        "schema_initialization": "create_app idempotent schema initialization on named disposable QA DB only",
        "request_scope": "GET Learn plus QA health; writes and other routes denied before handlers",
        "dsn_printed": False,
    }
    (output / "service.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {"ready": True, "database": database, "api_port": PORT, "pid": os.getpid()}
        ),
        flush=True,
    )
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning", access_log=False)


if __name__ == "__main__":
    main()
