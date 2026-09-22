from __future__ import annotations

import argparse
import json
import os
import socket
import time
from uuid import uuid4

from .artifacts import ArtifactStore
from .research import ResearchService
from .store import PostgresStore


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="process at most one queued job")
    parser.add_argument(
        "--poll-seconds",
        type=float,
        default=float(os.getenv("TW_V2_WORKER_POLL_SECONDS", "1")),
        help="idle polling interval for persistent recovery/worker mode",
    )
    args = parser.parse_args()
    if args.poll_seconds <= 0:
        raise SystemExit("--poll-seconds must be positive")
    store = PostgresStore(os.environ["TW_V2_DATABASE_URL"])
    store.initialize()
    worker_id = os.getenv("TW_V2_WORKER_ID") or f"{socket.gethostname()}-{os.getpid()}-{uuid4().hex[:8]}"
    lease_seconds = int(os.getenv("TW_V2_JOB_LEASE_SECONDS", "30"))
    service = ResearchService(
        store,
        ArtifactStore(os.environ["TW_V2_ARTIFACT_ROOT"]),
        worker_id=worker_id,
        lease_seconds=lease_seconds,
    )
    if args.once:
        result = service.run_one()
        print(json.dumps({"processed": result is not None, "job_id": result.job_id if result else None}))
        return 0
    try:
        while True:
            result = service.run_one()
            if result is None:
                time.sleep(args.poll_seconds)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
