from __future__ import annotations

import csv
import hashlib
import json
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

import duckdb

from .artifacts import ArtifactStore
from .contracts import DatasetManifest, DatasetSource, utc_now_iso
from .retained import InstrumentSpec
from .store import PostgresStore


TRANSFORM_VERSION = "u2-normalize-v2"
REQUIRED_COLUMNS = ("time", "open", "high", "low", "close")
GAP_CLASSES = {"scheduled_closed", "missing_expected", "source_sparse", "unknown"}


class DataImportError(ValueError):
    pass


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _canonical_hash(value: object) -> str:
    payload = json.dumps(
        value,
        sort_keys=True,
        ensure_ascii=True,
        allow_nan=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _decimal_text(value: object, name: str, row_number: int) -> str:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise DataImportError(f"row {row_number}: {name} must be numeric") from exc
    if not number.is_finite():
        raise DataImportError(f"row {row_number}: {name} must be finite")
    normalized = format(number.normalize(), "f")
    return normalized if normalized != "-0" else "0"


def _parse_time(value: object, row_number: int) -> int:
    text = str(value or "").strip()
    if not text:
        raise DataImportError(f"row {row_number}: time is required")
    try:
        if text.lstrip("-").isdigit():
            timestamp = int(text)
            if timestamp < 0:
                raise ValueError
            return timestamp
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise DataImportError(f"row {row_number}: ISO time must include timezone")
        return int(parsed.astimezone(timezone.utc).timestamp())
    except DataImportError:
        raise
    except (TypeError, ValueError, OverflowError) as exc:
        raise DataImportError(f"row {row_number}: time must be unix seconds or ISO-8601") from exc


def _normalize_row(row: dict[str, str], row_number: int) -> dict:
    timestamp = _parse_time(row.get("time"), row_number)
    open_price = _decimal_text(row.get("open"), "open", row_number)
    high = _decimal_text(row.get("high"), "high", row_number)
    low = _decimal_text(row.get("low"), "low", row_number)
    close = _decimal_text(row.get("close"), "close", row_number)
    if Decimal(high) < max(Decimal(open_price), Decimal(close), Decimal(low)):
        raise DataImportError(f"row {row_number}: high is below OHLC values")
    if Decimal(low) > min(Decimal(open_price), Decimal(close), Decimal(high)):
        raise DataImportError(f"row {row_number}: low is above OHLC values")
    return {
        "source_row": row_number,
        "timestamp": timestamp,
        "open": open_price,
        "high": high,
        "low": low,
        "close": close,
        "volume": _decimal_text(row.get("volume", 0), "volume", row_number),
    }


def _read_rows(path: Path):
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = [name for name in REQUIRED_COLUMNS if name not in (reader.fieldnames or [])]
        if missing:
            raise DataImportError(f"missing required columns: {', '.join(missing)}")
        for row_number, row in enumerate(reader, start=2):
            yield _normalize_row(row, row_number)


def _parquet_rows(path: Path):
    for row in _read_rows(path):
        yield {
            "timestamp": row["timestamp"],
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
            "volume": float(row["volume"]),
        }


def _instrument_snapshot(instrument: InstrumentSpec) -> dict:
    return {
        "instrument_id": instrument.instrument_id,
        "asset_class": instrument.asset_class,
        "base_ccy": instrument.base_ccy,
        "quote_ccy": instrument.quote_ccy,
        "account_ccy": instrument.account_ccy,
        "tick_size": str(instrument.tick_size),
        "pip_size": str(instrument.pip_size),
        "contract_size": str(instrument.contract_size),
        "quantity_min": str(instrument.quantity_min),
        "quantity_step": str(instrument.quantity_step),
        "effective_from_utc": instrument.effective_from_utc,
        "effective_to_utc": instrument.effective_to_utc,
    }


def _holdout_snapshot(value: dict | None) -> dict:
    policy = dict(value or {"mode": "none"})
    mode = str(policy.get("mode") or "none")
    if mode == "none":
        return {"mode": "none"}
    if mode != "metadata_only":
        raise DataImportError("holdout content access is not allowed by this import slice")
    try:
        boundary = int(policy["from_utc"])
    except (KeyError, TypeError, ValueError) as exc:
        raise DataImportError("metadata_only holdout requires integer from_utc") from exc
    return {"mode": "metadata_only", "from_utc": boundary}


def preview_csv(
    path: str | Path,
    source: DatasetSource | dict,
    instrument: InstrumentSpec | dict,
    timeframe_seconds: int,
    *,
    holdout_policy: dict | None = None,
    gap_classifier=None,
) -> dict:
    path = Path(path)
    if not path.is_file():
        raise DataImportError("import source does not exist")
    source = source if isinstance(source, DatasetSource) else DatasetSource.model_validate(source)
    instrument = instrument if isinstance(instrument, InstrumentSpec) else InstrumentSpec.from_mapping(instrument)
    try:
        timeframe_seconds = int(timeframe_seconds)
    except (TypeError, ValueError) as exc:
        raise DataImportError("timeframe_seconds must be an integer") from exc
    if timeframe_seconds <= 0:
        raise DataImportError("timeframe_seconds must be positive")

    raw_sha256 = _hash_file(path)
    normalized_digest = hashlib.sha256()
    row_count = 0
    duplicate_count = 0
    out_of_order_count = 0
    previous_input_time = None
    first_time = None
    last_time = None
    timestamps = duckdb.connect(":memory:")
    try:
        timestamps.execute("CREATE TABLE timestamps(time_utc BIGINT PRIMARY KEY)")
        for row in _read_rows(path):
            row_count += 1
            timestamp = int(row["timestamp"])
            if previous_input_time is not None and timestamp < previous_input_time:
                out_of_order_count += 1
            previous_input_time = timestamp
            first_time = timestamp if first_time is None else min(first_time, timestamp)
            last_time = timestamp if last_time is None else max(last_time, timestamp)
            inserted = timestamps.execute(
                "INSERT INTO timestamps VALUES (?) ON CONFLICT DO NOTHING RETURNING time_utc",
                [timestamp],
            ).fetchone()
            if inserted is None:
                duplicate_count += 1
            normalized_digest.update(
                json.dumps(row, sort_keys=True, separators=(",", ":")).encode("ascii")
            )
            normalized_digest.update(b"\n")

        unique_row_count = int(timestamps.execute("SELECT count(*) FROM timestamps").fetchone()[0])
        gaps = []
        previous_time = None
        cursor = timestamps.execute("SELECT time_utc FROM timestamps ORDER BY time_utc")
        while True:
            ordered = cursor.fetchmany(10_000)
            if not ordered:
                break
            for (current_time,) in ordered:
                if previous_time is not None:
                    delta = int(current_time) - int(previous_time)
                    if delta > timeframe_seconds:
                        classification = "unknown"
                        if gap_classifier is not None:
                            classification = str(gap_classifier(int(previous_time), int(current_time)) or "unknown")
                        if classification not in GAP_CLASSES:
                            raise DataImportError("gap_classifier returned unsupported classification")
                        gaps.append(
                            {
                                "from_utc": int(previous_time),
                                "to_utc": int(current_time),
                                "missing_intervals": max(0, delta // timeframe_seconds - 1),
                                "classification": classification,
                            }
                        )
                previous_time = current_time
    finally:
        timestamps.close()

    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        try:
            columns = [str(column).strip() for column in next(reader)]
        except StopIteration:
            columns = []
    disposition = "missing_data" if row_count == 0 else "review" if duplicate_count or out_of_order_count or gaps else "pass"
    source_snapshot = source.model_dump(mode="json")
    instrument_snapshot = _instrument_snapshot(instrument)
    holdout = _holdout_snapshot(holdout_policy)
    if holdout["mode"] == "metadata_only" and last_time is not None and int(last_time) >= int(holdout["from_utc"]):
        raise DataImportError("import source crosses the locked holdout boundary")
    preview = {
        "schema_version": "u2-import-preview-v2",
        "source": source_snapshot,
        "instrument": instrument_snapshot,
        "timeframe_seconds": timeframe_seconds,
        "raw_sha256": raw_sha256,
        "normalized_sha256": normalized_digest.hexdigest(),
        "row_count": row_count,
        "unique_row_count": unique_row_count,
        "raw_partition": {
            "byte_count": path.stat().st_size,
            "schema": columns,
            "timezone_policy": "unix-seconds-or-explicit-offset",
        },
        "available_range": None if first_time is None else {"from_utc": first_time, "to_utc": last_time},
        "quality": {
            "duplicates": duplicate_count,
            "out_of_order": out_of_order_count,
            "gaps": gaps,
            "disposition": disposition,
        },
        "holdout_policy": holdout,
        "transform_version": TRANSFORM_VERSION,
    }
    preview["preview_id"] = _canonical_hash(preview)
    preview["dataset_id"] = "dataset-" + _canonical_hash(
        {
            "raw_sha256": raw_sha256,
            "normalized_sha256": preview["normalized_sha256"],
            "source": source_snapshot,
            "instrument": instrument_snapshot,
            "timeframe_seconds": timeframe_seconds,
            "holdout_policy": holdout,
            "transform_version": TRANSFORM_VERSION,
        }
    )
    return preview


class DataIngestService:
    def __init__(self, store: PostgresStore, artifacts: ArtifactStore):
        self.store = store
        self.artifacts = artifacts

    def import_csv(
        self,
        *,
        workspace_id: str,
        path: str | Path,
        source: DatasetSource | dict,
        instrument: InstrumentSpec | dict,
        timeframe_seconds: int,
        holdout_policy: dict | None = None,
        gap_classifier=None,
    ) -> DatasetManifest:
        preview = preview_csv(
            path,
            source,
            instrument,
            timeframe_seconds,
            holdout_policy=holdout_policy,
            gap_classifier=gap_classifier,
        )
        if preview["row_count"] < 2:
            raise DataImportError("dataset requires at least two rows")
        dataset_id = preview["dataset_id"]
        if self.store.get_dataset(workspace_id, dataset_id) is not None:
            raise DataImportError("dataset already exists; immutable import refuses overwrite")
        self.store.ensure_workspace(workspace_id)
        raw_path, raw_sha256 = self.artifacts.write_raw_source(workspace_id, dataset_id, path)
        artifact_path, artifact_sha256 = self.artifacts.write_dataset_iter(
            workspace_id,
            dataset_id,
            _parquet_rows(Path(path)),
        )
        source_model = source if isinstance(source, DatasetSource) else DatasetSource.model_validate(source)
        manifest = DatasetManifest(
            dataset_id=dataset_id,
            workspace_id=workspace_id,
            source=source_model,
            instrument_id=preview["instrument"]["instrument_id"],
            timeframe=f"{int(timeframe_seconds)}s",
            row_count=int(preview["row_count"]),
            first_timestamp=int(preview["available_range"]["from_utc"]),
            last_timestamp=int(preview["available_range"]["to_utc"]),
            artifact_path=artifact_path,
            artifact_sha256=artifact_sha256,
            raw_artifact_path=raw_path,
            raw_sha256=raw_sha256,
            normalized_sha256=preview["normalized_sha256"],
            instrument_spec=preview["instrument"],
            timeframe_seconds=int(timeframe_seconds),
            available_range=preview["available_range"],
            quality=preview["quality"],
            holdout_policy=preview["holdout_policy"],
            transform_version=TRANSFORM_VERSION,
            created_at_utc=utc_now_iso(),
        )
        self.store.put_dataset(manifest)
        return manifest
