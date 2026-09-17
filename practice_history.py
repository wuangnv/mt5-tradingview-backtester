"""Read-only access to the local chunked market-history cache for P3."""

import hashlib
import json
import math
import re
from pathlib import Path


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
_SYMBOL_RE = re.compile(r"^[A-Z0-9._-]{1,32}$")


class PracticeHistoryError(RuntimeError):
    code = "HISTORY_READ_FAILURE"


class PracticeHistoryNotFound(PracticeHistoryError):
    code = "HISTORY_NOT_FOUND"


class PracticeHistoryInvalid(PracticeHistoryError):
    code = "HISTORY_INVALID"


def _finite_number(value, name):
    if isinstance(value, bool):
        raise PracticeHistoryInvalid(f"{name} must be finite")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise PracticeHistoryInvalid(f"{name} must be finite") from exc
    if not math.isfinite(number):
        raise PracticeHistoryInvalid(f"{name} must be finite")
    return number


def _timestamp(value, name):
    number = _finite_number(value, name)
    if number < 0:
        raise PracticeHistoryInvalid(f"{name} must be non-negative")
    return int(number)


class ReadOnlyHistoryReader:
    """Read chunk files without invoking HistoryStore migration/write paths."""

    def __init__(self, chunks_root=None):
        root = Path(__file__).resolve().parent
        self.chunks_root = Path(chunks_root) if chunks_root else root / "data" / "chunks"

    @staticmethod
    def _normalize(symbol, timeframe):
        symbol = str(symbol or "").upper()
        timeframe = str(timeframe or "").upper()
        if not _SYMBOL_RE.fullmatch(symbol):
            raise PracticeHistoryInvalid("symbol is invalid")
        if timeframe not in TIMEFRAME_SECONDS:
            raise PracticeHistoryInvalid("timeframe is unsupported")
        return symbol, timeframe

    def _directory(self, symbol, timeframe):
        symbol, timeframe = self._normalize(symbol, timeframe)
        return self.chunks_root / symbol / timeframe

    def _load_meta(self, symbol, timeframe):
        symbol, timeframe = self._normalize(symbol, timeframe)
        path = self._directory(symbol, timeframe) / "meta.json"
        if not path.is_file():
            raise PracticeHistoryNotFound(f"local history is missing for {symbol} {timeframe}")
        try:
            raw = path.read_bytes()
            meta = json.loads(raw.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise PracticeHistoryInvalid("history metadata is unreadable") from exc
        chunks = meta.get("chunks")
        if not isinstance(chunks, list) or not chunks:
            raise PracticeHistoryInvalid("history metadata has no chunks")
        normalized = []
        for item in chunks:
            if not isinstance(item, dict):
                raise PracticeHistoryInvalid("history chunk metadata is invalid")
            try:
                index = int(item["index"])
                first_time = int(item["firstTime"])
                last_time = int(item["lastTime"])
                count = int(item["count"])
            except (KeyError, TypeError, ValueError) as exc:
                raise PracticeHistoryInvalid("history chunk metadata is invalid") from exc
            if index < 0 or count < 1 or last_time < first_time:
                raise PracticeHistoryInvalid("history chunk metadata is invalid")
            normalized.append(
                {
                    "index": index,
                    "firstTime": first_time,
                    "lastTime": last_time,
                    "count": count,
                }
            )
        normalized.sort(key=lambda item: item["index"])
        return raw, meta, normalized

    def _read_chunk(self, symbol, timeframe, index):
        path = self._directory(symbol, timeframe) / f"chunk_{int(index):06d}.json"
        if not path.is_file():
            raise PracticeHistoryInvalid(f"history chunk {index} is missing")
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise PracticeHistoryInvalid(f"history chunk {index} is unreadable") from exc
        bars = payload.get("bars")
        if not isinstance(bars, list):
            raise PracticeHistoryInvalid(f"history chunk {index} has no bars")
        normalized = []
        for offset, bar in enumerate(bars):
            if not isinstance(bar, dict):
                raise PracticeHistoryInvalid(f"history bar {index}:{offset} is invalid")
            time_value = _timestamp(bar.get("time"), "bar.time")
            open_price = _finite_number(bar.get("open"), "bar.open")
            high = _finite_number(bar.get("high"), "bar.high")
            low = _finite_number(bar.get("low"), "bar.low")
            close = _finite_number(bar.get("close"), "bar.close")
            if high < max(open_price, close, low) or low > min(open_price, close, high):
                raise PracticeHistoryInvalid(f"history bar {index}:{offset} OHLC is invalid")
            normalized.append(
                {
                    "time": time_value,
                    "open": open_price,
                    "high": high,
                    "low": low,
                    "close": close,
                    "volume": _finite_number(bar.get("volume", bar.get("tick_volume", 0)), "bar.volume"),
                }
            )
        return normalized

    def provenance(self, symbol, timeframe):
        symbol, timeframe = self._normalize(symbol, timeframe)
        raw, meta, chunks = self._load_meta(symbol, timeframe)
        meta_digest = hashlib.sha256(raw).hexdigest()
        content = hashlib.sha256()
        content.update(raw)
        directory = self._directory(symbol, timeframe)
        for item in chunks:
            path = directory / f"chunk_{item['index']:06d}.json"
            if not path.is_file():
                raise PracticeHistoryInvalid(f"history chunk {item['index']} is missing")
            try:
                chunk_bytes = path.read_bytes()
            except OSError as exc:
                raise PracticeHistoryInvalid(f"history chunk {item['index']} is unreadable") from exc
            content.update(str(item["index"]).encode("ascii"))
            content.update(hashlib.sha256(chunk_bytes).digest())
        content_digest = content.hexdigest()
        return {
            "schema_version": "local-chunks-v1",
            "source_id": f"local-chunks-v1:{symbol}:{timeframe}:{content_digest[:24]}",
            "meta_sha256": meta_digest,
            "content_sha256": content_digest,
            "symbol": symbol,
            "timeframe": timeframe,
            "bars": int(meta.get("count") or 0),
            "first_time": int(meta.get("firstTime") or 0),
            "last_time": int(meta.get("lastTime") or 0),
        }

    def load_through(self, symbol, timeframe, cursor_time, before_bars=100):
        symbol, timeframe = self._normalize(symbol, timeframe)
        cursor = _timestamp(cursor_time, "cursor_time")
        timeframe_seconds = TIMEFRAME_SECONDS[timeframe]
        try:
            before_bars = int(before_bars)
        except (TypeError, ValueError) as exc:
            raise PracticeHistoryInvalid("before_bars must be an integer") from exc
        if before_bars < 1 or before_bars > 500:
            raise PracticeHistoryInvalid("before_bars must be between 1 and 500")

        _, _, chunks = self._load_meta(symbol, timeframe)
        selected = [item for item in chunks if item["firstTime"] + timeframe_seconds <= cursor]
        bars_by_time = {}
        for item in reversed(selected):
            for bar in self._read_chunk(symbol, timeframe, item["index"]):
                available_at = bar["time"] + timeframe_seconds
                if available_at <= cursor:
                    visible = dict(bar)
                    visible["available_at"] = available_at
                    bars_by_time[bar["time"]] = visible
            if len(bars_by_time) >= before_bars:
                break
        bars = [bars_by_time[key] for key in sorted(bars_by_time)]
        return bars[-before_bars:]

    def bar_at_or_before(self, symbol, timeframe, target_time):
        symbol, timeframe = self._normalize(symbol, timeframe)
        target = _timestamp(target_time, "target_time")
        _, _, chunks = self._load_meta(symbol, timeframe)
        selected = [item for item in chunks if item["firstTime"] <= target]
        best = None
        for item in reversed(selected):
            candidates = [
                bar for bar in self._read_chunk(symbol, timeframe, item["index"])
                if bar["time"] <= target
            ]
            if candidates:
                best = max(candidates, key=lambda bar: bar["time"])
                break
        return best

    def previous_bar_time(self, symbol, timeframe, cursor_time):
        cursor = _timestamp(cursor_time, "cursor_time")
        if cursor == 0:
            return None
        bars = self.load_through(symbol, timeframe, cursor - 1, before_bars=1)
        return bars[-1]["available_at"] if bars else None

    def next_bar_time(self, symbol, timeframe, cursor_time):
        symbol, timeframe = self._normalize(symbol, timeframe)
        cursor = _timestamp(cursor_time, "cursor_time")
        timeframe_seconds = TIMEFRAME_SECONDS[timeframe]
        _, _, chunks = self._load_meta(symbol, timeframe)
        for item in chunks:
            if item["lastTime"] + timeframe_seconds <= cursor:
                continue
            candidates = [
                bar["time"] + timeframe_seconds
                for bar in self._read_chunk(symbol, timeframe, item["index"])
                if bar["time"] + timeframe_seconds > cursor
            ]
            if candidates:
                return min(candidates)
        return None
