"""Durable execution request journal for the P4 demo-simulator boundary."""

import hashlib
import json
import shutil
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path


SCHEMA_VERSION = 3


class ExecutionStoreError(RuntimeError):
    code = "EXECUTION_STORE_ERROR"


class ExecutionRequestNotFound(ExecutionStoreError):
    code = "EXECUTION_REQUEST_NOT_FOUND"


class ExecutionIntentConflict(ExecutionStoreError):
    code = "EXECUTION_INTENT_CONFLICT"


def canonical_json(value):
    try:
        return json.dumps(
            value,
            ensure_ascii=True,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    except (TypeError, ValueError) as exc:
        raise ExecutionIntentConflict("execution intent must be finite JSON") from exc


def fingerprint(value):
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


class ExecutionJournal:
    """Persist request intent before any adapter side effect."""

    def __init__(self, db_path=None):
        root = Path(__file__).resolve().parent
        self.db_path = Path(db_path) if db_path else root / "data" / "execution.sqlite3"
        self._init_lock = threading.Lock()
        self._initialize()

    def _connect(self):
        connection = sqlite3.connect(str(self.db_path), timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    @contextmanager
    def _connection(self):
        connection = self._connect()
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize(self):
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._init_lock:
            with self._connection() as connection:
                version = connection.execute("PRAGMA user_version").fetchone()[0]
                if version not in (0, 1, 2, SCHEMA_VERSION):
                    raise ExecutionStoreError(
                        f"unsupported execution database schema version {version}"
                    )
                if version in (1, 2):
                    backup_path = self.db_path.with_suffix(
                        self.db_path.suffix + f".v{version}-{int(time.time() * 1000)}.bak"
                    )
                    connection.commit()
                    shutil.copy2(self.db_path, backup_path)
                connection.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS execution_requests (
                        request_id TEXT PRIMARY KEY,
                        created_at_ms INTEGER NOT NULL,
                        updated_at_ms INTEGER NOT NULL,
                        mode TEXT NOT NULL,
                        account_id TEXT NOT NULL,
                        account_server TEXT NOT NULL,
                        operation TEXT NOT NULL,
                        request_fingerprint TEXT NOT NULL,
                        status TEXT NOT NULL,
                        response_json TEXT
                    );
                    CREATE INDEX IF NOT EXISTS idx_execution_requests_updated
                    ON execution_requests (updated_at_ms DESC);
                    CREATE TABLE IF NOT EXISTS execution_control (
                        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                        block_new_orders INTEGER NOT NULL,
                        reason TEXT NOT NULL,
                        updated_at_ms INTEGER NOT NULL
                    );
                    INSERT OR IGNORE INTO execution_control (
                        singleton, block_new_orders, reason, updated_at_ms
                    ) VALUES (1, 0, '', 0);
                    CREATE TABLE IF NOT EXISTS execution_alerts (
                        alert_id TEXT PRIMARY KEY,
                        created_at_ms INTEGER NOT NULL,
                        updated_at_ms INTEGER NOT NULL,
                        kind TEXT NOT NULL,
                        rule_json TEXT NOT NULL,
                        expires_at_ms INTEGER,
                        status TEXT NOT NULL,
                        acknowledged_at_ms INTEGER
                    );
                    CREATE INDEX IF NOT EXISTS idx_execution_alerts_updated
                    ON execution_alerts (updated_at_ms DESC);
                    """
                )
                if version == 0:
                    connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
                elif version == 1:
                    connection.execute(
                        "ALTER TABLE execution_requests ADD COLUMN account_server TEXT NOT NULL DEFAULT ''"
                    )
                    connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
                elif version == 2:
                    connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    @staticmethod
    def _row_to_record(row):
        if row is None:
            return None
        response = json.loads(row["response_json"]) if row["response_json"] else None
        return {
            "request_id": row["request_id"],
            "created_at_ms": row["created_at_ms"],
            "updated_at_ms": row["updated_at_ms"],
            "mode": row["mode"],
            "account_id": row["account_id"],
            "account_server": row["account_server"],
            "operation": row["operation"],
            "request_fingerprint": row["request_fingerprint"],
            "status": row["status"],
            "response": response,
        }

    def get(self, request_id):
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM execution_requests WHERE request_id = ?", (str(request_id),)
            ).fetchone()
        return self._row_to_record(row)

    def find_matching(
        self, request_id, mode, account_id, account_server, operation, request_fingerprint
    ):
        record = self.get(request_id)
        if record is None:
            return None
        self._assert_intent(
            record, mode, account_id, account_server, operation, request_fingerprint
        )
        return record

    @staticmethod
    def _assert_intent(
        record, mode, account_id, account_server, operation, request_fingerprint
    ):
        expected = (
            str(mode),
            str(account_id),
            str(account_server),
            str(operation),
            str(request_fingerprint),
        )
        actual = (
            record["mode"],
            record["account_id"],
            record["account_server"],
            record["operation"],
            record["request_fingerprint"],
        )
        if actual != expected:
            raise ExecutionIntentConflict(
                "request_id was already used for a different execution intent"
            )

    def prepare(
        self, request_id, mode, account_id, account_server, operation, request_fingerprint
    ):
        request_id = str(request_id).strip()
        now_ms = int(time.time() * 1000)
        existing = self.find_matching(
            request_id, mode, account_id, account_server, operation, request_fingerprint
        )
        if existing is not None:
            return existing, False

        created = True
        try:
            with self._connection() as connection:
                connection.execute(
                    """
                    INSERT INTO execution_requests (
                        request_id, created_at_ms, updated_at_ms, mode, account_id, account_server,
                        operation, request_fingerprint, status, response_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unknown', NULL)
                    """,
                    (
                        request_id,
                        now_ms,
                        now_ms,
                        str(mode),
                        str(account_id),
                        str(account_server),
                        str(operation),
                        str(request_fingerprint),
                    ),
                )
        except sqlite3.IntegrityError:
            created = False

        record = self.get(request_id)
        if record is None:
            raise ExecutionStoreError("execution request could not be persisted")
        self._assert_intent(
            record, mode, account_id, account_server, operation, request_fingerprint
        )
        return record, created

    def finish(self, request_id, result):
        status = str(result.get("status") or "unknown")
        payload = canonical_json(result)
        now_ms = int(time.time() * 1000)
        with self._connection() as connection:
            cursor = connection.execute(
                """
                UPDATE execution_requests
                SET updated_at_ms = ?, status = ?, response_json = ?
                WHERE request_id = ? AND status = 'unknown'
                """,
                (now_ms, status, payload, str(request_id)),
            )
            if cursor.rowcount == 0:
                row = connection.execute(
                    "SELECT * FROM execution_requests WHERE request_id = ?",
                    (str(request_id),),
                ).fetchone()
                if row is not None:
                    return self._row_to_record(row)
                raise ExecutionRequestNotFound(str(request_id))
        return self.get(request_id)

    def list_recent(self, limit=50):
        try:
            limit = int(limit)
        except (TypeError, ValueError) as exc:
            raise ExecutionStoreError("limit must be an integer") from exc
        if limit < 1 or limit > 200:
            raise ExecutionStoreError("limit must be between 1 and 200")
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT * FROM execution_requests ORDER BY updated_at_ms DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [self._row_to_record(row) for row in rows]

    def list_unknown(self, *, mode=None, account_id=None, account_server=None):
        clauses = ["status = 'unknown'"]
        values = []
        for column, value in (
            ("mode", mode),
            ("account_id", account_id),
            ("account_server", account_server),
        ):
            if value is not None:
                clauses.append(f"{column} = ?")
                values.append(str(value))
        query = (
            "SELECT * FROM execution_requests WHERE "
            + " AND ".join(clauses)
            + " ORDER BY updated_at_ms DESC"
        )
        with self._connection() as connection:
            rows = connection.execute(query, values).fetchall()
        return [self._row_to_record(row) for row in rows]

    def get_kill_switch(self):
        with self._connection() as connection:
            row = connection.execute(
                "SELECT block_new_orders, reason, updated_at_ms FROM execution_control WHERE singleton = 1"
            ).fetchone()
        if row is None:
            raise ExecutionStoreError("execution control row is missing")
        return {
            "block_new_orders": bool(row["block_new_orders"]),
            "reason": row["reason"],
            "updated_at_ms": int(row["updated_at_ms"]),
        }

    def set_kill_switch(self, enabled, reason=""):
        if not isinstance(enabled, bool):
            raise ExecutionStoreError("kill switch enabled must be boolean")
        reason = str(reason or "").strip()
        if len(reason) > 500:
            raise ExecutionStoreError("kill switch reason is too long")
        now_ms = int(time.time() * 1000)
        with self._connection() as connection:
            connection.execute(
                """
                UPDATE execution_control
                SET block_new_orders = ?, reason = ?, updated_at_ms = ?
                WHERE singleton = 1
                """,
                (1 if enabled else 0, reason, now_ms),
            )
        return self.get_kill_switch()

    @staticmethod
    def _row_to_alert(row):
        if row is None:
            return None
        return {
            "alert_id": row["alert_id"],
            "created_at_ms": int(row["created_at_ms"]),
            "updated_at_ms": int(row["updated_at_ms"]),
            "kind": row["kind"],
            "rule": json.loads(row["rule_json"]),
            "expires_at_ms": row["expires_at_ms"],
            "status": row["status"],
            "acknowledged_at_ms": row["acknowledged_at_ms"],
        }

    def create_alert(self, alert_id, kind, rule, expires_at_ms=None):
        alert_id = str(alert_id or "").strip()
        kind = str(kind or "").strip().lower()
        if not alert_id or not kind:
            raise ExecutionStoreError("alert_id and kind are required")
        rule_json = canonical_json(rule)
        if expires_at_ms is not None:
            try:
                expires_at_ms = int(expires_at_ms)
            except (TypeError, ValueError) as exc:
                raise ExecutionStoreError("expires_at_ms must be an integer") from exc
            if expires_at_ms <= 0:
                raise ExecutionStoreError("expires_at_ms must be positive")
        now_ms = int(time.time() * 1000)
        try:
            with self._connection() as connection:
                connection.execute(
                    """
                    INSERT INTO execution_alerts (
                        alert_id, created_at_ms, updated_at_ms, kind, rule_json,
                        expires_at_ms, status, acknowledged_at_ms
                    ) VALUES (?, ?, ?, ?, ?, ?, 'active', NULL)
                    """,
                    (alert_id, now_ms, now_ms, kind, rule_json, expires_at_ms),
                )
        except sqlite3.IntegrityError as exc:
            raise ExecutionStoreError("alert_id already exists") from exc
        return self.get_alert(alert_id)

    def get_alert(self, alert_id):
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM execution_alerts WHERE alert_id = ?", (str(alert_id),)
            ).fetchone()
        return self._row_to_alert(row)

    def acknowledge_alert(self, alert_id):
        now_ms = int(time.time() * 1000)
        with self._connection() as connection:
            cursor = connection.execute(
                """
                UPDATE execution_alerts
                SET status = 'acknowledged', acknowledged_at_ms = ?, updated_at_ms = ?
                WHERE alert_id = ?
                """,
                (now_ms, now_ms, str(alert_id)),
            )
            if cursor.rowcount == 0:
                raise ExecutionStoreError("alert_id was not found")
        return self.get_alert(alert_id)

    def list_alerts(self, limit=100):
        try:
            limit = int(limit)
        except (TypeError, ValueError) as exc:
            raise ExecutionStoreError("limit must be an integer") from exc
        if limit < 1 or limit > 500:
            raise ExecutionStoreError("limit must be between 1 and 500")
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT * FROM execution_alerts ORDER BY updated_at_ms DESC LIMIT ?", (limit,)
            ).fetchall()
        return [self._row_to_alert(row) for row in rows]
