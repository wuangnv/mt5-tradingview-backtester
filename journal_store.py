"""SQLite journal with immutable evidence/fill provenance and revision history."""

import json
import math
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path


class JournalError(RuntimeError):
    code = "JOURNAL_FAILURE"


class JournalNotFound(JournalError):
    code = "JOURNAL_NOT_FOUND"


class JournalConflict(JournalError):
    code = "JOURNAL_CONFLICT"


class JournalValidationError(JournalError):
    code = "JOURNAL_INVALID"


def _number(value, name, *, optional=False, minimum=None):
    if value is None and optional:
        return None
    if isinstance(value, bool):
        raise JournalValidationError(f"{name} must be a number")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise JournalValidationError(f"{name} must be a number") from exc
    if not math.isfinite(number):
        raise JournalValidationError(f"{name} must be finite")
    if minimum is not None and number < minimum:
        raise JournalValidationError(f"{name} must be at least {minimum}")
    return number


def _text(value, name, *, maximum=10000, allow_empty=True):
    if value is None:
        return ""
    if not isinstance(value, str):
        raise JournalValidationError(f"{name} must be text")
    value = value.strip()
    if not allow_empty and not value:
        raise JournalValidationError(f"{name} is required")
    if len(value) > maximum:
        raise JournalValidationError(f"{name} is too long")
    return value


class JournalStore:
    def __init__(self, db_path=None):
        root = Path(__file__).resolve().parent
        self.db_path = Path(db_path) if db_path else root / "data" / "journal.sqlite3"
        self._lock = threading.RLock()
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
        with self._lock:
            with self._connection() as connection:
                connection.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS journal_entries (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        created_at_ms INTEGER NOT NULL,
                        updated_at_ms INTEGER NOT NULL,
                        source_kind TEXT NOT NULL,
                        evidence_run_id TEXT NOT NULL,
                        trade_id TEXT NOT NULL,
                        symbol TEXT NOT NULL,
                        timeframe TEXT NOT NULL,
                        evidence_schema_version TEXT NOT NULL,
                        data_source_id TEXT NOT NULL,
                        data_meta_sha256 TEXT NOT NULL,
                        decision_time_ms INTEGER NOT NULL,
                        fill_open_time_ms INTEGER NOT NULL,
                        fill_close_time_ms INTEGER NOT NULL,
                        fill_side TEXT NOT NULL,
                        fill_quantity REAL NOT NULL,
                        fill_entry REAL NOT NULL,
                        fill_exit REAL NOT NULL,
                        current_revision INTEGER NOT NULL,
                        UNIQUE(source_kind, evidence_run_id, trade_id)
                    );
                    CREATE TABLE IF NOT EXISTS journal_revisions (
                        entry_id INTEGER NOT NULL,
                        revision INTEGER NOT NULL,
                        created_at_ms INTEGER NOT NULL,
                        intended_entry REAL,
                        intended_stop REAL,
                        intended_target REAL,
                        execution_grade TEXT NOT NULL,
                        rule_checks_json TEXT NOT NULL,
                        notes TEXT NOT NULL,
                        PRIMARY KEY(entry_id, revision),
                        FOREIGN KEY(entry_id) REFERENCES journal_entries(id)
                    );
                    CREATE INDEX IF NOT EXISTS idx_journal_entries_updated
                    ON journal_entries(updated_at_ms DESC, id DESC);

                    CREATE TABLE IF NOT EXISTS journal_decisions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        created_at_ms INTEGER NOT NULL,
                        updated_at_ms INTEGER NOT NULL,
                        source_kind TEXT NOT NULL,
                        source_ref TEXT NOT NULL,
                        symbol TEXT NOT NULL,
                        timeframe TEXT NOT NULL,
                        decision_time_ms INTEGER NOT NULL,
                        setup_version_id TEXT NOT NULL,
                        current_revision INTEGER NOT NULL,
                        UNIQUE(source_kind, source_ref)
                    );
                    CREATE TABLE IF NOT EXISTS journal_decision_revisions (
                        decision_id INTEGER NOT NULL,
                        revision INTEGER NOT NULL,
                        created_at_ms INTEGER NOT NULL,
                        disposition TEXT NOT NULL,
                        observation TEXT NOT NULL,
                        hypothesis TEXT NOT NULL,
                        decision TEXT NOT NULL,
                        tags_json TEXT NOT NULL,
                        notes TEXT NOT NULL,
                        PRIMARY KEY(decision_id, revision),
                        FOREIGN KEY(decision_id) REFERENCES journal_decisions(id)
                    );
                    CREATE INDEX IF NOT EXISTS idx_journal_decisions_updated
                    ON journal_decisions(updated_at_ms DESC, id DESC);
                    """
                )

    @staticmethod
    def _review(payload):
        if not isinstance(payload, dict):
            raise JournalValidationError("journal review must be an object")
        grade = str(payload.get("execution_grade") or "unclear").lower()
        if grade not in {"followed", "deviated", "unclear"}:
            raise JournalValidationError("execution_grade is invalid")
        checks = payload.get("rule_checks") or {}
        if not isinstance(checks, dict) or len(checks) > 32:
            raise JournalValidationError("rule_checks must be an object with at most 32 fields")
        normalized_checks = {}
        for key, value in checks.items():
            if not isinstance(key, str) or not key.strip() or len(key) > 64:
                raise JournalValidationError("rule_checks key is invalid")
            if not isinstance(value, bool):
                raise JournalValidationError("rule_checks values must be boolean")
            normalized_checks[key.strip()] = value
        return {
            "intended_entry": _number(payload.get("intended_entry"), "intended_entry", optional=True, minimum=0),
            "intended_stop": _number(payload.get("intended_stop"), "intended_stop", optional=True, minimum=0),
            "intended_target": _number(payload.get("intended_target"), "intended_target", optional=True, minimum=0),
            "execution_grade": grade,
            "rule_checks": normalized_checks,
            "notes": _text(payload.get("notes"), "notes"),
        }

    @staticmethod
    def _source(source):
        if not isinstance(source, dict):
            raise JournalValidationError("journal source must be an object")
        if source.get("source_kind") != "replay":
            raise JournalValidationError("source_kind must be replay")
        required_text = (
            "evidence_run_id",
            "trade_id",
            "symbol",
            "timeframe",
            "evidence_schema_version",
            "data_source_id",
            "data_meta_sha256",
            "fill_side",
        )
        normalized = {"source_kind": "replay"}
        for field in required_text:
            normalized[field] = _text(source.get(field), field, maximum=256, allow_empty=False)
        if normalized["fill_side"] not in {"BUY", "SELL"}:
            raise JournalValidationError("fill_side is invalid")
        for field in ("decision_time_ms", "fill_open_time_ms", "fill_close_time_ms"):
            try:
                normalized[field] = int(source.get(field))
            except (TypeError, ValueError) as exc:
                raise JournalValidationError(f"{field} must be an integer") from exc
            if normalized[field] < 0:
                raise JournalValidationError(f"{field} must be non-negative")
        normalized["fill_quantity"] = _number(source.get("fill_quantity"), "fill_quantity", minimum=0)
        normalized["fill_entry"] = _number(source.get("fill_entry"), "fill_entry", minimum=0)
        normalized["fill_exit"] = _number(source.get("fill_exit"), "fill_exit", minimum=0)
        return normalized

    @staticmethod
    def _decision_source(source):
        if not isinstance(source, dict):
            raise JournalValidationError("decision source must be an object")
        normalized = {}
        for field, maximum in (
            ("source_kind", 64),
            ("source_ref", 256),
            ("symbol", 64),
            ("timeframe", 32),
        ):
            normalized[field] = _text(
                source.get(field),
                field,
                maximum=maximum,
                allow_empty=False,
            )
        try:
            normalized["decision_time_ms"] = int(source.get("decision_time_ms"))
        except (TypeError, ValueError) as exc:
            raise JournalValidationError("decision_time_ms must be an integer") from exc
        if normalized["decision_time_ms"] < 0:
            raise JournalValidationError("decision_time_ms must be non-negative")
        normalized["setup_version_id"] = _text(
            source.get("setup_version_id"),
            "setup_version_id",
            maximum=256,
            allow_empty=True,
        )
        return normalized

    @staticmethod
    def _decision_review(payload):
        if not isinstance(payload, dict):
            raise JournalValidationError("decision review must be an object")
        disposition = str(payload.get("disposition") or "").strip().lower()
        if disposition not in {"no-trade", "missed-trade", "observation"}:
            raise JournalValidationError("disposition is invalid")
        tags = payload.get("tags") or []
        if not isinstance(tags, list) or len(tags) > 32:
            raise JournalValidationError("tags must be a list with at most 32 items")
        normalized_tags = []
        for tag in tags:
            normalized = _text(tag, "tag", maximum=64, allow_empty=False)
            if normalized not in normalized_tags:
                normalized_tags.append(normalized)
        return {
            "disposition": disposition,
            "observation": _text(payload.get("observation"), "observation"),
            "hypothesis": _text(payload.get("hypothesis"), "hypothesis"),
            "decision": _text(payload.get("decision"), "decision"),
            "tags": normalized_tags,
            "notes": _text(payload.get("notes"), "notes"),
        }

    @staticmethod
    def _decision_revision_payload(row):
        return {
            "revision": int(row["revision"]),
            "created_at_ms": int(row["revision_created_at_ms"]),
            "disposition": row["disposition"],
            "observation": row["observation"],
            "hypothesis": row["hypothesis"],
            "decision": row["decision"],
            "tags": json.loads(row["tags_json"]),
            "notes": row["notes"],
        }

    @staticmethod
    def _revision_payload(row):
        return {
            "revision": int(row["revision"]),
            "created_at_ms": int(row["revision_created_at_ms"]),
            "intended_entry": row["intended_entry"],
            "intended_stop": row["intended_stop"],
            "intended_target": row["intended_target"],
            "execution_grade": row["execution_grade"],
            "rule_checks": json.loads(row["rule_checks_json"]),
            "notes": row["notes"],
        }

    def _get_row(self, connection, entry_id):
        row = connection.execute(
            """
            SELECT e.*, r.revision AS revision, r.created_at_ms AS revision_created_at_ms,
                   r.intended_entry, r.intended_stop, r.intended_target,
                   r.execution_grade, r.rule_checks_json, r.notes
            FROM journal_entries e
            JOIN journal_revisions r
              ON r.entry_id = e.id AND r.revision = e.current_revision
            WHERE e.id = ?
            """,
            (int(entry_id),),
        ).fetchone()
        if row is None:
            raise JournalNotFound("journal entry was not found")
        return row

    def _get_decision_row(self, connection, decision_id):
        row = connection.execute(
            """
            SELECT d.*, r.revision AS revision, r.created_at_ms AS revision_created_at_ms,
                   r.disposition, r.observation, r.hypothesis, r.decision,
                   r.tags_json, r.notes
            FROM journal_decisions d
            JOIN journal_decision_revisions r
              ON r.decision_id = d.id AND r.revision = d.current_revision
            WHERE d.id = ?
            """,
            (int(decision_id),),
        ).fetchone()
        if row is None:
            raise JournalNotFound("journal decision was not found")
        return row

    def _serialize(self, row):
        return {
            "journal_schema_version": "journal-v1",
            "id": str(row["id"]),
            "created_at_ms": int(row["created_at_ms"]),
            "updated_at_ms": int(row["updated_at_ms"]),
            "source": {
                "source_kind": row["source_kind"],
                "evidence_run_id": row["evidence_run_id"],
                "trade_id": row["trade_id"],
                "symbol": row["symbol"],
                "timeframe": row["timeframe"],
                "evidence_schema_version": row["evidence_schema_version"],
                "data_source_id": row["data_source_id"],
                "data_meta_sha256": row["data_meta_sha256"],
                "decision_time_ms": int(row["decision_time_ms"]),
            },
            "fill": {
                "open_time_ms": int(row["fill_open_time_ms"]),
                "close_time_ms": int(row["fill_close_time_ms"]),
                "side": row["fill_side"],
                "quantity": row["fill_quantity"],
                "entry": row["fill_entry"],
                "exit": row["fill_exit"],
            },
            "review": self._revision_payload(row),
        }

    def _serialize_decision(self, row):
        return {
            "journal_schema_version": "journal-decision-v1",
            "id": str(row["id"]),
            "created_at_ms": int(row["created_at_ms"]),
            "updated_at_ms": int(row["updated_at_ms"]),
            "source": {
                "source_kind": row["source_kind"],
                "source_ref": row["source_ref"],
                "symbol": row["symbol"],
                "timeframe": row["timeframe"],
                "decision_time_ms": int(row["decision_time_ms"]),
                "setup_version_id": row["setup_version_id"] or None,
            },
            "review": self._decision_revision_payload(row),
        }

    def create(self, source, review):
        source = self._source(source)
        review = self._review(review)
        now = int(time.time() * 1000)
        with self._lock:
            try:
                with self._connection() as connection:
                    cursor = connection.execute(
                        """
                        INSERT INTO journal_entries (
                            created_at_ms, updated_at_ms, source_kind, evidence_run_id, trade_id,
                            symbol, timeframe, evidence_schema_version, data_source_id, data_meta_sha256,
                            decision_time_ms, fill_open_time_ms, fill_close_time_ms, fill_side,
                            fill_quantity, fill_entry, fill_exit, current_revision
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                        """,
                        (
                            now,
                            now,
                            source["source_kind"],
                            source["evidence_run_id"],
                            source["trade_id"],
                            source["symbol"],
                            source["timeframe"],
                            source["evidence_schema_version"],
                            source["data_source_id"],
                            source["data_meta_sha256"],
                            source["decision_time_ms"],
                            source["fill_open_time_ms"],
                            source["fill_close_time_ms"],
                            source["fill_side"],
                            source["fill_quantity"],
                            source["fill_entry"],
                            source["fill_exit"],
                        ),
                    )
                    entry_id = cursor.lastrowid
                    connection.execute(
                        """
                        INSERT INTO journal_revisions (
                            entry_id, revision, created_at_ms, intended_entry, intended_stop,
                            intended_target, execution_grade, rule_checks_json, notes
                        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            entry_id,
                            now,
                            review["intended_entry"],
                            review["intended_stop"],
                            review["intended_target"],
                            review["execution_grade"],
                            json.dumps(review["rule_checks"], separators=(",", ":"), sort_keys=True),
                            review["notes"],
                        ),
                    )
            except sqlite3.IntegrityError as exc:
                raise JournalConflict("this replay trade already has a journal entry") from exc
        return self.get(entry_id)

    def update(self, entry_id, review):
        review = self._review(review)
        now = int(time.time() * 1000)
        with self._lock:
            with self._connection() as connection:
                current = self._get_row(connection, entry_id)
                revision = int(current["current_revision"]) + 1
                connection.execute(
                    """
                    INSERT INTO journal_revisions (
                        entry_id, revision, created_at_ms, intended_entry, intended_stop,
                        intended_target, execution_grade, rule_checks_json, notes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        int(entry_id),
                        revision,
                        now,
                        review["intended_entry"],
                        review["intended_stop"],
                        review["intended_target"],
                        review["execution_grade"],
                        json.dumps(review["rule_checks"], separators=(",", ":"), sort_keys=True),
                        review["notes"],
                    ),
                )
                connection.execute(
                    "UPDATE journal_entries SET updated_at_ms = ?, current_revision = ? WHERE id = ?",
                    (now, revision, int(entry_id)),
                )
        return self.get(entry_id)

    def get(self, entry_id):
        with self._connection() as connection:
            return self._serialize(self._get_row(connection, entry_id))

    def get_by_source(self, source_kind, evidence_run_id, trade_id):
        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT id FROM journal_entries
                WHERE source_kind = ? AND evidence_run_id = ? AND trade_id = ?
                """,
                (str(source_kind), str(evidence_run_id), str(trade_id)),
            ).fetchone()
            if row is None:
                return None
            return self._serialize(self._get_row(connection, row["id"]))

    def history(self, entry_id):
        with self._connection() as connection:
            entry = connection.execute("SELECT id FROM journal_entries WHERE id = ?", (int(entry_id),)).fetchone()
            if entry is None:
                raise JournalNotFound("journal entry was not found")
            rows = connection.execute(
                """
                SELECT revision, created_at_ms AS revision_created_at_ms,
                       intended_entry, intended_stop, intended_target,
                       execution_grade, rule_checks_json, notes
                FROM journal_revisions WHERE entry_id = ? ORDER BY revision ASC
                """,
                (int(entry_id),),
            ).fetchall()
            return [self._revision_payload(row) for row in rows]

    def list_entries(self, limit=100):
        try:
            limit = int(limit)
        except (TypeError, ValueError) as exc:
            raise JournalValidationError("limit must be an integer") from exc
        if limit < 1 or limit > 100:
            raise JournalValidationError("limit must be between 1 and 100")
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT id FROM journal_entries ORDER BY updated_at_ms DESC, id DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [self._serialize(self._get_row(connection, row["id"])) for row in rows]

    def create_decision(self, source, review):
        source = self._decision_source(source)
        review = self._decision_review(review)
        now = int(time.time() * 1000)
        with self._lock:
            try:
                with self._connection() as connection:
                    cursor = connection.execute(
                        """
                        INSERT INTO journal_decisions (
                            created_at_ms, updated_at_ms, source_kind, source_ref,
                            symbol, timeframe, decision_time_ms, setup_version_id,
                            current_revision
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
                        """,
                        (
                            now,
                            now,
                            source["source_kind"],
                            source["source_ref"],
                            source["symbol"],
                            source["timeframe"],
                            source["decision_time_ms"],
                            source["setup_version_id"],
                        ),
                    )
                    decision_id = cursor.lastrowid
                    connection.execute(
                        """
                        INSERT INTO journal_decision_revisions (
                            decision_id, revision, created_at_ms, disposition,
                            observation, hypothesis, decision, tags_json, notes
                        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            decision_id,
                            now,
                            review["disposition"],
                            review["observation"],
                            review["hypothesis"],
                            review["decision"],
                            json.dumps(review["tags"], separators=(",", ":"), ensure_ascii=True),
                            review["notes"],
                        ),
                    )
            except sqlite3.IntegrityError as exc:
                raise JournalConflict("this decision source already has a journal record") from exc
        return self.get_decision(decision_id)

    def update_decision(self, decision_id, review):
        review = self._decision_review(review)
        now = int(time.time() * 1000)
        with self._lock:
            with self._connection() as connection:
                current = self._get_decision_row(connection, decision_id)
                revision = int(current["current_revision"]) + 1
                connection.execute(
                    """
                    INSERT INTO journal_decision_revisions (
                        decision_id, revision, created_at_ms, disposition,
                        observation, hypothesis, decision, tags_json, notes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        int(decision_id),
                        revision,
                        now,
                        review["disposition"],
                        review["observation"],
                        review["hypothesis"],
                        review["decision"],
                        json.dumps(review["tags"], separators=(",", ":"), ensure_ascii=True),
                        review["notes"],
                    ),
                )
                connection.execute(
                    "UPDATE journal_decisions SET updated_at_ms = ?, current_revision = ? WHERE id = ?",
                    (now, revision, int(decision_id)),
                )
        return self.get_decision(decision_id)

    def get_decision(self, decision_id):
        with self._connection() as connection:
            return self._serialize_decision(self._get_decision_row(connection, decision_id))

    def decision_history(self, decision_id):
        with self._connection() as connection:
            entry = connection.execute(
                "SELECT id FROM journal_decisions WHERE id = ?",
                (int(decision_id),),
            ).fetchone()
            if entry is None:
                raise JournalNotFound("journal decision was not found")
            rows = connection.execute(
                """
                SELECT revision, created_at_ms AS revision_created_at_ms,
                       disposition, observation, hypothesis, decision, tags_json, notes
                FROM journal_decision_revisions
                WHERE decision_id = ? ORDER BY revision ASC
                """,
                (int(decision_id),),
            ).fetchall()
            return [self._decision_revision_payload(row) for row in rows]

    def list_decisions(self, limit=100):
        try:
            limit = int(limit)
        except (TypeError, ValueError) as exc:
            raise JournalValidationError("limit must be an integer") from exc
        if limit < 1 or limit > 100:
            raise JournalValidationError("limit must be between 1 and 100")
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT id FROM journal_decisions ORDER BY updated_at_ms DESC, id DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [
                self._serialize_decision(self._get_decision_row(connection, row["id"]))
                for row in rows
            ]
