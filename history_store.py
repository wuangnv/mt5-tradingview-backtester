"""
Local-first chunked history store.

Compatibility:
- Reads existing data/SYMBOL_TIMEFRAME.json flat files.
- Writes chunk metadata/files under data/chunks/SYMBOL/TIMEFRAME/.
- Keeps the old save/load/get_status/delete API used by Flask routes.
"""
import json
import os
import re
import shutil
import time
import threading
from bisect import bisect_left, bisect_right
from datetime import datetime, timezone, timedelta


DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
CHUNKS_DIR = os.path.join(DATA_DIR, "chunks")

TIMEFRAME_SECONDS = {
    "M1": 60,
    "M5": 300,
    "M15": 900,
    "M30": 1800,
    "H1": 3600,
    "H4": 14400,
    "D1": 86400,
    "W1": 604800,
}

MT5_HISTORY_POLICY_MONTHS = {
    "M1": 12,
    "M5": 18,
    "M15": 24,
    "M30": 30,
    "H1": 36,
    "H4": 60,
}

DEFAULT_CHUNK_BARS = {
    "M1": 1440,
    "M5": 2016,
    "M15": 1344,
    "M30": 1344,
    "H1": 1000,
    "H4": 1000,
    "D1": 1000,
    "W1": 520,
}

MAX_MEMORY_CHUNKS = 256


def _norm(value):
    return str(value or "").strip().upper()


def _bar_time(bar):
    return int(bar["time"])


def _dedupe_sort(bars):
    by_time = {}
    for bar in bars or []:
        try:
            normalized = dict(bar)
            normalized["time"] = int(normalized["time"])
            if "volume" not in normalized and "tick_volume" in normalized:
                normalized["volume"] = normalized.get("tick_volume", 0)
            by_time[normalized["time"]] = normalized
        except (KeyError, TypeError, ValueError):
            continue
    return [by_time[t] for t in sorted(by_time)]


class HistoryStore:
    def __init__(self):
        os.makedirs(DATA_DIR, exist_ok=True)
        os.makedirs(CHUNKS_DIR, exist_ok=True)
        self._lock = threading.RLock()
        self._memory_chunks = {}

    def _flat_filepath(self, symbol, timeframe):
        return os.path.join(DATA_DIR, f"{_norm(symbol)}_{_norm(timeframe)}.json")

    def _legacy_meta_filepath(self, symbol, timeframe):
        return os.path.join(DATA_DIR, f"{_norm(symbol)}_{_norm(timeframe)}_meta.json")

    def _legacy_chunk_filepath(self, symbol, timeframe, index):
        return os.path.join(DATA_DIR, f"{_norm(symbol)}_{_norm(timeframe)}_chunk_{int(index)}.json")

    def _chunk_dir(self, symbol, timeframe):
        return os.path.join(CHUNKS_DIR, _norm(symbol), _norm(timeframe))

    def _meta_path(self, symbol, timeframe):
        return os.path.join(self._chunk_dir(symbol, timeframe), "meta.json")

    def _chunk_path(self, symbol, timeframe, index):
        return os.path.join(self._chunk_dir(symbol, timeframe), f"chunk_{int(index):06d}.json")

    def _remember_chunk(self, key, bars):
        if key in self._memory_chunks:
            del self._memory_chunks[key]
        self._memory_chunks[key] = bars
        while len(self._memory_chunks) > MAX_MEMORY_CHUNKS:
            oldest = next(iter(self._memory_chunks))
            del self._memory_chunks[oldest]

    def _read_json(self, path, default=None):
        if not os.path.isfile(path):
            return default
        try:
            with open(path, "r") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            return default

    def _write_json(self, path, payload):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.tmp"
        with open(tmp, "w") as f:
            json.dump(payload, f, separators=(",", ":"))
        os.replace(tmp, path)

    def _count_bars_in_file(self, path):
        try:
            with open(path, "rb") as f:
                return f.read().count(b'"time"')
        except OSError:
            return 0

    def _read_flat_bars(self, symbol, timeframe):
        payload = self._read_json(self._flat_filepath(symbol, timeframe), {})
        return _dedupe_sort(payload.get("bars", []))

    def _read_meta(self, symbol, timeframe):
        meta = self._read_json(self._meta_path(symbol, timeframe), None)
        if not meta or not isinstance(meta.get("chunks"), list):
            return None
        return meta

    def _parse_legacy_name(self, fname):
        meta_match = re.match(r"^(.+)_([A-Z0-9]+)_meta\.json$", fname)
        if meta_match and meta_match.group(2) in TIMEFRAME_SECONDS:
            return meta_match.group(1).upper(), meta_match.group(2).upper(), "meta", None
        chunk_match = re.match(r"^(.+)_([A-Z0-9]+)_chunk_(\d+)\.json$", fname)
        if chunk_match and chunk_match.group(2) in TIMEFRAME_SECONDS:
            return chunk_match.group(1).upper(), chunk_match.group(2).upper(), "chunk", int(chunk_match.group(3))
        return None

    def _migrate_legacy_root_chunks(self, symbol, timeframe):
        symbol = _norm(symbol)
        timeframe = _norm(timeframe)
        legacy_meta = self._read_json(self._legacy_meta_filepath(symbol, timeframe), None)
        if not legacy_meta or not isinstance(legacy_meta.get("chunks"), list):
            return None

        chunk_dir = self._chunk_dir(symbol, timeframe)
        os.makedirs(chunk_dir, exist_ok=True)
        chunks = []
        total = 0
        first_time = None
        last_time = None

        for chunk in sorted(legacy_meta.get("chunks", []), key=lambda c: int(c.get("index", 0))):
            index = int(chunk.get("index", 0))
            source_path = self._legacy_chunk_filepath(symbol, timeframe, index)
            if not os.path.isfile(source_path):
                continue
            count = int(chunk.get("count") or self._count_bars_in_file(source_path))
            if count <= 0:
                continue
            destination_path = self._chunk_path(symbol, timeframe, index)
            if os.path.abspath(source_path) != os.path.abspath(destination_path):
                os.makedirs(os.path.dirname(destination_path), exist_ok=True)
                shutil.copy2(source_path, destination_path)
            chunks.append({
                "index": index,
                "count": count,
                "firstTime": int(chunk.get("firstTime")),
                "lastTime": int(chunk.get("lastTime")),
            })
            total += count
            first_time = int(chunk.get("firstTime")) if first_time is None else min(first_time, int(chunk.get("firstTime")))
            last_time = int(chunk.get("lastTime")) if last_time is None else max(last_time, int(chunk.get("lastTime")))

        if not chunks:
            return None

        chunk_size = max(chunk["count"] for chunk in chunks)
        meta = {
            "symbol": symbol,
            "timeframe": timeframe,
            "chunkSize": chunk_size,
            "count": total,
            "firstTime": first_time,
            "lastTime": last_time,
            "updatedAt": int(time.time()),
            "chunks": chunks,
            "flatCompatible": True,
            "legacyRootMigrated": True,
        }
        self._write_json(self._meta_path(symbol, timeframe), meta)
        return meta

    def _chunk_key(self, symbol, timeframe, index):
        return f"{_norm(symbol)}::{_norm(timeframe)}::{int(index)}"

    def _read_chunk(self, symbol, timeframe, index):
        key = self._chunk_key(symbol, timeframe, index)
        cached = self._memory_chunks.get(key)
        if cached is not None:
            self._remember_chunk(key, cached)
            return cached
        payload = self._read_json(self._chunk_path(symbol, timeframe, index), {})
        bars = _dedupe_sort(payload.get("bars", []))
        if bars:
            self._remember_chunk(key, bars)
        return bars

    def ensure_chunked(self, symbol, timeframe):
        symbol = _norm(symbol)
        timeframe = _norm(timeframe)
        meta = self._read_meta(symbol, timeframe)
        if meta:
            return meta
        legacy = self._migrate_legacy_root_chunks(symbol, timeframe)
        if legacy:
            return legacy
        flat = self._read_flat_bars(symbol, timeframe)
        if not flat:
            return None
        self._write_chunks(symbol, timeframe, flat, keep_flat=False)
        return self._read_meta(symbol, timeframe)

    def _write_chunks(self, symbol, timeframe, bars, keep_flat=False):
        symbol = _norm(symbol)
        timeframe = _norm(timeframe)
        bars = _dedupe_sort(bars)
        chunk_size = DEFAULT_CHUNK_BARS.get(timeframe, 1000)
        chunk_dir = self._chunk_dir(symbol, timeframe)
        os.makedirs(chunk_dir, exist_ok=True)

        existing = [f for f in os.listdir(chunk_dir) if f.startswith("chunk_") and f.endswith(".json")]
        for fname in existing:
            try:
                os.remove(os.path.join(chunk_dir, fname))
            except OSError:
                pass

        chunks = []
        for index, start in enumerate(range(0, len(bars), chunk_size)):
            chunk_bars = bars[start:start + chunk_size]
            if not chunk_bars:
                continue
            self._write_json(self._chunk_path(symbol, timeframe, index), {
                "symbol": symbol,
                "timeframe": timeframe,
                "index": index,
                "bars": chunk_bars,
            })
            self._remember_chunk(self._chunk_key(symbol, timeframe, index), chunk_bars)
            chunks.append({
                "index": index,
                "count": len(chunk_bars),
                "firstTime": chunk_bars[0]["time"],
                "lastTime": chunk_bars[-1]["time"],
            })

        meta = {
            "symbol": symbol,
            "timeframe": timeframe,
            "chunkSize": chunk_size,
            "count": len(bars),
            "firstTime": bars[0]["time"] if bars else None,
            "lastTime": bars[-1]["time"] if bars else None,
            "updatedAt": int(time.time()),
            "chunks": chunks,
            "flatCompatible": True,
        }
        self._write_json(self._meta_path(symbol, timeframe), meta)

        if keep_flat:
            self._write_json(self._flat_filepath(symbol, timeframe), {
                "symbol": symbol,
                "timeframe": timeframe,
                "bars": bars,
                "bars_count": len(bars),
                "updated_at": int(time.time()),
            })

        return meta

    def rechunk(self, symbol, timeframe, chunk_size=None):
        """Rewrite oversized chunks into the default smaller chunk size."""
        with self._lock:
            symbol = _norm(symbol)
            timeframe = _norm(timeframe)
            meta = self.ensure_chunked(symbol, timeframe)
            if not meta:
                return {"success": False, "message": "No local history found"}

            target_size = int(chunk_size or DEFAULT_CHUNK_BARS.get(timeframe, 1000))
            old_chunks = sorted(meta.get("chunks", []), key=lambda c: int(c.get("index", 0)))
            if old_chunks and max(int(c.get("count", 0)) for c in old_chunks) <= target_size:
                return {
                    "success": True,
                    "changed": False,
                    "symbol": symbol,
                    "timeframe": timeframe,
                    "chunks": len(old_chunks),
                    "bars": int(meta.get("count") or 0),
                    "chunkSize": target_size,
                }

            chunk_dir = self._chunk_dir(symbol, timeframe)
            tmp_dir = f"{chunk_dir}.rechunk_tmp"
            backup_dir = f"{chunk_dir}.rechunk_old_{int(time.time())}"
            if os.path.isdir(tmp_dir):
                shutil.rmtree(tmp_dir)
            os.makedirs(tmp_dir, exist_ok=True)

            new_chunks = []
            total = 0
            first_time = None
            last_time = None
            out_index = 0
            buffer = []

            def flush():
                nonlocal out_index, total, first_time, last_time, buffer
                if not buffer:
                    return
                chunk_bars = buffer
                buffer = []
                self._write_json(os.path.join(tmp_dir, f"chunk_{out_index:06d}.json"), {
                    "symbol": symbol,
                    "timeframe": timeframe,
                    "index": out_index,
                    "bars": chunk_bars,
                })
                new_chunks.append({
                    "index": out_index,
                    "count": len(chunk_bars),
                    "firstTime": chunk_bars[0]["time"],
                    "lastTime": chunk_bars[-1]["time"],
                })
                total += len(chunk_bars)
                first_time = chunk_bars[0]["time"] if first_time is None else min(first_time, chunk_bars[0]["time"])
                last_time = chunk_bars[-1]["time"] if last_time is None else max(last_time, chunk_bars[-1]["time"])
                out_index += 1

            for chunk in old_chunks:
                bars = self._read_chunk(symbol, timeframe, int(chunk["index"]))
                for bar in bars:
                    buffer.append(bar)
                    if len(buffer) >= target_size:
                        flush()
            flush()

            new_meta = {
                "symbol": symbol,
                "timeframe": timeframe,
                "chunkSize": target_size,
                "count": total,
                "firstTime": first_time,
                "lastTime": last_time,
                "updatedAt": int(time.time()),
                "chunks": new_chunks,
                "flatCompatible": True,
                "rechunked": True,
            }
            self._write_json(os.path.join(tmp_dir, "meta.json"), new_meta)

            os.replace(chunk_dir, backup_dir)
            os.replace(tmp_dir, chunk_dir)
            shutil.rmtree(backup_dir)
            for key in list(self._memory_chunks):
                if key.startswith(f"{symbol}::{timeframe}::"):
                    del self._memory_chunks[key]

            return {
                "success": True,
                "changed": True,
                "symbol": symbol,
                "timeframe": timeframe,
                "chunks": len(new_chunks),
                "bars": total,
                "chunkSize": target_size,
            }

    def get_status(self):
        result = []
        seen = set()
        if os.path.isdir(DATA_DIR):
            for fname in sorted(os.listdir(DATA_DIR)):
                if not fname.endswith(".json"):
                    continue
                legacy = self._parse_legacy_name(fname)
                if legacy:
                    symbol, timeframe, kind, _ = legacy
                    if kind == "meta":
                        seen.add((symbol, timeframe))
                    continue
                parts = fname[:-5].split("_")
                if len(parts) < 2:
                    continue
                symbol = "_".join(parts[:-1]).upper()
                timeframe = parts[-1].upper()
                seen.add((symbol, timeframe))

        if os.path.isdir(CHUNKS_DIR):
            for symbol in sorted(os.listdir(CHUNKS_DIR)):
                symbol_dir = os.path.join(CHUNKS_DIR, symbol)
                if not os.path.isdir(symbol_dir):
                    continue
                for timeframe in sorted(os.listdir(symbol_dir)):
                    if os.path.isfile(self._meta_path(symbol, timeframe)):
                        seen.add((_norm(symbol), _norm(timeframe)))

        for symbol, timeframe in sorted(seen):
            meta = self.ensure_chunked(symbol, timeframe)
            if not meta:
                continue
            flat_path = self._flat_filepath(symbol, timeframe)
            result.append({
                "symbol": symbol,
                "timeframe": timeframe,
                "bars_count": int(meta.get("count") or 0),
                "first_time": meta.get("firstTime"),
                "last_time": meta.get("lastTime"),
                "chunks_count": len(meta.get("chunks", [])),
                "chunk_size": meta.get("chunkSize"),
                "file_size_kb": round(os.path.getsize(flat_path) / 1024, 1) if os.path.isfile(flat_path) else 0,
                "updated_at": meta.get("updatedAt", 0),
                "source": "chunked_local",
            })
        return result

    def migrate_all_legacy_root_chunks(self):
        migrated = []
        skipped = []
        if not os.path.isdir(DATA_DIR):
            return {"migrated": migrated, "skipped": skipped}
        for fname in sorted(os.listdir(DATA_DIR)):
            parsed = self._parse_legacy_name(fname)
            if not parsed:
                continue
            symbol, timeframe, kind, _ = parsed
            if kind != "meta":
                continue
            meta = self._migrate_legacy_root_chunks(symbol, timeframe)
            if meta:
                migrated.append({"symbol": symbol, "timeframe": timeframe, "chunks": len(meta.get("chunks", [])), "bars": meta.get("count", 0)})
            else:
                skipped.append({"symbol": symbol, "timeframe": timeframe, "reason": "no valid legacy chunks"})
        return {"migrated": migrated, "skipped": skipped}

    def has_data(self, symbol, timeframe):
        return bool(self.ensure_chunked(symbol, timeframe))

    def get_meta(self, symbol, timeframe):
        return self.ensure_chunked(symbol, timeframe)

    def select_chunk_indexes(self, symbol, timeframe, from_time=None, to_time=None, anchor_time=None, max_chunks=None):
        meta = self.ensure_chunked(symbol, timeframe)
        if not meta:
            return []
        chunks = meta.get("chunks", [])
        if not chunks:
            return []

        if from_time is None and to_time is None:
            selected = chunks[-(max_chunks or 3):]
        else:
            from_time = int(from_time if from_time is not None else chunks[0]["firstTime"])
            to_time = int(to_time if to_time is not None else chunks[-1]["lastTime"])
            selected = [c for c in chunks if c["firstTime"] <= to_time and c["lastTime"] >= from_time]
            if not selected:
                anchor = int(anchor_time or to_time)
                selected = [min(chunks, key=lambda c: 0 if c["firstTime"] <= anchor <= c["lastTime"] else min(abs(anchor - c["firstTime"]), abs(anchor - c["lastTime"])))]

        if max_chunks and len(selected) > max_chunks:
            anchor = int(anchor_time or to_time or selected[-1]["lastTime"])
            center = min(range(len(selected)), key=lambda i: 0 if selected[i]["firstTime"] <= anchor <= selected[i]["lastTime"] else min(abs(anchor - selected[i]["firstTime"]), abs(anchor - selected[i]["lastTime"])))
            half = max_chunks // 2
            start = max(0, min(center - half, len(selected) - max_chunks))
            selected = selected[start:start + max_chunks]
        return [c["index"] for c in selected]

    def load(self, symbol, timeframe, from_time=None, to_time=None, count_back=None, anchor_time=None, max_chunks=None):
        with self._lock:
            meta = self.ensure_chunked(symbol, timeframe)
            if not meta:
                return []
            if count_back and not max_chunks and from_time is None and to_time is None:
                chunk_size = int(meta.get("chunkSize") or DEFAULT_CHUNK_BARS.get(timeframe, 1000))
                max_chunks = max(3, (int(count_back) // max(1, chunk_size)) + 2)
            indexes = self.select_chunk_indexes(symbol, timeframe, from_time, to_time, anchor_time, max_chunks)
            bars = []
            for index in indexes:
                bars.extend(self._read_chunk(symbol, timeframe, index))
            bars = _dedupe_sort(bars)
            if from_time is not None:
                bars = [b for b in bars if b["time"] >= int(from_time)]
            if to_time is not None:
                bars = [b for b in bars if b["time"] <= int(to_time)]
            if count_back and len(bars) > int(count_back):
                bars = bars[-int(count_back):]
            return bars

    def load_all(self, symbol, timeframe):
        meta = self.ensure_chunked(symbol, timeframe)
        if not meta:
            return []
        bars = []
        for chunk in meta.get("chunks", []):
            bars.extend(self._read_chunk(symbol, timeframe, chunk["index"]))
        return _dedupe_sort(bars)

    def load_window(self, symbol, timeframe, cursor_time, before_bars=500, after_bars=500):
        meta = self.ensure_chunked(symbol, timeframe)
        if not meta:
            return []
        tf_seconds = TIMEFRAME_SECONDS.get(_norm(timeframe), 3600)
        from_time = int(cursor_time) - int(before_bars) * tf_seconds
        to_time = int(cursor_time) + int(after_bars) * tf_seconds
        return self.load(symbol, timeframe, from_time, to_time, anchor_time=cursor_time, max_chunks=5)

    def save(self, symbol, timeframe, bars):
        with self._lock:
            existing = self.load_all(symbol, timeframe)
            merged = _dedupe_sort(existing + (bars or []))
            meta = self._write_chunks(symbol, timeframe, merged, keep_flat=False)
            return int(meta.get("count") or 0)

    def prune_flat_files(self):
        """Delete legacy root JSON files once corresponding chunk meta exists."""
        deleted = []
        skipped = []
        if not os.path.isdir(DATA_DIR):
            return {"deleted": deleted, "skipped": skipped}

        for fname in sorted(os.listdir(DATA_DIR)):
            if not fname.endswith(".json"):
                continue
            legacy = self._parse_legacy_name(fname)
            if legacy:
                symbol, timeframe, _, _ = legacy
                meta = self._read_meta(symbol, timeframe)
                if meta and meta.get("count", 0) > 0:
                    path = os.path.join(DATA_DIR, fname)
                    try:
                        os.remove(path)
                        deleted.append(fname)
                    except OSError as exc:
                        skipped.append({"file": fname, "reason": str(exc)})
                else:
                    skipped.append({"file": fname, "reason": "no chunk meta"})
                continue
            parts = fname[:-5].split("_")
            if len(parts) < 2:
                continue
            symbol = "_".join(parts[:-1]).upper()
            timeframe = parts[-1].upper()
            meta = self.ensure_chunked(symbol, timeframe)
            if meta and meta.get("count", 0) > 0:
                path = os.path.join(DATA_DIR, fname)
                try:
                    os.remove(path)
                    deleted.append(fname)
                except OSError as exc:
                    skipped.append({"file": fname, "reason": str(exc)})
            else:
                skipped.append({"file": fname, "reason": "no chunk meta"})

        return {"deleted": deleted, "skipped": skipped}

    def delete(self, symbol, timeframe):
        symbol = _norm(symbol)
        timeframe = _norm(timeframe)
        deleted = False
        flat = self._flat_filepath(symbol, timeframe)
        if os.path.isfile(flat):
            os.remove(flat)
            deleted = True
        chunk_dir = self._chunk_dir(symbol, timeframe)
        if os.path.isdir(chunk_dir):
            for fname in os.listdir(chunk_dir):
                try:
                    os.remove(os.path.join(chunk_dir, fname))
                except OSError:
                    pass
            try:
                os.rmdir(chunk_dir)
            except OSError:
                pass
            deleted = True
        for key in list(self._memory_chunks):
            if key.startswith(f"{symbol}::{timeframe}::"):
                del self._memory_chunks[key]
        return deleted

    def coverage(self, symbol, timeframe):
        meta = self.ensure_chunked(symbol, timeframe)
        return {
            "symbol": _norm(symbol),
            "timeframe": _norm(timeframe),
            "bars": int(meta.get("count") or 0) if meta else 0,
            "first": meta.get("firstTime") if meta else None,
            "last": meta.get("lastTime") if meta else None,
            "chunks": meta.get("chunks", []) if meta else [],
        }

    def mt5_cutoff_ts(self, timeframe, now=None):
        timeframe = _norm(timeframe)
        if timeframe not in MT5_HISTORY_POLICY_MONTHS:
            return None
        now = now or datetime.now(timezone.utc)
        return int((now - timedelta(days=MT5_HISTORY_POLICY_MONTHS[timeframe] * 30)).timestamp())

    def should_try_mt5(self, timeframe, target_ts):
        cutoff = self.mt5_cutoff_ts(timeframe)
        return cutoff is None or int(target_ts) >= cutoff

    def policy(self):
        now = datetime.now(timezone.utc)
        return {
            "storage": "chunked_json",
            "data_dir": DATA_DIR,
            "chunks_dir": CHUNKS_DIR,
            "time_standard": "UTC unix seconds",
            "chunk_bars": DEFAULT_CHUNK_BARS,
            "mt5_history_policy_months": MT5_HISTORY_POLICY_MONTHS,
            "mt5_cutoffs": {tf: self.mt5_cutoff_ts(tf, now) for tf in TIMEFRAME_SECONDS},
        }


history_store = HistoryStore()
