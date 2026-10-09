from __future__ import annotations

import argparse
import json
import os
import socket
import time
from pathlib import Path
from threading import Event
from uuid import uuid4

from .artifacts import ArtifactStore
from .research import ResearchService
from .store import PostgresStore


def _wait_idle(seconds: float, shutdown_file: Path | None, wake: Event) -> None:
    deadline = time.monotonic() + seconds
    while shutdown_file is None or not shutdown_file.exists():
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return
        wake.wait(min(.25, remaining))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="process at most one queued job")
    parser.add_argument(
        "--poll-seconds",
        type=float,
        default=float(os.getenv("TW_V2_WORKER_POLL_SECONDS", "1")),
        help="idle polling interval for persistent recovery/worker mode",
    )
    parser.add_argument(
        "--max-active-jobs",
        type=int,
        default=int(os.getenv("TW_V2_MAX_ACTIVE_RESEARCH_JOBS", "1")),
        help="global active research-job admission cap for this PostgreSQL authority",
    )
    args = parser.parse_args()
    if args.poll_seconds <= 0:
        raise SystemExit("--poll-seconds must be positive")
    if args.max_active_jobs <= 0:
        raise SystemExit("--max-active-jobs must be positive")
    shutdown_path = os.getenv("TW_V2_SHUTDOWN_FILE")
    shutdown_file = Path(shutdown_path) if shutdown_path else None
    wake = Event()
    store = PostgresStore(os.environ["TW_V2_DATABASE_URL"])
    store.initialize()
    worker_id = os.getenv("TW_V2_WORKER_ID") or f"{socket.gethostname()}-{os.getpid()}-{uuid4().hex[:8]}"
    lease_seconds = int(os.getenv("TW_V2_JOB_LEASE_SECONDS", "30"))
    service = ResearchService(
        store,
        ArtifactStore(os.environ["TW_V2_ARTIFACT_ROOT"]),
        worker_id=worker_id,
        lease_seconds=lease_seconds,
        max_active_jobs=args.max_active_jobs,
    )
    try:
        if args.once:
            result = None if shutdown_file is not None and shutdown_file.exists() else service.run_one()
            print(json.dumps({"processed": result is not None, "job_id": result.job_id if result else None}))
            return 0
        while shutdown_file is None or not shutdown_file.exists():
            try:
                result = service.run_one()
            except Exception as exc:
                # Job failure is already fenced in the store. Do not exit and
                # abandon unrelated queued work, or print DSNs/provider details.
                print(json.dumps({"event": "worker_attempt_failed", "error_type": type(exc).__name__}), flush=True)
                result = None
            if result is None:
                _wait_idle(args.poll_seconds, shutdown_file, wake)
        return 0
    except KeyboardInterrupt:
        return 0
    finally:
        store.close()


if __name__ == "__main__":
    raise SystemExit(main())
