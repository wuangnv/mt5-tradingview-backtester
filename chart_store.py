"""Versioned chart annotations and layout state for the integrated workspace."""

import json
import math
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path


SCHEMA_VERSION = 1
ANNOTATION_KINDS = {
    "horizontal_line",
    "zone",
    "trendline",
    "text",
    "arrow",
    "entry",
    "stop_loss",
    "take_profit",
}
TWO_ANCHOR_KINDS = {"zone", "trendline"}


class ChartStoreError(RuntimeError):
    code = "CHART_STORE_ERROR"


class ChartValidationError(ChartStoreError):
    code = "CHART_INVALID"


class ChartNotFound(ChartStoreError):
    code = "CHART_NOT_FOUND"


class ChartConflict(ChartStoreError):
    code = "CHART_CONFLICT"


def _text(value, name, maximum=256, *, allow_empty=False):
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ChartValidationError(f"{name} must be text")
    value = value.strip()
    if not allow_empty and not value:
        raise ChartValidationError(f"{name} is required")
    if len(value) > maximum:
        raise ChartValidationError(f"{name} is too long")
    return value


def _integer(value, name, minimum=0):
    if isinstance(value, bool):
        raise ChartValidationError(f"{name} must be an integer")
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ChartValidationError(f"{name} must be an integer") from exc
    if str(number) != str(value).strip() and not isinstance(value, int):
        raise ChartValidationError(f"{name} must be an integer")
    if number < minimum:
        raise ChartValidationError(f"{name} must be at least {minimum}")
    return number


def _price(value, name):
    if isinstance(value, bool):
        raise ChartValidationError(f"{name} must be a finite positive number")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ChartValidationError(f"{name} must be a finite positive number") from exc
    if not math.isfinite(number) or number <= 0:
        raise ChartValidationError(f"{name} must be a finite positive number")
    return number


def _canonical_json(value):
    try:
        return json.dumps(
            value,
            ensure_ascii=True,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        )
    except (TypeError, ValueError) as exc:
        raise ChartValidationError("value must be JSON serializable") from exc


def _normalize_payload(payload):
    if not isinstance(payload, dict):
        raise ChartValidationError("annotation must be an object")
    kind = _text(payload.get("kind"), "kind", 64)
    if kind not in ANNOTATION_KINDS:
        raise ChartValidationError("kind is unsupported")
    instrument_id = _text(payload.get("instrument_id"), "instrument_id", 64).upper()
    timeframe = _text(payload.get("timeframe"), "timeframe", 16).upper()
    cutoff_ms = _integer(payload.get("cutoff_ms"), "cutoff_ms")
    anchors = payload.get("anchors")
    if not isinstance(anchors, list) or not anchors:
        raise ChartValidationError("anchors must be a non-empty list")
    expected = 2 if kind in TWO_ANCHOR_KINDS else 1
    if len(anchors) != expected:
        raise ChartValidationError(f"{kind} requires exactly {expected} anchor(s)")
    normalized_anchors = []
    for index, anchor in enumerate(anchors):
        if not isinstance(anchor, dict):
            raise ChartValidationError(f"anchors[{index}] must be an object")
        time_utc = _integer(anchor.get("time_utc"), f"anchors[{index}].time_utc")
        if time_utc * 1000 > cutoff_ms:
            raise ChartValidationError("annotation anchor exceeds replay cutoff")
        normalized_anchors.append(
            {"time_utc": time_utc, "price": _price(anchor.get("price"), f"anchors[{index}].price")}
        )
    source = payload.get("source") or {}
    if not isinstance(source, dict):
        raise ChartValidationError("source must be an object")
    source_kind = _text(source.get("kind") or "manual", "source.kind", 64)
    source_id = _text(source.get("id") or "", "source.id", 256, allow_empty=True)
    strategy_version_id = _text(
        payload.get("strategy_version_id") or "",
        "strategy_version_id",
        128,
        allow_empty=True,
    )
    label = _text(payload.get("label") or "", "label", 500, allow_empty=True)
    return {
        "kind": kind,
        "instrument_id": instrument_id,
        "timeframe": timeframe,
        "cutoff_ms": cutoff_ms,
        "anchors": normalized_anchors,
        "source": {"kind": source_kind, "id": source_id},
        "strategy_version_id": strategy_version_id or None,
        "label": label,
    }


class ChartStore:
    def __init__(self, db_path=None):
        root = Path(__file__).resolve().parent
        self.db_path = Path(db_path) if db_path else root / "data" / "chart.sqlite3"
        self._lock = threading.RLock()
        self._initialize()

    def _connect(self):
        connection = sqlite3.connect(str(self.db_path), timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
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
                version = int(connection.execute("PRAGMA user_version").fetchone()[0])
                if version not in {0, SCHEMA_VERSION}:
                    raise ChartConflict(f"unsupported chart database schema version {version}")
                connection.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS chart_annotations (
                        id TEXT PRIMARY KEY,
                        created_at_ms INTEGER NOT NULL,
                        updated_at_ms INTEGER NOT NULL,
                        current_revision INTEGER NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS chart_annotation_revisions (
                        annotation_id TEXT NOT NULL,
                        revision INTEGER NOT NULL,
                        created_at_ms INTEGER NOT NULL,
                        payload_json TEXT NOT NULL,
                        deleted INTEGER NOT NULL,
                        PRIMARY KEY(annotation_id, revision),
                        FOREIGN KEY(annotation_id) REFERENCES chart_annotations(id)
                    );
                    CREATE TABLE IF NOT EXISTS chart_layouts (
                        layout_key TEXT PRIMARY KEY,
                        updated_at_ms INTEGER NOT NULL,
                        revision INTEGER NOT NULL,
                        payload_json TEXT NOT NULL
                    );
                    """
                )
                if version == 0:
                    connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    @staticmethod
    def _serialize(row):
        payload = json.loads(row["payload_json"])
        return {
            "annotation_schema_version": "chart-annotation-v1",
            "id": row["id"],
            "created_at_ms": int(row["created_at_ms"]),
            "updated_at_ms": int(row["updated_at_ms"]),
            "revision": int(row["revision"]),
            "deleted": bool(row["deleted"]),
            **payload,
        }

    @staticmethod
    def _row(connection, annotation_id):
        row = connection.execute(
            """
            SELECT a.id, a.created_at_ms, a.updated_at_ms,
                   r.revision, r.payload_json, r.deleted
            FROM chart_annotations a
            JOIN chart_annotation_revisions r
              ON r.annotation_id = a.id AND r.revision = a.current_revision
            WHERE a.id = ?
            """,
            (str(annotation_id),),
        ).fetchone()
        if row is None:
            raise ChartNotFound("annotation was not found")
        return row

    def create_annotation(self, payload):
        normalized = _normalize_payload(payload)
        now = int(time.time() * 1000)
        annotation_id = str(uuid.uuid4())
        with self._lock:
            with self._connection() as connection:
                connection.execute(
                    "INSERT INTO chart_annotations (id, created_at_ms, updated_at_ms, current_revision) VALUES (?, ?, ?, 1)",
                    (annotation_id, now, now),
                )
                connection.execute(
                    "INSERT INTO chart_annotation_revisions (annotation_id, revision, created_at_ms, payload_json, deleted) VALUES (?, 1, ?, ?, 0)",
                    (annotation_id, now, _canonical_json(normalized)),
                )
        return self.get_annotation(annotation_id)

    def get_annotation(self, annotation_id, *, include_deleted=False):
        with self._connection() as connection:
            result = self._serialize(self._row(connection, annotation_id))
        if result["deleted"] and not include_deleted:
            raise ChartNotFound("annotation was deleted")
        return result

    def list_annotations(self, instrument_id=None, timeframe=None, *, include_deleted=False):
        with self._connection() as connection:
            ids = [
                row["id"]
                for row in connection.execute(
                    "SELECT id FROM chart_annotations ORDER BY updated_at_ms DESC, id DESC"
                ).fetchall()
            ]
            rows = [self._serialize(self._row(connection, item_id)) for item_id in ids]
        if not include_deleted:
            rows = [item for item in rows if not item["deleted"]]
        if instrument_id:
            needle = str(instrument_id).strip().upper()
            rows = [item for item in rows if item["instrument_id"] == needle]
        if timeframe:
            needle = str(timeframe).strip().upper()
            rows = [item for item in rows if item["timeframe"] == needle]
        return rows

    def update_annotation(self, annotation_id, payload, expected_revision):
        normalized = _normalize_payload(payload)
        expected_revision = _integer(expected_revision, "expected_revision", 1)
        now = int(time.time() * 1000)
        with self._lock:
            with self._connection() as connection:
                current = self._row(connection, annotation_id)
                if int(current["revision"]) != expected_revision:
                    raise ChartConflict("annotation revision changed; refresh before editing")
                revision = expected_revision + 1
                connection.execute(
                    "INSERT INTO chart_annotation_revisions (annotation_id, revision, created_at_ms, payload_json, deleted) VALUES (?, ?, ?, ?, 0)",
                    (str(annotation_id), revision, now, _canonical_json(normalized)),
                )
                connection.execute(
                    "UPDATE chart_annotations SET updated_at_ms = ?, current_revision = ? WHERE id = ?",
                    (now, revision, str(annotation_id)),
                )
        return self.get_annotation(annotation_id)

    def delete_annotation(self, annotation_id, expected_revision):
        expected_revision = _integer(expected_revision, "expected_revision", 1)
        now = int(time.time() * 1000)
        with self._lock:
            with self._connection() as connection:
                current = self._row(connection, annotation_id)
                if int(current["revision"]) != expected_revision:
                    raise ChartConflict("annotation revision changed; refresh before deleting")
                revision = expected_revision + 1
                connection.execute(
                    "INSERT INTO chart_annotation_revisions (annotation_id, revision, created_at_ms, payload_json, deleted) VALUES (?, ?, ?, ?, 1)",
                    (str(annotation_id), revision, now, current["payload_json"]),
                )
                connection.execute(
                    "UPDATE chart_annotations SET updated_at_ms = ?, current_revision = ? WHERE id = ?",
                    (now, revision, str(annotation_id)),
                )
        return self.get_annotation(annotation_id, include_deleted=True)

    def restore_revision(self, annotation_id, revision, expected_revision):
        revision = _integer(revision, "revision", 1)
        expected_revision = _integer(expected_revision, "expected_revision", 1)
        now = int(time.time() * 1000)
        with self._lock:
            with self._connection() as connection:
                current = self._row(connection, annotation_id)
                if int(current["revision"]) != expected_revision:
                    raise ChartConflict("annotation revision changed; refresh before restoring")
                source = connection.execute(
                    "SELECT payload_json, deleted FROM chart_annotation_revisions WHERE annotation_id = ? AND revision = ?",
                    (str(annotation_id), revision),
                ).fetchone()
                if source is None:
                    raise ChartNotFound("annotation revision was not found")
                next_revision = expected_revision + 1
                connection.execute(
                    "INSERT INTO chart_annotation_revisions (annotation_id, revision, created_at_ms, payload_json, deleted) VALUES (?, ?, ?, ?, ?)",
                    (str(annotation_id), next_revision, now, source["payload_json"], int(source["deleted"])),
                )
                connection.execute(
                    "UPDATE chart_annotations SET updated_at_ms = ?, current_revision = ? WHERE id = ?",
                    (now, next_revision, str(annotation_id)),
                )
        return self.get_annotation(annotation_id, include_deleted=True)

    def history(self, annotation_id):
        with self._connection() as connection:
            self._row(connection, annotation_id)
            rows = connection.execute(
                "SELECT revision, created_at_ms, payload_json, deleted FROM chart_annotation_revisions WHERE annotation_id = ? ORDER BY revision ASC",
                (str(annotation_id),),
            ).fetchall()
        return [
            {
                "revision": int(row["revision"]),
                "created_at_ms": int(row["created_at_ms"]),
                "deleted": bool(row["deleted"]),
                "payload": json.loads(row["payload_json"]),
            }
            for row in rows
        ]

    def save_layout(self, layout_key, payload, expected_revision=None):
        layout_key = _text(layout_key, "layout_key", 128)
        if not isinstance(payload, dict):
            raise ChartValidationError("layout payload must be an object")
        normalized = json.loads(_canonical_json(payload))
        now = int(time.time() * 1000)
        with self._lock:
            with self._connection() as connection:
                current = connection.execute(
                    "SELECT revision FROM chart_layouts WHERE layout_key = ?", (layout_key,)
                ).fetchone()
                if current is None:
                    if expected_revision not in (None, 0, "0"):
                        raise ChartConflict("layout does not exist at the expected revision")
                    revision = 1
                    connection.execute(
                        "INSERT INTO chart_layouts (layout_key, updated_at_ms, revision, payload_json) VALUES (?, ?, ?, ?)",
                        (layout_key, now, revision, _canonical_json(normalized)),
                    )
                else:
                    expected = _integer(expected_revision, "expected_revision", 1)
                    if int(current["revision"]) != expected:
                        raise ChartConflict("layout revision changed; refresh before saving")
                    revision = expected + 1
                    connection.execute(
                        "UPDATE chart_layouts SET updated_at_ms = ?, revision = ?, payload_json = ? WHERE layout_key = ?",
                        (now, revision, _canonical_json(normalized), layout_key),
                    )
        return self.get_layout(layout_key)

    def get_layout(self, layout_key):
        layout_key = _text(layout_key, "layout_key", 128)
        with self._connection() as connection:
            row = connection.execute(
                "SELECT layout_key, updated_at_ms, revision, payload_json FROM chart_layouts WHERE layout_key = ?",
                (layout_key,),
            ).fetchone()
        if row is None:
            raise ChartNotFound("layout was not found")
        return {
            "layout_schema_version": "chart-layout-v1",
            "layout_key": row["layout_key"],
            "updated_at_ms": int(row["updated_at_ms"]),
            "revision": int(row["revision"]),
            "payload": json.loads(row["payload_json"]),
        }
