"""Bounded durable domain-command worker used by the native Axum control API."""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import signal
import threading
from pathlib import Path
from uuid import uuid4
from contextlib import contextmanager

from psycopg.types.json import Jsonb

from .command_dispatch import CONTRACT_VERSION, CommandResult, DomainCommandDispatcher

LOG = logging.getLogger("trading_workspace.api_command_worker")
ADMISSION_LOCK = 0x41504351


class CommandQueue:
    def __init__(self, store, *, lease_seconds: int = 30, max_active: int = 4):
        if not 10 <= lease_seconds <= 300 or not 1 <= max_active <= 32:
            raise ValueError("invalid command worker limits")
        self.store, self.lease_seconds, self.max_active = store, lease_seconds, max_active

    def advertise(self, worker_id: str, manifest: list[dict]):
        with self.store.connect() as conn:
            conn.execute("""INSERT INTO api_command_workers(worker_id,contract_version,route_manifest)
                VALUES(%s,%s,%s) ON CONFLICT(worker_id) DO UPDATE SET
                heartbeat_at_utc=CURRENT_TIMESTAMP, contract_version=EXCLUDED.contract_version,
                route_manifest=EXCLUDED.route_manifest""", (worker_id, CONTRACT_VERSION, Jsonb(manifest)))

    def touch(self, worker_id: str):
        with self.store.connect() as conn:
            conn.execute("UPDATE api_command_workers SET heartbeat_at_utc=CURRENT_TIMESTAMP WHERE worker_id=%s", (worker_id,))

    def recover(self):
        with self.store.connect() as conn:
            conn.execute("""UPDATE api_commands SET status='queued', lease_owner=NULL,lease_token=NULL,
                lease_expires_at_utc=NULL,available_at_utc=CURRENT_TIMESTAMP + interval '1 second' *
                LEAST(30,attempt_no*2),updated_at_utc=CURRENT_TIMESTAMP
                WHERE status='running' AND lease_expires_at_utc < CURRENT_TIMESTAMP
                AND method='GET' AND path NOT LIKE '%%/oauth/%%' AND attempt_no < max_attempts
                AND deadline_at_utc > CURRENT_TIMESTAMP""")
            # A missing heartbeat does not prove a mutation had no effect. Never replay it.
            conn.execute("""UPDATE api_commands SET status='failed',result_status=503,
                result_body='{"detail":"command_outcome_unknown"}'::jsonb,result_headers='{}'::jsonb,
                lease_owner=NULL,lease_token=NULL,lease_expires_at_utc=NULL,updated_at_utc=CURRENT_TIMESTAMP
                WHERE status='running' AND lease_expires_at_utc < CURRENT_TIMESTAMP""")
            conn.execute("""UPDATE api_commands SET status='failed',result_status=504,
                result_body='{"detail":"command_queue_deadline_exceeded"}'::jsonb,result_headers='{}'::jsonb,
                updated_at_utc=CURRENT_TIMESTAMP WHERE status='queued' AND deadline_at_utc <= CURRENT_TIMESTAMP""")
            conn.execute("""DELETE FROM api_commands WHERE command_id IN
                (SELECT command_id FROM api_commands WHERE status IN ('completed','failed')
                 AND expires_at_utc < CURRENT_TIMESTAMP ORDER BY expires_at_utc LIMIT 200)""")
            conn.execute("DELETE FROM api_command_workers WHERE heartbeat_at_utc < CURRENT_TIMESTAMP - interval '1 day'")
            conn.execute("""UPDATE api_commands SET query='[]'::jsonb,body=NULL,origin=NULL,
                expires_at_utc=LEAST(expires_at_utc,GREATEST(CURRENT_TIMESTAMP + interval '5 minutes',deadline_at_utc + interval '1 second'))
                WHERE status IN ('completed','failed') AND path LIKE '%%/oauth/%%'
                AND (query<>'[]'::jsonb OR body IS NOT NULL OR origin IS NOT NULL)""")

    def claim(self, worker_id: str) -> dict | None:
        with self.store.connect() as conn:
            with conn.transaction():
                conn.execute("SELECT pg_advisory_xact_lock(%s)", (ADMISSION_LOCK,))
                count = conn.execute("SELECT count(*) AS active FROM api_commands WHERE status='running' AND lease_expires_at_utc > CURRENT_TIMESTAMP").fetchone()["active"]
                if count >= self.max_active:
                    return None
                row = conn.execute("""SELECT c.command_id FROM api_commands c
                    WHERE c.status='queued' AND c.available_at_utc<=CURRENT_TIMESTAMP AND c.deadline_at_utc>CURRENT_TIMESTAMP
                    AND ((c.method='GET' AND c.path NOT LIKE '%%/oauth/%%') OR NOT EXISTS
                        (SELECT 1 FROM api_commands active WHERE active.workspace_id=c.workspace_id
                         AND active.status='running' AND (active.method<>'GET' OR active.path LIKE '%%/oauth/%%')))
                    ORDER BY (SELECT count(*) FROM api_commands active WHERE active.workspace_id=c.workspace_id
                              AND active.status='running'), c.created_at_utc,c.command_id
                    FOR UPDATE OF c SKIP LOCKED LIMIT 1""").fetchone()
                if row is None:
                    return None
                return conn.execute("""UPDATE api_commands SET status='running',attempt_no=attempt_no+1,
                    lease_owner=%s,lease_token=%s,lease_expires_at_utc=CURRENT_TIMESTAMP + interval '1 second' * %s,
                    updated_at_utc=CURRENT_TIMESTAMP WHERE command_id=%s RETURNING *""",
                    (worker_id, uuid4(), self.lease_seconds, row["command_id"])).fetchone()

    def heartbeat(self, command: dict) -> bool:
        with self.store.connect() as conn:
            return conn.execute("""UPDATE api_commands SET
                lease_expires_at_utc=CURRENT_TIMESTAMP + interval '1 second' * %s, updated_at_utc=CURRENT_TIMESTAMP
                WHERE command_id=%s AND status='running' AND lease_token=%s AND attempt_no=%s
                AND lease_expires_at_utc>CURRENT_TIMESTAMP RETURNING command_id""",
                (self.lease_seconds, command["command_id"], command["lease_token"], command["attempt_no"])).fetchone() is not None

    def finish(self, command: dict, result: CommandResult) -> bool:
        with self.store.connect() as conn:
            return conn.execute("""UPDATE api_commands SET status='completed',result_status=%s,
                result_headers=%s,result_body=%s,result_text=%s,
                query=CASE WHEN path LIKE '%%/oauth/%%' THEN '[]'::jsonb ELSE query END,
                body=CASE WHEN path LIKE '%%/oauth/%%' THEN NULL ELSE body END,
                origin=CASE WHEN path LIKE '%%/oauth/%%' THEN NULL ELSE origin END,
                expires_at_utc=CASE WHEN path LIKE '%%/oauth/%%'
                    THEN LEAST(expires_at_utc,GREATEST(CURRENT_TIMESTAMP + interval '5 minutes',deadline_at_utc + interval '1 second'))
                    ELSE expires_at_utc END,
                lease_owner=NULL,lease_token=NULL,lease_expires_at_utc=NULL,updated_at_utc=CURRENT_TIMESTAMP
                WHERE command_id=%s AND status='running' AND lease_token=%s AND attempt_no=%s
                AND lease_expires_at_utc>CURRENT_TIMESTAMP RETURNING command_id""",
                (result.status, Jsonb(result.headers or {}), Jsonb(result.body) if result.text is None else None,
                 result.text, command["command_id"], command["lease_token"], command["attempt_no"])).fetchone() is not None

    def retire(self, worker_id: str):
        with self.store.connect() as conn:
            conn.execute("DELETE FROM api_command_workers WHERE worker_id=%s", (worker_id,))

    @contextmanager
    def mutation_guard(self, command: dict):
        if command.get("method") == "GET" and "/oauth/" not in command.get("path", ""):
            yield True
            return
        key = int.from_bytes(hashlib.sha256(("api-domain-workspace:" + command["workspace_id"]).encode()).digest()[:8], "big", signed=True)
        # Session ownership is retained through domain execution even if a lease
        # expires. This connection must never return to a general pool while locked.
        with self.store.dedicated_connection() as conn:
            acquired = conn.execute("SELECT pg_try_advisory_lock(%s) AS acquired", (key,)).fetchone()["acquired"]
            try:
                yield acquired
            finally:
                if acquired:
                    conn.execute("SELECT pg_advisory_unlock(%s)", (key,))


class ApiCommandWorker:
    def __init__(self, queue: CommandQueue, dispatcher: DomainCommandDispatcher, *, worker_id: str | None = None,
                 max_request_bytes: int = 32 * 1024 * 1024, max_result_bytes: int = 16 * 1024 * 1024):
        self.queue, self.dispatcher = queue, dispatcher
        self.worker_id = worker_id or f"api-command-{uuid4()}"
        self.max_request_bytes, self.max_result_bytes = max_request_bytes, max_result_bytes
        self.stop_event = threading.Event()
        self._command = None
        self._lock = threading.Lock()
        self._manifest = dispatcher.manifest()

    def stop(self, *_):
        # Stop claiming; the current domain operation drains. A disconnected caller
        # cannot safely cancel an already committed replay mutation or provider job.
        self.stop_event.set()

    def _maintain(self, stopped: threading.Event):
        while not stopped.wait(self.queue.lease_seconds / 3):
            try:
                self.queue.touch(self.worker_id)
                with self._lock:
                    command = self._command
                if command is not None and not self.queue.heartbeat(command):
                    LOG.error("command_lease_lost command_id=%s attempt=%s", command["command_id"], command["attempt_no"])
            except Exception:
                # Avoid leaking DSNs/payloads from driver exception text.
                LOG.error("command_worker_heartbeat_failed worker_id=%s", self.worker_id)

    def run_once(self) -> bool:
        self.queue.recover()
        command = self.queue.claim(self.worker_id)
        if command is None:
            return False
        with self._lock:
            self._command = command
        try:
            request_bytes = len(json.dumps({key: command.get(key) for key in ("body", "query", "path", "origin")}, ensure_ascii=False).encode("utf-8"))
            if request_bytes > self.max_request_bytes:
                result = CommandResult(413, {"detail": "command_payload_too_large"})
            else:
                try:
                    with self.queue.mutation_guard(command) as permitted:
                        result = self.dispatcher.dispatch(command) if permitted else CommandResult(409, {"detail": "command_workspace_busy"})
                except Exception:
                    LOG.error("command_execution_failed command_id=%s attempt=%s", command["command_id"], command["attempt_no"])
                    # An exception after invocation can follow a committed write.
                    safe_read = command.get("method") == "GET" and "/oauth/" not in command.get("path", "")
                    result = CommandResult(503, {"detail": "command_execution_failed" if safe_read else "command_outcome_unknown"})
            result_bytes = len((result.text if result.text is not None else json.dumps(result.body, ensure_ascii=False)).encode("utf-8"))
            if result_bytes > self.max_result_bytes:
                safe_read = command.get("method") == "GET" and "/oauth/" not in command.get("path", "")
                result = CommandResult(503, {"detail": "command_result_too_large" if safe_read else "command_outcome_unknown"})
            if not self.queue.finish(command, result):
                LOG.error("command_publication_fenced command_id=%s attempt=%s", command["command_id"], command["attempt_no"])
        finally:
            with self._lock:
                self._command = None
        return True

    def run(self):
        self.queue.advertise(self.worker_id, self._manifest)
        stopped = threading.Event()
        maintenance = threading.Thread(target=self._maintain, args=(stopped,), daemon=True)
        maintenance.start()
        try:
            while not self.stop_event.is_set():
                try:
                    if not self.run_once():
                        self.stop_event.wait(0.1)
                except Exception:
                    LOG.error("command_worker_queue_unavailable worker_id=%s", self.worker_id)
                    self.stop_event.wait(1)
        finally:
            stopped.set()
            maintenance.join(timeout=5)
            self.queue.retire(self.worker_id)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server-origin", default="http://127.0.0.1:8010")
    parser.add_argument("--download-engine", choices=("none", "qdm", "dukascopy"), default="none")
    parser.add_argument("--qdm-home", type=Path)
    parser.add_argument("--lease-seconds", type=int, default=30)
    parser.add_argument("--max-active", type=int, default=4)
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--adopt-legacy-downloads", action="store_true",
                        help="Explicitly adopt configured workspace download checkpoints into the durable queue before serving.")
    parser.add_argument("--shutdown-file", type=Path, default=os.environ.get("TW_V2_SHUTDOWN_FILE"),
                        help="Supervisor-owned stop marker; stop claiming and drain the current operations.")
    parser.add_argument("--manifest", type=Path, help="Write frozen validated command metadata and exit; no provider calls unless configured.")
    args = parser.parse_args()
    if not 1 <= args.concurrency <= args.max_active:
        parser.error("--concurrency must be between 1 and --max-active")
    from .api import create_app
    from .auth import LocalWorkspaceAuthorization
    from .dukascopy_catalog import DukascopyCatalog
    from .dukascopy_downloads import DukascopyDownloads
    from .qdm_cli import QdmCatalog, QdmCli
    from .qdm_downloads import QdmDownloads

    workspaces = [item.strip() for item in os.environ.get("TW_V2_LOCAL_WORKSPACES", "").split(",") if item.strip()]
    identity = os.environ.get("TW_V2_LOCAL_IDENTITY", "").strip()
    if not workspaces or not identity:
        parser.error("TW_V2_LOCAL_WORKSPACES and TW_V2_LOCAL_IDENTITY must be explicit")
    root = Path(os.environ["TW_V2_ARTIFACT_ROOT"])
    catalog, downloads_factory = None, None
    if args.download_engine == "qdm":
        if args.qdm_home is None:
            parser.error("--qdm-home is required for the licensed local QDM worker")
        catalog, downloads_factory = QdmCatalog(QdmCli(args.qdm_home)), QdmDownloads
    elif args.download_engine == "dukascopy":
        catalog, downloads_factory = DukascopyCatalog(root / "catalog/dukascopy-instruments.json"), DukascopyDownloads
    app = create_app(authorization=LocalWorkspaceAuthorization.for_local_owner(workspaces, identity_id=identity),
                     instrument_catalog=catalog, dukascopy_downloads_factory=downloads_factory)
    if args.adopt_legacy_downloads:
        if app.state.downloads is None:
            parser.error("--adopt-legacy-downloads requires a configured download engine")
        for workspace in workspaces:
            app.state.downloads.adopt_legacy(workspace)
    dispatcher = DomainCommandDispatcher(app, server_origin=args.server_origin)
    if args.manifest:
        args.manifest.write_text(json.dumps(dispatcher.manifest(), indent=2) + "\n", encoding="utf-8")
        app.state.store.close()
        return
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s %(message)s')
    queue = CommandQueue(app.state.store, lease_seconds=args.lease_seconds, max_active=args.max_active)
    prefix = os.environ.get("TW_V2_COMMAND_WORKER_PREFIX", f"api-command-{uuid4()}")
    if not prefix or len(prefix) > 160 or any(ord(char) < 32 for char in prefix):
        parser.error("TW_V2_COMMAND_WORKER_PREFIX must be a nonempty bounded identifier")
    workers = [ApiCommandWorker(queue, dispatcher, worker_id=f"{prefix}-{index}") for index in range(args.concurrency)]
    def stop_all(*_):
        for worker in workers:
            worker.stop()
    signal.signal(signal.SIGINT, stop_all)
    signal.signal(signal.SIGTERM, stop_all)
    threads = [threading.Thread(target=worker.run, name=worker.worker_id) for worker in workers]
    try:
        for thread in threads:
            thread.start()
        while any(thread.is_alive() for thread in threads):
            if args.shutdown_file and args.shutdown_file.is_file():
                stop_all()
            for thread in threads:
                thread.join(timeout=0.25)
    finally:
        stop_all()
        for thread in threads:
            thread.join()
        if app.state.downloads:
            app.state.downloads.stop()
        app.state.store.close()


if __name__ == "__main__":
    main()
