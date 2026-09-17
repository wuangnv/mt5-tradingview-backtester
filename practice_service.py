"""P3 orchestration: evidence trade -> safe replay context -> journal snapshot."""

import math
from datetime import datetime, timezone

from practice_history import TIMEFRAME_SECONDS


class PracticeError(RuntimeError):
    code = "PRACTICE_FAILURE"


class PracticeValidationError(PracticeError):
    code = "PRACTICE_INVALID"


class PracticeMappingError(PracticeError):
    code = "PRACTICE_MAPPING_ERROR"


def _iso_ms(value, name):
    if not isinstance(value, str) or not value:
        raise PracticeMappingError(f"{name} is missing")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise PracticeMappingError(f"{name} is invalid") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp() * 1000)


def _integer(value, name):
    if isinstance(value, bool):
        raise PracticeValidationError(f"{name} must be an integer")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise PracticeValidationError(f"{name} must be an integer") from exc
    if not math.isfinite(number) or not number.is_integer():
        raise PracticeValidationError(f"{name} must be an integer")
    return int(number)


class PracticeService:
    def __init__(self, evidence_store, history_reader, journal_store):
        self.evidence_store = evidence_store
        self.history_reader = history_reader
        self.journal_store = journal_store

    def _source(self, run_id, trade_id):
        run = self.evidence_store.get_run(run_id)
        trade = self.evidence_store.get_trade(run_id, trade_id)
        data = run.get("data") or {}
        symbol = str(data.get("symbol") or "").upper()
        timeframe = str(data.get("timeframe") or "").upper()
        if trade.get("symbol") != symbol:
            raise PracticeMappingError("trade symbol does not match its evidence run")
        if timeframe not in TIMEFRAME_SECONDS:
            raise PracticeMappingError("evidence timeframe is unsupported")
        open_ms = _iso_ms(trade.get("open_time_utc"), "open_time_utc")
        close_ms = _iso_ms(trade.get("close_time_utc"), "close_time_utc")
        if close_ms < open_ms:
            raise PracticeMappingError("trade close time precedes open time")
        return run, trade, symbol, timeframe, open_ms, close_ms

    def _map_bar_label(self, symbol, timeframe, label_ms, name):
        bar = self.history_reader.bar_at_or_before(symbol, timeframe, label_ms // 1000)
        if bar is None:
            raise PracticeMappingError(f"{name} cannot be mapped to local history")
        delta = (label_ms // 1000) - int(bar["time"])
        timeframe_seconds = TIMEFRAME_SECONDS[timeframe]
        if delta < 0 or delta >= timeframe_seconds:
            raise PracticeMappingError(f"{name} is outside the expected timeframe window")
        available_ms = (int(bar["time"]) + timeframe_seconds) * 1000
        return bar, delta, available_ms

    def _replay_cursor(self, symbol, timeframe, value, name):
        cursor_ms = _integer(value, name)
        if cursor_ms < 0:
            raise PracticeValidationError(f"{name} must be non-negative")
        bars = self.history_reader.load_through(
            symbol, timeframe, cursor_ms // 1000, before_bars=1
        )
        if not bars or int(bars[-1]["available_at"]) * 1000 != cursor_ms:
            raise PracticeValidationError(f"{name} must match a closed replay bar")
        return cursor_ms

    @staticmethod
    def _journal_view(entry, close_revealed):
        if entry is None:
            return None
        view = {
            **entry,
            "source": dict(entry["source"]),
            "fill": dict(entry["fill"]),
            "review": dict(entry["review"]),
        }
        if not close_revealed:
            view["fill"]["close_time_ms"] = None
            view["fill"]["exit"] = None
        return view

    def trade_context(self, run_id, trade_id, *, cursor_ms=None, before_bars=100):
        run, trade, symbol, timeframe, open_ms, close_ms = self._source(run_id, trade_id)
        open_bar, open_delta, open_available_ms = self._map_bar_label(
            symbol, timeframe, open_ms, "trade open time"
        )
        _, _, close_available_ms = self._map_bar_label(
            symbol, timeframe, close_ms, "trade close time"
        )
        cursor_ms = open_available_ms if cursor_ms is None else _integer(cursor_ms, "cursor_ms")
        if cursor_ms < 0:
            raise PracticeValidationError("cursor_ms must be non-negative")
        before_bars = _integer(before_bars, "before_bars")
        if before_bars < 20 or before_bars > 240:
            raise PracticeValidationError("before_bars must be between 20 and 240")
        cursor_s = cursor_ms // 1000

        bars = self.history_reader.load_through(symbol, timeframe, cursor_s, before_bars=before_bars)
        if not bars:
            raise PracticeMappingError("no local history exists at the replay cursor")

        close_revealed = cursor_ms >= close_available_ms
        trade_view = {
            "trade_id": str(trade["trade_id"]),
            "symbol": symbol,
            "timeframe": timeframe,
            "side": trade["side"],
            "quantity": trade["quantity"],
            "open_time_utc": trade["open_time_utc"],
            "price_open": trade["price_open"],
            "close_time_utc": trade["close_time_utc"] if close_revealed else None,
            "price_close": trade["price_close"] if close_revealed else None,
            "net_pnl": trade["net_pnl"] if close_revealed else None,
            "legacy_result": trade["legacy_result"] if close_revealed else None,
            "outcome_revealed": close_revealed,
        }
        provenance = self.history_reader.provenance(symbol, timeframe)
        previous_time = self.history_reader.previous_bar_time(symbol, timeframe, cursor_s)
        next_time = self.history_reader.next_bar_time(symbol, timeframe, cursor_s)
        journal = self.journal_store.get_by_source("replay", run_id, trade_id)
        return {
            "practice_schema_version": "practice-context-v1",
            "source": {
                "source_kind": "replay",
                "evidence_run_id": str(run_id),
                "trade_id": str(trade_id),
                "evidence_schema_version": run.get("artifact_schema_version"),
            },
            "history": provenance,
            "mapping": {
                "open_bar_time_ms": int(open_bar["time"]) * 1000,
                "open_bar_available_ms": open_available_ms,
                "close_bar_available_ms": close_available_ms,
                "open_alignment_delta_seconds": open_delta,
            },
            "replay": {
                "cursor_ms": cursor_ms,
                "previous_cursor_ms": previous_time * 1000 if previous_time is not None else None,
                "next_cursor_ms": next_time * 1000 if next_time is not None else None,
                "close_revealed": close_revealed,
            },
            "trade": trade_view,
            "bars": bars,
            "journal": self._journal_view(journal, close_revealed),
        }

    def create_journal(self, run_id, trade_id, payload):
        if not isinstance(payload, dict):
            raise PracticeValidationError("journal payload must be an object")
        run, trade, symbol, timeframe, open_ms, close_ms = self._source(run_id, trade_id)
        _, _, open_available_ms = self._map_bar_label(symbol, timeframe, open_ms, "trade open time")
        _, _, close_available_ms = self._map_bar_label(symbol, timeframe, close_ms, "trade close time")
        decision_time_ms = self._replay_cursor(
            symbol,
            timeframe,
            payload.get("cursor_ms", payload.get("decision_time_ms", open_available_ms)),
            "decision_time_ms",
        )
        if decision_time_ms < open_available_ms:
            raise PracticeValidationError("decision_time_ms cannot be before the replay entry cursor")
        if decision_time_ms > close_available_ms:
            raise PracticeValidationError("decision_time_ms cannot be after the recorded trade close")
        provenance = self.history_reader.provenance(symbol, timeframe)
        source = {
            "source_kind": "replay",
            "evidence_run_id": str(run_id),
            "trade_id": str(trade_id),
            "symbol": symbol,
            "timeframe": timeframe,
            "evidence_schema_version": str(run.get("artifact_schema_version") or "unknown"),
            "data_source_id": provenance["source_id"],
            "data_meta_sha256": provenance["meta_sha256"],
            "decision_time_ms": decision_time_ms,
            "fill_open_time_ms": open_ms,
            "fill_close_time_ms": close_ms,
            "fill_side": trade["side"],
            "fill_quantity": trade["quantity"],
            "fill_entry": trade["price_open"],
            "fill_exit": trade["price_close"],
        }
        entry = self.journal_store.create(source, payload)
        return self._journal_view(entry, decision_time_ms >= close_available_ms)

    def update_journal(self, entry_id, payload):
        if not isinstance(payload, dict):
            raise PracticeValidationError("journal payload must be an object")
        current = self.journal_store.get(entry_id)
        source = current["source"]
        if source.get("source_kind") != "replay":
            raise PracticeValidationError("journal source is not a replay trade")
        _, _, symbol, timeframe, open_ms, close_ms = self._source(
            source["evidence_run_id"], source["trade_id"]
        )
        _, _, open_available_ms = self._map_bar_label(
            symbol, timeframe, open_ms, "trade open time"
        )
        _, _, close_available_ms = self._map_bar_label(
            symbol, timeframe, close_ms, "trade close time"
        )
        cursor_ms = self._replay_cursor(
            symbol,
            timeframe,
            payload.get("cursor_ms", source["decision_time_ms"]),
            "cursor_ms",
        )
        if cursor_ms < open_available_ms:
            raise PracticeValidationError("cursor_ms cannot be before the replay entry cursor")
        entry = self.journal_store.update(entry_id, payload)
        return self._journal_view(entry, cursor_ms >= close_available_ms)
