"""Local persistence and lifecycle rules for the P2 Research Workspace."""

import hashlib
import json
import re
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path


SCHEMA_VERSION = 2
TERMINAL_STATUSES = {"completed", "failed", "cancelled"}
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class ResearchError(RuntimeError):
    code = "RESEARCH_ERROR"


class ResearchValidationError(ResearchError):
    code = "INVALID_RESEARCH"


class ResearchNotFound(ResearchError):
    code = "RESEARCH_NOT_FOUND"


class ResearchConflict(ResearchError):
    code = "RESEARCH_CONFLICT"


def _now_ms():
    return int(time.time() * 1000)


def _canonical_json(value):
    try:
        return json.dumps(
            value,
            ensure_ascii=True,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    except (TypeError, ValueError) as exc:
        raise ResearchValidationError("value must be JSON serializable without NaN/Infinity") from exc


def _object(value, name, default=None):
    if value is None and default is not None:
        value = default
    if not isinstance(value, dict):
        raise ResearchValidationError(f"{name} must be an object")
    return json.loads(_canonical_json(value))


def _text(value, name, max_length=4000):
    if not isinstance(value, str):
        raise ResearchValidationError(f"{name} must be text")
    value = value.strip()
    if not value:
        raise ResearchValidationError(f"{name} must not be empty")
    if len(value) > max_length:
        raise ResearchValidationError(f"{name} must be at most {max_length} characters")
    return value


def _sha256(value, name):
    value = _text(value, name, 64).lower()
    if not _SHA256_RE.fullmatch(value):
        raise ResearchValidationError(f"{name} must be a 64-character SHA-256 hex digest")
    return value


def _integer(value, name, minimum=None):
    if isinstance(value, bool):
        raise ResearchValidationError(f"{name} must be an integer")
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ResearchValidationError(f"{name} must be an integer") from exc
    if str(number) != str(value).strip() and not isinstance(value, int):
        raise ResearchValidationError(f"{name} must be an integer")
    if minimum is not None and number < minimum:
        raise ResearchValidationError(f"{name} must be at least {minimum}")
    return number


def _budget(value):
    value = _object(value, "budget")
    max_bars = _integer(value.get("max_bars"), "budget.max_bars", 1)
    max_runtime_ms = _integer(value.get("max_runtime_ms"), "budget.max_runtime_ms", 1)
    normalized = {"max_bars": max_bars, "max_runtime_ms": max_runtime_ms}
    note = value.get("note")
    if note is not None:
        normalized["note"] = _text(note, "budget.note", 500)
    return normalized


class ResearchStore:
    """Persist immutable research specs and explicit research-run lifecycle state."""

    def __init__(self, db_path=None):
        root = Path(__file__).resolve().parent
        self.db_path = Path(db_path) if db_path else root / "data" / "research.sqlite3"
        self._init_lock = threading.Lock()
        self._initialize()

    def _connect(self):
        connection = sqlite3.connect(str(self.db_path), timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _backup_before_migration(self, connection, version):
        backup_path = self.db_path.with_name(f"{self.db_path.name}.v{version}.bak")
        if backup_path.exists():
            return backup_path
        backup_connection = sqlite3.connect(str(backup_path), timeout=10)
        try:
            connection.backup(backup_connection)
        finally:
            backup_connection.close()
        return backup_path

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
                if version not in (0, 1, SCHEMA_VERSION):
                    raise ResearchConflict(
                        f"unsupported research database schema version {version}"
                    )
                connection.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS hypotheses (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        created_at_ms INTEGER NOT NULL,
                        title TEXT NOT NULL,
                        thesis TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS strategy_versions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        created_at_ms INTEGER NOT NULL,
                        hypothesis_id INTEGER NOT NULL,
                        strategy_key TEXT NOT NULL,
                        version TEXT NOT NULL,
                        rules_json TEXT NOT NULL,
                        FOREIGN KEY (hypothesis_id) REFERENCES hypotheses(id),
                        UNIQUE (strategy_key, version)
                    );

                    CREATE TABLE IF NOT EXISTS research_protocols (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        created_at_ms INTEGER NOT NULL,
                        strategy_version_id INTEGER NOT NULL,
                        name TEXT NOT NULL,
                        dataset_id TEXT NOT NULL,
                        dataset_sha256 TEXT NOT NULL,
                        data_start_ms INTEGER NOT NULL,
                        cutoff_ms INTEGER NOT NULL,
                        seed INTEGER NOT NULL,
                        parameters_json TEXT NOT NULL,
                        FOREIGN KEY (strategy_version_id) REFERENCES strategy_versions(id)
                    );

                    CREATE TABLE IF NOT EXISTS research_runs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        created_at_ms INTEGER NOT NULL,
                        protocol_id INTEGER NOT NULL,
                        status TEXT NOT NULL,
                        budget_json TEXT NOT NULL,
                        repro_key TEXT NOT NULL,
                        started_at_ms INTEGER,
                        finished_at_ms INTEGER,
                        observed_until_ms INTEGER,
                        result_json TEXT,
                        terminal_reason TEXT,
                        FOREIGN KEY (protocol_id) REFERENCES research_protocols(id)
                    );

                    CREATE INDEX IF NOT EXISTS idx_research_runs_created
                    ON research_runs (created_at_ms DESC);
                    """
                )
                if version == 1:
                    self._backup_before_migration(connection, version)
                    columns = {
                        row["name"]
                        for row in connection.execute("PRAGMA table_info(research_protocols)").fetchall()
                    }
                    if "dataset_sha256" not in columns:
                        connection.execute(
                            "ALTER TABLE research_protocols ADD COLUMN dataset_sha256 TEXT"
                        )
                    connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
                elif version == 0:
                    connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    @staticmethod
    def _require_row(connection, table, row_id, label):
        row = connection.execute(f"SELECT * FROM {table} WHERE id = ?", (row_id,)).fetchone()
        if row is None:
            raise ResearchNotFound(f"{label} {row_id} was not found")
        return row

    def create_hypothesis(self, payload):
        payload = _object(payload, "hypothesis")
        title = _text(payload.get("title"), "title", 200)
        thesis = _text(payload.get("thesis"), "thesis", 4000)
        created_at_ms = _now_ms()
        with self._connection() as connection:
            cursor = connection.execute(
                "INSERT INTO hypotheses (created_at_ms, title, thesis) VALUES (?, ?, ?)",
                (created_at_ms, title, thesis),
            )
            row_id = cursor.lastrowid
        return self.get_hypothesis(row_id)

    def get_hypothesis(self, hypothesis_id):
        hypothesis_id = _integer(hypothesis_id, "hypothesis_id", 1)
        with self._connection() as connection:
            row = self._require_row(connection, "hypotheses", hypothesis_id, "hypothesis")
        return dict(row)

    def list_hypotheses(self, limit=100):
        limit = _integer(limit, "limit", 1)
        if limit > 500:
            raise ResearchValidationError("limit must be at most 500")
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT * FROM hypotheses ORDER BY created_at_ms DESC, id DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(row) for row in rows]

    def create_strategy_version(self, payload):
        payload = _object(payload, "strategy_version")
        hypothesis_id = _integer(payload.get("hypothesis_id"), "hypothesis_id", 1)
        strategy_key = _text(payload.get("strategy_key"), "strategy_key", 120)
        version = _text(payload.get("version"), "version", 80)
        rules = _object(payload.get("rules"), "rules")
        created_at_ms = _now_ms()
        with self._connection() as connection:
            self._require_row(connection, "hypotheses", hypothesis_id, "hypothesis")
            try:
                cursor = connection.execute(
                    """
                    INSERT INTO strategy_versions (
                        created_at_ms, hypothesis_id, strategy_key, version, rules_json
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (created_at_ms, hypothesis_id, strategy_key, version, _canonical_json(rules)),
                )
            except sqlite3.IntegrityError as exc:
                raise ResearchConflict(
                    f"strategy version {strategy_key}@{version} already exists"
                ) from exc
            row_id = cursor.lastrowid
        return self.get_strategy_version(row_id)

    def get_strategy_version(self, strategy_version_id):
        strategy_version_id = _integer(strategy_version_id, "strategy_version_id", 1)
        with self._connection() as connection:
            row = self._require_row(
                connection, "strategy_versions", strategy_version_id, "strategy version"
            )
        result = dict(row)
        result["rules"] = json.loads(result.pop("rules_json"))
        return result

    def list_strategy_versions(self, limit=100):
        limit = _integer(limit, "limit", 1)
        if limit > 500:
            raise ResearchValidationError("limit must be at most 500")
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT * FROM strategy_versions
                ORDER BY created_at_ms DESC, id DESC LIMIT ?
                """,
                (limit,),
            ).fetchall()
        results = []
        for row in rows:
            item = dict(row)
            item["rules"] = json.loads(item.pop("rules_json"))
            results.append(item)
        return results

    def create_protocol(self, payload):
        payload = _object(payload, "protocol")
        strategy_version_id = _integer(
            payload.get("strategy_version_id"), "strategy_version_id", 1
        )
        name = _text(payload.get("name"), "name", 200)
        dataset_id = _text(payload.get("dataset_id"), "dataset_id", 200)
        dataset_sha256 = _sha256(payload.get("dataset_sha256"), "dataset_sha256")
        data_start_ms = _integer(payload.get("data_start_ms"), "data_start_ms", 0)
        cutoff_ms = _integer(payload.get("cutoff_ms"), "cutoff_ms", 1)
        if cutoff_ms <= data_start_ms:
            raise ResearchValidationError("cutoff_ms must be greater than data_start_ms")
        seed = _integer(payload.get("seed", 0), "seed", 0)
        parameters = _object(payload.get("parameters"), "parameters", default={})
        created_at_ms = _now_ms()
        with self._connection() as connection:
            self._require_row(
                connection, "strategy_versions", strategy_version_id, "strategy version"
            )
            cursor = connection.execute(
                """
                INSERT INTO research_protocols (
                    created_at_ms, strategy_version_id, name, dataset_id, dataset_sha256,
                    data_start_ms, cutoff_ms, seed, parameters_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    created_at_ms,
                    strategy_version_id,
                    name,
                    dataset_id,
                    dataset_sha256,
                    data_start_ms,
                    cutoff_ms,
                    seed,
                    _canonical_json(parameters),
                ),
            )
            row_id = cursor.lastrowid
        return self.get_protocol(row_id)

    def get_protocol(self, protocol_id):
        protocol_id = _integer(protocol_id, "protocol_id", 1)
        with self._connection() as connection:
            row = self._require_row(connection, "research_protocols", protocol_id, "protocol")
        result = dict(row)
        result["parameters"] = json.loads(result.pop("parameters_json"))
        return result

    def list_protocols(self, limit=100):
        limit = _integer(limit, "limit", 1)
        if limit > 500:
            raise ResearchValidationError("limit must be at most 500")
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT * FROM research_protocols
                ORDER BY created_at_ms DESC, id DESC LIMIT ?
                """,
                (limit,),
            ).fetchall()
        results = []
        for row in rows:
            item = dict(row)
            item["parameters"] = json.loads(item.pop("parameters_json"))
            results.append(item)
        return results

    def _repro_snapshot(self, connection, protocol_id, budget):
        protocol = self._require_row(connection, "research_protocols", protocol_id, "protocol")
        strategy = self._require_row(
            connection,
            "strategy_versions",
            protocol["strategy_version_id"],
            "strategy version",
        )
        hypothesis = self._require_row(
            connection, "hypotheses", strategy["hypothesis_id"], "hypothesis"
        )
        dataset_sha256 = protocol["dataset_sha256"]
        if not dataset_sha256:
            raise ResearchConflict(
                "protocol predates dataset fingerprinting; create a new protocol with dataset_sha256"
            )
        return {
            "hypothesis": {
                "title": hypothesis["title"],
                "thesis": hypothesis["thesis"],
            },
            "strategy": {
                "strategy_key": strategy["strategy_key"],
                "version": strategy["version"],
                "rules": json.loads(strategy["rules_json"]),
            },
            "protocol": {
                "name": protocol["name"],
                "dataset_id": protocol["dataset_id"],
                "dataset_sha256": _sha256(dataset_sha256, "protocol.dataset_sha256"),
                "data_start_ms": protocol["data_start_ms"],
                "cutoff_ms": protocol["cutoff_ms"],
                "seed": protocol["seed"],
                "parameters": json.loads(protocol["parameters_json"]),
            },
            "budget": budget,
        }

    def create_run(self, payload):
        payload = _object(payload, "run")
        protocol_id = _integer(payload.get("protocol_id"), "protocol_id", 1)
        budget = _budget(payload.get("budget"))
        created_at_ms = _now_ms()
        with self._connection() as connection:
            snapshot = self._repro_snapshot(connection, protocol_id, budget)
            repro_key = hashlib.sha256(_canonical_json(snapshot).encode("utf-8")).hexdigest()
            cursor = connection.execute(
                """
                INSERT INTO research_runs (
                    created_at_ms, protocol_id, status, budget_json, repro_key
                ) VALUES (?, ?, 'planned', ?, ?)
                """,
                (created_at_ms, protocol_id, _canonical_json(budget), repro_key),
            )
            row_id = cursor.lastrowid
        return self.get_run(row_id)

    def _transition(self, run_id, allowed_statuses, new_status, **fields):
        run_id = _integer(run_id, "run_id", 1)
        with self._connection() as connection:
            row = self._require_row(connection, "research_runs", run_id, "research run")
            if row["status"] not in allowed_statuses:
                raise ResearchConflict(
                    f"run {run_id} cannot transition from {row['status']} to {new_status}"
                )
            assignments = ["status = ?"]
            values = [new_status]
            for field, value in fields.items():
                assignments.append(f"{field} = ?")
                values.append(value)
            values.append(run_id)
            connection.execute(
                f"UPDATE research_runs SET {', '.join(assignments)} WHERE id = ?", values
            )
        return self.get_run(run_id)

    def start_run(self, run_id):
        return self._transition(
            run_id, {"planned"}, "running", started_at_ms=_now_ms()
        )

    def complete_run(self, run_id, payload):
        payload = _object(payload, "completion")
        observed_until_ms = _integer(
            payload.get("observed_until_ms"), "observed_until_ms", 0
        )
        result = _object(payload.get("result"), "result")
        run_id = _integer(run_id, "run_id", 1)
        with self._connection() as connection:
            row = self._require_row(connection, "research_runs", run_id, "research run")
            if row["status"] != "running":
                raise ResearchConflict(
                    f"run {run_id} cannot transition from {row['status']} to completed"
                )
            protocol = self._require_row(
                connection, "research_protocols", row["protocol_id"], "protocol"
            )
            if observed_until_ms > protocol["cutoff_ms"]:
                raise ResearchValidationError(
                    "observed_until_ms exceeds protocol cutoff_ms; future data is not allowed"
                )
            connection.execute(
                """
                UPDATE research_runs
                SET status = 'completed', finished_at_ms = ?, observed_until_ms = ?, result_json = ?
                WHERE id = ?
                """,
                (_now_ms(), observed_until_ms, _canonical_json(result), run_id),
            )
        return self.get_run(run_id)

    def fail_run(self, run_id, reason):
        reason = _text(reason, "reason", 1000)
        return self._transition(
            run_id,
            {"planned", "running"},
            "failed",
            finished_at_ms=_now_ms(),
            terminal_reason=reason,
        )

    def cancel_run(self, run_id, reason):
        reason = _text(reason, "reason", 1000)
        return self._transition(
            run_id,
            {"planned", "running"},
            "cancelled",
            finished_at_ms=_now_ms(),
            terminal_reason=reason,
        )

    def get_run(self, run_id):
        run_id = _integer(run_id, "run_id", 1)
        with self._connection() as connection:
            row = self._require_row(connection, "research_runs", run_id, "research run")
            protocol = self._require_row(
                connection, "research_protocols", row["protocol_id"], "protocol"
            )
            strategy = self._require_row(
                connection,
                "strategy_versions",
                protocol["strategy_version_id"],
                "strategy version",
            )
            hypothesis = self._require_row(
                connection, "hypotheses", strategy["hypothesis_id"], "hypothesis"
            )
        result = dict(row)
        result["budget"] = json.loads(result.pop("budget_json"))
        result["result"] = json.loads(result.pop("result_json")) if result["result_json"] else None
        result["protocol"] = {
            **dict(protocol),
            "parameters": json.loads(protocol["parameters_json"]),
        }
        result["protocol"].pop("parameters_json", None)
        result["strategy_version"] = {
            **dict(strategy),
            "rules": json.loads(strategy["rules_json"]),
        }
        result["strategy_version"].pop("rules_json", None)
        result["hypothesis"] = dict(hypothesis)
        return result

    def list_runs(self, limit=100):
        limit = _integer(limit, "limit", 1)
        if limit > 500:
            raise ResearchValidationError("limit must be at most 500")
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT r.id, r.created_at_ms, r.protocol_id, r.status, r.repro_key,
                       r.started_at_ms, r.finished_at_ms, r.observed_until_ms,
                       r.terminal_reason, p.name AS protocol_name,
                       s.strategy_key, s.version AS strategy_version
                FROM research_runs r
                JOIN research_protocols p ON p.id = r.protocol_id
                JOIN strategy_versions s ON s.id = p.strategy_version_id
                ORDER BY r.created_at_ms DESC, r.id DESC LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    def snapshot(self):
        return {
            "schema_version": SCHEMA_VERSION,
            "hypotheses": self.list_hypotheses(),
            "strategy_versions": self.list_strategy_versions(),
            "protocols": self.list_protocols(),
            "runs": self.list_runs(),
        }
