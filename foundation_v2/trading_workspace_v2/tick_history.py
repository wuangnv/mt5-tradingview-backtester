"""Immutable, tenant-scoped broker ticks; requested intervals are not verified coverage."""
from __future__ import annotations

import csv
import gzip
import hashlib
import json
import math
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq


COLUMNS = ("time_msc", "bid", "ask", "last", "volume", "flags", "volume_real")
DAY_MSC = 86_400_000
SCHEMA = pa.schema([
    ("time_msc", pa.int64()), ("bid", pa.float64()), ("ask", pa.float64()),
    ("last", pa.float64()), ("volume", pa.uint64()), ("flags", pa.uint32()),
    ("volume_real", pa.float64()), ("sequence", pa.int64()),
])


class TickHistoryError(ValueError):
    pass


def _sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def _spec_identity(metadata: dict) -> dict:
    metadata = json.loads(_canonical(metadata))
    metadata.pop("captured_at_utc", None)
    instrument = metadata.get("instrument", {})
    # The SDK collector records observation time here, not a broker spec change.
    instrument.pop("effective_from_utc", None)
    return metadata


def _token(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value):
        raise TickHistoryError("invalid storage identity")
    return value


def _atomic(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_bytes(payload)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


class TickHistoryStore:
    def __init__(self, root: Path | str):
        self.root = Path(root)

    def _home(self, workspace: str) -> Path:
        return self.root / _token(workspace) / "ticks"

    def load_manifest(self, workspace: str, snapshot_id: str) -> dict:
        if not re.fullmatch(r"ticks-[0-9a-f]{64}", snapshot_id):
            raise TickHistoryError("invalid snapshot identity")
        path = self._home(workspace) / "manifests" / f"{snapshot_id}.json"
        if not path.is_file():
            raise TickHistoryError("tick snapshot not found in workspace")
        manifest = json.loads(path.read_bytes())
        identity = manifest.pop("snapshot_id", None)
        actual = "ticks-" + hashlib.sha256(_canonical(manifest)).hexdigest()
        manifest["snapshot_id"] = identity
        if identity != snapshot_id or actual != snapshot_id or manifest.get("workspace_id") != workspace:
            raise TickHistoryError("tick manifest checksum mismatch")
        return manifest

    def latest(self, workspace: str, symbol: str) -> dict | None:
        pointer = self._home(workspace) / "latest" / f"{_token(symbol)}.json"
        if not pointer.is_file():
            return None
        return self.load_manifest(workspace, json.loads(pointer.read_bytes())["snapshot_id"])

    def ingest_capture(self, workspace: str, receipt_path: Path | str) -> dict:
        receipt_path = Path(receipt_path)
        receipt = json.loads(receipt_path.read_bytes())
        symbol = _token(receipt["symbol"])
        start, end = int(receipt["requested_from_msc"]), int(receipt["requested_to_msc"])
        if start < 0 or end <= start or start // DAY_MSC != (end - 1) // DAY_MSC:
            raise TickHistoryError("capture must request a nonempty interval in one UTC day")
        if receipt.get("execution_capability") is not False or receipt.get("mode") != "demo":
            raise TickHistoryError("tick source must explicitly deny broker execution")
        source = {
            "provider": receipt.get("provider", "mt5"), "server": receipt["server"],
            "account_key": receipt["account_key"], "mode": receipt.get("mode"), "symbol": symbol,
        }
        previous = self.latest(workspace, symbol)
        if previous and previous["source"] != source:
            raise TickHistoryError("tick source identity changed")
        raw_path = (receipt_path.parent / receipt["tick_file"]).resolve()
        if not raw_path.is_relative_to(receipt_path.parent.resolve()):
            raise TickHistoryError("tick capture path escapes receipt directory")
        if _sha(raw_path) != receipt["raw_sha256"]:
            raise TickHistoryError("raw tick checksum mismatch")
        home = self._home(workspace)
        staging = home / "objects" / f".{uuid.uuid4().hex}.parquet"
        staging.parent.mkdir(parents=True, exist_ok=True)
        count = 0
        first = last = None
        same_millisecond = invalid_quotes = large_intervals = 0
        writer = None
        try:
            rows = []
            with gzip.open(raw_path, "rt", encoding="utf-8-sig", newline="") as handle:
                reader = csv.DictReader(handle)
                if reader.fieldnames != list(COLUMNS):
                    raise TickHistoryError("tick CSV columns do not match contract")
                writer = pq.ParquetWriter(staging, SCHEMA, compression="zstd")
                for raw in reader:
                    try:
                        row = {key: int(raw[key]) if key in {"time_msc", "volume", "flags"}
                               else float(raw[key]) for key in COLUMNS}
                    except (ValueError, TypeError, KeyError) as exc:
                        raise TickHistoryError("invalid tick row") from exc
                    stamp = row["time_msc"]
                    if stamp < start or stamp >= end or (last is not None and stamp < last):
                        raise TickHistoryError("ticks must be ordered within requested half-open interval")
                    if any(not math.isfinite(row[key]) or row[key] < 0 for key in ("bid", "ask", "last", "volume_real")):
                        raise TickHistoryError("tick price or volume is not finite and nonnegative")
                    if not 0 <= row["volume"] < 2**64 or not 0 <= row["flags"] < 2**32:
                        raise TickHistoryError("invalid tick flags or volume")
                    if last is not None:
                        same_millisecond += int(stamp == last)
                        large_intervals += int(stamp - last > 60_000)
                    invalid_quotes += int(row["bid"] <= 0 or row["ask"] <= 0 or row["ask"] < row["bid"])
                    row["sequence"] = count
                    count += 1
                    first = stamp if first is None else first
                    last = stamp
                    rows.append(row)
                    if len(rows) >= 8192:
                        writer.write_table(pa.Table.from_pylist(rows, schema=SCHEMA))
                        rows = []
                if rows:
                    writer.write_table(pa.Table.from_pylist(rows, schema=SCHEMA))
            writer.close()
            writer = None
            if count != int(receipt["row_count"]):
                raise TickHistoryError("tick receipt row count mismatch")
            if receipt.get("status", "downloaded") not in {"downloaded", "unavailable"}:
                raise TickHistoryError("unsupported tick capture status")
            if receipt.get("status") == "unavailable" and count:
                raise TickHistoryError("unavailable capture contains ticks")
            file_sha = _sha(staging)
            relative = f"objects/{file_sha}.parquet"
            target = home / relative
            if target.exists():
                if _sha(target) != file_sha:
                    raise TickHistoryError("stored tick object checksum mismatch")
            else:
                staging.replace(target)
            date = datetime.fromtimestamp(start // 1000, timezone.utc).date().isoformat()
            partition = {
                "date": date, "requested_from_msc": start, "requested_to_msc": end,
                "row_count": count, "first_tick_msc": first, "last_tick_msc": last,
                "status": "downloaded" if count else "unavailable", "path": relative,
                "sha256": file_sha, "bytes": target.stat().st_size,
                "raw_sha256": receipt["raw_sha256"],
                "same_millisecond_rows": same_millisecond, "invalid_quote_rows": invalid_quotes,
                "intervals_over_60s": large_intervals,
            }
            parts = list(previous["partitions"]) if previous else []
            existing = next((part for part in parts if part["date"] == date), None)
            if existing:
                if start > existing["requested_from_msc"] or end < existing["requested_to_msc"]:
                    raise TickHistoryError("replacement must cover existing requested day interval")
                if existing["row_count"] and not count:
                    raise TickHistoryError("empty refresh cannot replace retained ticks")
                equivalent = lambda part: {key: value for key, value in part.items() if key != "raw_sha256"}
                if equivalent(existing) == equivalent(partition):
                    partition = existing
                parts.remove(existing)
            parts.append(partition)
            parts.sort(key=lambda part: part["requested_from_msc"])
            available = [part for part in parts if part["row_count"]]
            metadata = receipt.get("metadata", {})
            if previous and _spec_identity(previous["metadata"]) == _spec_identity(metadata):
                metadata = previous["metadata"]
            manifest = {
                "schema_version": 1, "workspace_id": workspace, "symbol": symbol,
                "source": source, "metadata": metadata, "partitions": parts,
                "row_count": sum(part["row_count"] for part in parts),
                "bytes": sum(part["bytes"] for part in parts),
                "requested_from_msc": min(part["requested_from_msc"] for part in parts),
                "requested_to_msc": max(part["requested_to_msc"] for part in parts),
                "first_tick_msc": min((part["first_tick_msc"] for part in available), default=None),
                "last_tick_msc": max((part["last_tick_msc"] for part in available), default=None),
                "quality": "review", "coverage": "broker_returned_unverified",
                "available_intervals": [[part["requested_from_msc"], part["requested_to_msc"]] for part in available],
                "unavailable_intervals": [[part["requested_from_msc"], part["requested_to_msc"]] for part in parts if not part["row_count"]],
            }
            snapshot_id = "ticks-" + hashlib.sha256(_canonical(manifest)).hexdigest()
            manifest["snapshot_id"] = snapshot_id
            manifest_path = home / "manifests" / f"{snapshot_id}.json"
            if not manifest_path.exists():
                _atomic(manifest_path, _canonical(manifest))
            else:
                self.load_manifest(workspace, snapshot_id)
            _atomic(home / "latest" / f"{symbol}.json", _canonical({"snapshot_id": snapshot_id}))
            return manifest
        finally:
            if writer is not None:
                writer.close()
            staging.unlink(missing_ok=True)

    def assert_interval(self, workspace: str, snapshot_id: str, start_msc: int, end_msc: int) -> None:
        if end_msc <= start_msc:
            raise TickHistoryError("tick interval must be nonempty")
        cursor = start_msc
        manifest = self.load_manifest(workspace, snapshot_id)
        for start, end in manifest["available_intervals"]:
            if start > cursor:
                break
            if end > cursor:
                cursor = end
            if cursor >= end_msc:
                return
        raise TickHistoryError("tick interval not downloaded in pinned snapshot")

    def iter_ticks(self, workspace: str, snapshot_id: str, start_msc: int, end_msc: int, batch_size: int = 8192):
        if end_msc <= start_msc or not 1 <= batch_size <= 65_536:
            raise TickHistoryError("invalid tick read interval or batch size")
        manifest = self.load_manifest(workspace, snapshot_id)
        home = self._home(workspace)
        for part in manifest["partitions"]:
            if not part["row_count"] or part["requested_to_msc"] <= start_msc or part["requested_from_msc"] >= end_msc:
                continue
            if not re.fullmatch(r"objects/[0-9a-f]{64}\.parquet", part["path"]):
                raise TickHistoryError("invalid tick object path")
            path = home / part["path"]
            if _sha(path) != part["sha256"]:
                raise TickHistoryError("stored tick object checksum mismatch")
            with pq.ParquetFile(path) as parquet:
                groups = []
                for index in range(parquet.num_row_groups):
                    statistics = parquet.metadata.row_group(index).column(0).statistics
                    if statistics is None or (statistics.max >= start_msc and statistics.min < end_msc):
                        groups.append(index)
                for batch in parquet.iter_batches(batch_size=batch_size, row_groups=groups):
                    for row in batch.to_pylist():
                        if start_msc <= row["time_msc"] < end_msc:
                            yield row
