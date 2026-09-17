"""Durable execution request journal for the P4 demo-simulator boundary."""

import hashlib
import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path


SCHEMA_VERSION = 1


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
                if version not in (0, SCHEMA_VERSION):
                    raise ExecutionStoreError(
                        f"unsupported execution database schema version {version}"
                    )
                connection.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS execution_requests (
                        request_id TEXT PRIMARY KEY,
                        created_at_ms INTEGER NOT NULL,
                        updated_at_ms INTEGER NOT NULL,
                        mode TEXT NOT NULL,
                        account_id TEXT NOT NULL,
                        operation TEXT NOT NULL,
                        request_fingerprint TEXT NOT NULL,
                        status TEXT NOT NULL,
                        response_json TEXT
                    );
                    CREATE INDEX IF NOT EXISTS idx_execution_requests_updated
                    ON execution_requests (updated_at_ms DESC);
                    """
                )
                if version == 0:
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

    @staticmethod
    def _assert_intent(record, mode, account_id, operation, request_fingerprint):
        expected = (str(mode), str(account_id), str(operation), str(request_fingerprint))
        actual = (
            record["mode"],
            record["account_id"],
            record["operation"],
            record["request_fingerprint"],
        )
        if actual != expected:
            raise ExecutionIntentConflict(
                "request_id was already used for a different execution intent"
            )

    def prepare(self, request_id, mode, account_id, operation, request_fingerprint):
        request_id = str(request_id).strip()
        now_ms = int(time.time() * 1000)
        existing = self.get(request_id)
        if existing is not None:
            self._assert_intent(existing, mode, account_id, operation, request_fingerprint)
            return existing, False

        created = True
        try:
            with self._connection() as connection:
                connection.execute(
                    """
                    INSERT INTO execution_requests (
                        request_id, created_at_ms, updated_at_ms, mode, account_id,
                        operation, request_fingerprint, status, response_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown', NULL)
                    """,
                    (
                        request_id,
                        now_ms,
                        now_ms,
                        str(mode),
                        str(account_id),
                        str(operation),
                        str(request_fingerprint),
                    ),
                )
        except sqlite3.IntegrityError:
            created = False

        record = self.get(request_id)
        if record is None:
            raise ExecutionStoreError("execution request could not be persisted")
        self._assert_intent(record, mode, account_id, operation, request_fingerprint)
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
                WHERE request_id = ?
                """,
                (now_ms, status, payload, str(request_id)),
            )
            if cursor.rowcount != 1:
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
