"""Disposable PostgreSQL integration: this suite never accepts a user's DSN."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT), str(ROOT / "foundation_v2")]

import psycopg
from psycopg.types.json import Jsonb

from trading_workspace_v2.api import create_app
from trading_workspace_v2.api_command_worker import ApiCommandWorker, CommandQueue
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
from trading_workspace_v2.command_dispatch import CONTRACT_VERSION, CommandResult, DomainCommandDispatcher
from trading_workspace_v2.contracts import DatasetSource

DEFAULT_PG = Path("D:/ANNAM/TradingWorkspace/planning/mt5-tradingview-backtester/research/foundation-validation/20260921T115933Z-315e8ddd/pg-dist/pgsql/bin")
PG_BIN = Path(os.environ.get("TW_COMMAND_TEST_PG_BIN", DEFAULT_PG))


@unittest.skipUnless((PG_BIN / "initdb.exe").is_file(), "disposable portable PostgreSQL binaries unavailable")
class ApiCommandPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cluster = tempfile.TemporaryDirectory(prefix="tw-command-pg-")
        cls.cluster_path = Path(cls.cluster.name)
        cls.data = cls.cluster_path / "data"
        cls.log = cls.cluster_path / "postgres.log"
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            cls.port = sock.getsockname()[1]
        cls._run("initdb.exe", "-D", str(cls.data), "-A", "trust", "-U", "command_fixture", "--encoding=UTF8", "--locale=C")
        cls._run("pg_ctl.exe", "-D", str(cls.data), "-l", str(cls.log), "-o",
                 f"-h 127.0.0.1 -p {cls.port} -c max_connections=40 -c shared_buffers=32MB", "-w", "start")
        cls.dsn = f"host=127.0.0.1 port={cls.port} user=command_fixture dbname=postgres connect_timeout=5"

    @classmethod
    def _run(cls, name, *args):
        return subprocess.run([str(PG_BIN / name), *args], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                              creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0, timeout=40)

    @classmethod
    def tearDownClass(cls):
        cls._run("pg_ctl.exe", "-D", str(cls.data), "-m", "fast", "-w", "stop")
        if (cls.data / "postmaster.pid").exists():
            raise AssertionError("disposable PostgreSQL did not stop")
        cls.cluster.cleanup()

    def setUp(self):
        self.artifacts = tempfile.TemporaryDirectory(prefix="tw-command-artifacts-")
        self.app = create_app(dsn=self.dsn, artifact_root=self.artifacts.name,
                              authorization=LocalWorkspaceAuthorization.for_local_owner(["tenant-a", "tenant-b"]), learn_roots={})
        self.store = self.app.state.store
        self.store.ensure_workspace("tenant-a")
        self.store.ensure_workspace("tenant-b")
        with self.store.connect() as conn:
            conn.execute("TRUNCATE api_commands,api_command_workers")
        self.queue = CommandQueue(self.store, max_active=2)
        self.dispatcher = DomainCommandDispatcher(self.app)

    def tearDown(self):
        self.store.close()
        self.artifacts.cleanup()

    def insert(self, method="GET", path="/api/v2/execution/capabilities", *, workspace="tenant-a", body=None, query=None, key=None, attempts=None):
        identifier = uuid4()
        with self.store.connect() as conn:
            conn.execute("""INSERT INTO api_commands(command_id,contract_version,workspace_id,identity_id,
                method,path,body,query,request_hash,idempotency_key,max_attempts,deadline_at_utc,expires_at_utc)
                VALUES(%s,%s,%s,'local-owner',%s,%s,%s,%s,%s,%s,%s,
                       CURRENT_TIMESTAMP + interval '5 minutes', CURRENT_TIMESTAMP + interval '1 day')""",
                (identifier, CONTRACT_VERSION, workspace, method, path, Jsonb(body) if body is not None else None,
                 Jsonb(query or []), hashlib.sha256(json.dumps(body).encode()).hexdigest(), key,
                 attempts if attempts is not None else (3 if method == "GET" else 1)))
        return identifier

    def row(self, identifier):
        with self.store.connect() as conn:
            return conn.execute("SELECT * FROM api_commands WHERE command_id=%s", (identifier,)).fetchone()

    def expire(self, identifier):
        with self.store.connect() as conn:
            conn.execute("UPDATE api_commands SET lease_expires_at_utc=CURRENT_TIMESTAMP - interval '1 second' WHERE command_id=%s", (identifier,))

    def execute(self, method, path, body=None):
        identifier = self.insert(method, path, body=body)
        self.assertTrue(ApiCommandWorker(self.queue, self.dispatcher, worker_id="fixture").run_once())
        row = self.row(identifier)
        self.assertEqual(row["status"], "completed")
        return row["result_status"], row["result_body"]

    def test_claim_heartbeat_result_and_reconnect(self):
        identifier = self.insert()
        first = self.queue.claim("fixture-one")
        self.assertEqual(first["command_id"], identifier)
        self.assertTrue(self.queue.heartbeat(first))
        self.assertTrue(self.queue.finish(first, CommandResult(200, {"decimal": "10000.01"}, headers={"x-test": "fixture"})))
        with psycopg.connect(self.dsn) as conn:
            body, status = conn.execute("SELECT result_body,result_status FROM api_commands WHERE command_id=%s", (identifier,)).fetchone()
        self.assertEqual((body, status), ({"decimal": "10000.01"}, 200))
        self.assertFalse(self.queue.finish(first, CommandResult(200, {"overwritten": True})))

    def test_safe_read_retry_changes_lease_and_fences_stale_publication(self):
        identifier = self.insert()
        first = self.queue.claim("one")
        self.expire(identifier)
        self.assertFalse(self.queue.heartbeat(first))
        self.queue.recover()
        with self.store.connect() as conn:
            conn.execute("UPDATE api_commands SET available_at_utc=CURRENT_TIMESTAMP WHERE command_id=%s", (identifier,))
        second = self.queue.claim("two")
        self.assertEqual(second["attempt_no"], 2)
        self.assertNotEqual(second["lease_token"], first["lease_token"])
        self.assertFalse(self.queue.finish(first, CommandResult(200, {"stale": True})))
        self.assertTrue(self.queue.finish(second, CommandResult(200, {"current": True})))

    def test_expired_mutation_unknown_and_oauth_sensitive_fields_scrubbed(self):
        identifier = self.insert("POST", "/api/v2/connectors/notion/oauth/start", body={"secret": "fixture"}, query=[["code", "private"], ["state", "private"]])
        first = self.queue.claim("one")
        self.expire(identifier)
        self.queue.recover()
        row = self.row(identifier)
        self.assertEqual((row["status"], row["result_status"]), ("failed", 503))
        self.assertEqual(row["result_body"], {"detail": "command_outcome_unknown"})
        self.assertEqual(row["query"], [])
        self.assertIsNone(row["body"])
        self.assertLess((row["expires_at_utc"] - row["updated_at_utc"]).total_seconds(), 302)
        self.assertFalse(self.queue.finish(first, CommandResult(200, {})))
        self.assertIsNone(self.queue.claim("two"))

    def test_oauth_success_scrub_and_csv_utf8_persist(self):
        identifier = self.insert("POST", "/api/v2/connectors/notion/oauth/start", query=[["state", "private"]])
        command = self.queue.claim("one")
        self.assertTrue(self.queue.finish(command, CommandResult(200, {"ok": True})))
        self.assertEqual(self.row(identifier)["query"], [])
        identifier = self.insert("GET", "/api/v2/replay/sessions/fake/analytics.csv")
        command = self.queue.claim("one")
        self.assertTrue(self.queue.finish(command, CommandResult(200, text="ghi chú,giá\nđã tải,1.25\n", headers={"content-type": "text/csv"})))
        self.assertEqual(self.row(identifier)["result_text"], "ghi chú,giá\nđã tải,1.25\n")

    def test_admission_global_cap_and_mutation_exclusion_per_workspace(self):
        one = self.insert("POST", "/api/v2/playbooks")
        two = self.insert("POST", "/api/v2/playbooks")
        other = self.insert("POST", "/api/v2/playbooks", workspace="tenant-b")
        first, second = self.queue.claim("one"), self.queue.claim("two")
        self.assertEqual(first["command_id"], one)
        self.assertEqual(second["command_id"], other)
        self.assertIsNone(self.queue.claim("three"))
        self.assertEqual(self.row(two)["status"], "queued")
        self.queue.finish(first, CommandResult(201, {}))
        self.assertEqual(self.queue.claim("three")["command_id"], two)

    def test_physical_workspace_session_lock_survives_queue_lease_expiry(self):
        identifier = self.insert("POST", "/api/v2/playbooks")
        command = self.queue.claim("one")
        with self.queue.mutation_guard(command) as first:
            self.assertTrue(first)
            self.expire(identifier)
            self.queue.recover()
            with self.queue.mutation_guard(command) as second:
                self.assertFalse(second)
        with self.queue.mutation_guard(command) as third:
            self.assertTrue(third)

    def test_queued_deadline_and_unique_idempotency(self):
        identifier = self.insert(key="fixture-key")
        with self.assertRaises(psycopg.errors.UniqueViolation):
            self.insert(key="fixture-key")
        with self.store.connect() as conn:
            conn.execute("UPDATE api_commands SET deadline_at_utc=CURRENT_TIMESTAMP - interval '1 second' WHERE command_id=%s", (identifier,))
        self.queue.recover()
        self.assertEqual(self.row(identifier)["result_status"], 504)
        self.assertIsNone(self.queue.claim("one"))

    def test_worker_readiness_manifest_stale_results_cleanup(self):
        self.queue.advertise("fixture", self.dispatcher.manifest())
        self.queue.touch("fixture")
        with self.store.connect() as conn:
            self.assertEqual(len(conn.execute("SELECT route_manifest FROM api_command_workers WHERE worker_id='fixture'").fetchone()["route_manifest"]), len(self.dispatcher.manifest()))
        identifier = self.insert()
        command = self.queue.claim("fixture")
        self.queue.finish(command, CommandResult(200, {}))
        with self.store.connect() as conn:
            conn.execute("UPDATE api_commands SET deadline_at_utc=CURRENT_TIMESTAMP-interval '2 seconds', expires_at_utc=CURRENT_TIMESTAMP-interval '1 second' WHERE command_id=%s", (identifier,))
        self.queue.recover()
        self.assertIsNone(self.row(identifier))
        self.queue.retire("fixture")

    def test_real_replay_playbook_commands_revision_and_financial_execution(self):
        from test_replay_execution_core import initial_state
        rows = [{"timestamp": 1767225600 + index * 60, "open": 1.1, "high": 1.105,
                 "low": 1.099, "close": 1.102, "volume": 10} for index in range(4)]
        dataset = self.app.state.service.register_dataset(workspace_id="tenant-a", source=DatasetSource(
            source_id="command-synthetic", provider="fixture", instrument_mapping={"EURUSD": "EURUSD"},
            license_use="qa-only", retrieved_at_utc="2026-10-09T00:00:00Z", export_settings="command-pg-fixture"),
            instrument_id="EURUSD", timeframe="1m", rows=rows)
        status, session = self.execute("POST", "/api/v2/replay/sessions", {"dataset_id": dataset.dataset_id, "starting_balance": "100000.00", "name": "fixture"})
        self.assertEqual(status, 201)
        identifier = session["record_id"]
        state = initial_state()
        execution = {"expected_revision": 1, "instrument_spec": state.instrument_spec,
                     "cost_model": state.cost_model, "spread_price": "0.0002", "timeframe_seconds": 60, "starting_balance": "100000.00"}
        status, initialized = self.execute("POST", f"/api/v2/replay/sessions/{identifier}/execution", execution)
        self.assertEqual(status, 200)
        self.assertEqual(initialized["revision"], 2)
        order = {"expected_revision": 2, "operation_id": "fixture-order", "side": "BUY", "quantity": "0.10", "stop_loss": "1.0900", "take_profit": "1.1200"}
        status, queued = self.execute("POST", f"/api/v2/replay/sessions/{identifier}/orders/market", order)
        self.assertEqual((status, queued["revision"]), (200, 3))
        status, conflict = self.execute("POST", f"/api/v2/replay/sessions/{identifier}/orders/market", order)
        self.assertEqual(status, 409)

        status, stepped = self.execute("POST", f"/api/v2/replay/sessions/{identifier}/step", {"expected_revision": 3, "steps": 1})
        self.assertEqual((status, stepped["revision"]), (200, 4))
        self.assertEqual(stepped["payload"]["execution"]["position"]["entry_fill"], "1.1001")
        self.assertEqual(stepped["payload"]["execution"]["balance"], "100000.00")
        self.assertEqual(stepped["cutoff_timestamp"], rows[1]["timestamp"])
        playbook = {"name": "fixture", "status": "draft", "execution_capability": "manual-only", "rules": {"entry": "fixture"}}
        status, created = self.execute("POST", "/api/v2/playbooks", playbook)
        self.assertEqual(status, 201)
        status, revised = self.execute("POST", f"/api/v2/playbooks/{created['record_id']}/revisions", {"expected_revision": 1, "payload": {**playbook, "name": "revised"}})
        self.assertEqual((status, revised["revision"]), (200, 2))
        status, conflict = self.execute("POST", f"/api/v2/playbooks/{created['record_id']}/revisions", {"expected_revision": 1, "payload": playbook})
        self.assertEqual(status, 409)

    def test_prop_workspace_money_contract(self):
        from test_ps01_prop_persistence import profile
        from trading_workspace_v2.prop_session import PropSessionSnapshot
        session = PropSessionSnapshot(workspace_id="tenant-a", session_id=f"prop-{uuid4()}", profile=profile(), status="running")
        status, created = self.execute("POST", "/api/v2/prop/sessions", session.model_dump(mode="json"))
        self.assertEqual(status, 201)
        self.assertEqual(created["profile"]["phases"][0]["initial_capital"], "100000")
        crossed = session.model_copy(update={"workspace_id": "tenant-b", "session_id": f"prop-{uuid4()}"})
        status, denied = self.execute("POST", "/api/v2/prop/sessions", crossed.model_dump(mode="json"))
        self.assertEqual((status, denied), (403, {"detail": "prop_workspace_mismatch"}))

    def test_committed_mutation_exception_is_unknown_and_never_replayed(self):
        from unittest.mock import Mock
        identifier = self.insert("POST", "/api/v2/playbooks")
        marker = f"committed-{identifier}"
        def commit_then_fail(command):
            self.store.ensure_workspace(marker)
            raise RuntimeError("response publication failed after commit")
        dispatcher = Mock()
        dispatcher.dispatch.side_effect = commit_then_fail
        self.assertTrue(ApiCommandWorker(self.queue, dispatcher, worker_id="fixture").run_once())
        row = self.row(identifier)
        self.assertEqual((row["result_status"], row["result_body"]), (503, {"detail": "command_outcome_unknown"}))
        with self.store.connect() as conn:
            self.assertIsNotNone(conn.execute("SELECT workspace_id FROM workspaces WHERE workspace_id=%s", (marker,)).fetchone())
        self.queue.recover()
        self.assertIsNone(self.queue.claim("another"))
        dispatcher.dispatch.assert_called_once()


if __name__ == "__main__":
    unittest.main()
