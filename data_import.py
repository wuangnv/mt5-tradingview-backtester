"""Streaming CSV preview and immutable import primitives for U2 Data Desk."""

import csv
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile

from data_contracts import InstrumentSpec, SourceSpec


TRANSFORM_VERSION = "u2-normalize-v1"
REQUIRED_COLUMNS = ("time", "open", "high", "low", "close")


class DataImportError(ValueError):
    pass


def _hash_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_hash(value):
    encoded = json.dumps(
        value,
        sort_keys=True,
        ensure_ascii=True,
        allow_nan=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _source_snapshot(source):
    return {
        "source_id": source.source_id,
        "provider": source.provider,
        "instrument_mapping": dict(sorted(source.instrument_mapping.items())),
        "license_use": source.license_use,
        "retrieved_at_utc": source.retrieved_at_utc,
        "export_settings": source.export_settings,
    }


def _instrument_snapshot(instrument):
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


def _decimal_text(value, name, row_number):
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise DataImportError(f"row {row_number}: {name} must be numeric") from exc
    if not number.is_finite():
        raise DataImportError(f"row {row_number}: {name} must be finite")
    normalized = format(number.normalize(), "f")
    return normalized if normalized != "-0" else "0"


def _parse_time(value, row_number):
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


def _normalize_row(row, row_number):
    timestamp = _parse_time(row.get("time"), row_number)
    open_price = _decimal_text(row.get("open"), "open", row_number)
    high = _decimal_text(row.get("high"), "high", row_number)
    low = _decimal_text(row.get("low"), "low", row_number)
    close = _decimal_text(row.get("close"), "close", row_number)
    if Decimal(high) < max(Decimal(open_price), Decimal(close), Decimal(low)):
        raise DataImportError(f"row {row_number}: high is below OHLC values")
    if Decimal(low) > min(Decimal(open_price), Decimal(close), Decimal(high)):
        raise DataImportError(f"row {row_number}: low is above OHLC values")
    volume = _decimal_text(row.get("volume", 0), "volume", row_number)
    return {
        "source_row": row_number,
        "time_utc": timestamp,
        "open": open_price,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
    }


def _read_rows(path):
    with Path(path).open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = [name for name in REQUIRED_COLUMNS if name not in (reader.fieldnames or [])]
        if missing:
            raise DataImportError(f"missing required columns: {', '.join(missing)}")
        for row_number, row in enumerate(reader, start=2):
            yield _normalize_row(row, row_number)


def _read_columns(path):
    with Path(path).open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        try:
            return [str(column).strip() for column in next(reader)]
        except StopIteration:
            return []


def preview_csv(path, source, instrument, timeframe_seconds, holdout_policy=None, gap_classifier=None):
    path = Path(path)
    if not path.is_file():
        raise DataImportError("import source does not exist")
    source = source if isinstance(source, SourceSpec) else SourceSpec.from_mapping(source)
    instrument = instrument if isinstance(instrument, InstrumentSpec) else InstrumentSpec.from_mapping(instrument)
    try:
        timeframe_seconds = int(timeframe_seconds)
    except (TypeError, ValueError) as exc:
        raise DataImportError("timeframe_seconds must be an integer") from exc
    if timeframe_seconds <= 0:
        raise DataImportError("timeframe_seconds must be positive")

    row_count = 0
    duplicate_count = 0
    out_of_order_count = 0
    previous_input_time = None
    first_time = None
    last_time = None
    normalized_digest = hashlib.sha256()
    timestamp_db = sqlite3.connect("")
    try:
        timestamp_db.execute("CREATE TABLE timestamps (time_utc INTEGER PRIMARY KEY)")
        for row in _read_rows(path):
            row_count += 1
            timestamp = row["time_utc"]
            if previous_input_time is not None and timestamp < previous_input_time:
                out_of_order_count += 1
            previous_input_time = timestamp
            first_time = timestamp if first_time is None else min(first_time, timestamp)
            last_time = timestamp if last_time is None else max(last_time, timestamp)
            inserted = timestamp_db.execute(
                "INSERT OR IGNORE INTO timestamps (time_utc) VALUES (?)",
                (timestamp,),
            )
            if inserted.rowcount == 0:
                duplicate_count += 1
            normalized_digest.update(
                json.dumps(row, sort_keys=True, separators=(",", ":")).encode("ascii")
            )
            normalized_digest.update(b"\n")
        timestamp_db.commit()
        unique_row_count = int(timestamp_db.execute("SELECT COUNT(*) FROM timestamps").fetchone()[0])

        gaps = []
        previous_time = None
        for (current_time,) in timestamp_db.execute("SELECT time_utc FROM timestamps ORDER BY time_utc"):
            if previous_time is None:
                previous_time = current_time
                continue
            delta = current_time - previous_time
            if delta > timeframe_seconds:
                classification = "unknown"
                if gap_classifier is not None:
                    classification = str(gap_classifier(previous_time, current_time) or "unknown")
                if classification not in {"scheduled_closed", "missing_expected", "source_sparse", "unknown"}:
                    raise DataImportError("gap_classifier returned unsupported classification")
                gaps.append(
                    {
                        "from_utc": previous_time,
                        "to_utc": current_time,
                        "missing_intervals": max(0, delta // timeframe_seconds - 1),
                        "classification": classification,
                    }
                )
            previous_time = current_time
    finally:
        timestamp_db.close()

    raw_sha256 = _hash_file(path)
    source_snapshot = _source_snapshot(source)
    instrument_snapshot = _instrument_snapshot(instrument)
    if row_count == 0:
        disposition = "missing_data"
    elif duplicate_count or out_of_order_count or gaps:
        disposition = "review"
    else:
        disposition = "pass"
    preview_core = {
        "schema_version": "u2-import-preview-v1",
        "source_id": source.source_id,
        "instrument_id": instrument.instrument_id,
        "source": source_snapshot,
        "instrument": instrument_snapshot,
        "timeframe_seconds": timeframe_seconds,
        "raw_sha256": raw_sha256,
        "normalized_sha256": normalized_digest.hexdigest(),
        "row_count": row_count,
        "unique_row_count": unique_row_count,
        "raw_partition": {
            "byte_count": path.stat().st_size,
            "schema": _read_columns(path),
            "timezone_policy": "unix-seconds-or-explicit-offset",
        },
        "available_range": None if first_time is None else {
            "from_utc": first_time,
            "to_utc": last_time,
        },
        "quality": {
            "duplicates": duplicate_count,
            "out_of_order": out_of_order_count,
            "gaps": gaps,
            "disposition": disposition,
        },
        "holdout_policy": dict(holdout_policy or {"mode": "none"}),
        "transform_version": TRANSFORM_VERSION,
    }
    preview_core["preview_id"] = _canonical_hash(preview_core)
    preview_core["dataset_id"] = "dataset-sha256:" + _canonical_hash(
        {
            "raw_sha256": raw_sha256,
            "normalized_sha256": preview_core["normalized_sha256"],
            "source": source_snapshot,
            "instrument": instrument_snapshot,
            "timeframe_seconds": timeframe_seconds,
            "transform_version": TRANSFORM_VERSION,
            "holdout_policy": preview_core["holdout_policy"],
        }
    )
    return preview_core


def import_csv(path, destination_root, source, instrument, timeframe_seconds, holdout_policy=None, gap_classifier=None):
    preview = preview_csv(
        path,
        source,
        instrument,
        timeframe_seconds,
        holdout_policy=holdout_policy,
        gap_classifier=gap_classifier,
    )
    destination_root = Path(destination_root)
    dataset_key = preview["dataset_id"].split(":", 1)[1]
    target = destination_root / "datasets" / dataset_key
    if target.exists():
        raise DataImportError("dataset already exists; immutable import refuses overwrite")
    target.parent.mkdir(parents=True, exist_ok=True)
    temp_root = Path(tempfile.mkdtemp(prefix="u2-import-", dir=str(target.parent)))
    try:
        raw_dir = temp_root / "raw"
        normalized_dir = temp_root / "normalized"
        raw_dir.mkdir()
        normalized_dir.mkdir()
        raw_target = raw_dir / Path(path).name
        shutil.copyfile(path, raw_target)
        bars_path = normalized_dir / "bars.ndjson"
        with bars_path.open("w", encoding="utf-8", newline="\n") as handle:
            for row in _read_rows(path):
                handle.write(json.dumps(row, sort_keys=True, separators=(",", ":")))
                handle.write("\n")
        manifest = dict(preview)
        manifest.update(
            {
                "raw_relative_path": f"raw/{raw_target.name}",
                "normalized_relative_path": "normalized/bars.ndjson",
                "raw_copy_sha256": _hash_file(raw_target),
                "normalized_copy_sha256": _hash_file(bars_path),
            }
        )
        (temp_root / "manifest.json").write_text(
            json.dumps(manifest, sort_keys=True, indent=2),
            encoding="utf-8",
        )
        os.replace(str(temp_root), str(target))
        return {"dataset_path": str(target), "manifest": manifest}
    except Exception:
        if temp_root.exists():
            shutil.rmtree(temp_root, ignore_errors=True)
        raise
