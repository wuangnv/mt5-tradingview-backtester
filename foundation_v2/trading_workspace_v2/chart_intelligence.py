"""Deterministic, closed-bar chart intelligence for the C1 research slice.

This module intentionally implements a small causal core rather than an
``AI-SMC`` indicator.  It consumes validated, UTC-timestamped OHLC bars and
emits immutable event records for fair-value gaps, confirmed swing points,
breaks of structure, and explicit session entry/exit boundaries.  Every event
has a source-bar set and a ``known_at`` timestamp; future bars can therefore
not change the prefix emitted at a replay cutoff.

``ChartBar.timestamp`` is the **close timestamp** of the bar in UTC epoch
seconds.  Callers that receive exchange/open timestamps must normalize them
before calling :func:`run_chart_intelligence`.

The detector is PREP_ONLY: it does not call a provider, broker, filesystem,
network, or execution route.  ``build_overlay_packets`` adapts the canonical
events to the existing :mod:`chart_overlay_contract` renderer boundary.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
import hashlib
import json
import math
from typing import Any, Iterable, Mapping, Sequence
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .chart_overlay_contract import (
    DETERMINISTIC_ENGINE,
    INDICATOR_SCHEMA,
    OVERLAY_SCHEMA,
    PACKET_SCHEMA,
    PREP_ONLY_MODE,
    ChartOverlayContractError,
    cache_key,
    definition_sha256,
    validate_indicator_spec,
    validate_overlay_packet,
)


RULE_VERSION = "smc-core.v1"
EVENT_SCHEMA = "chart-event-v1"


class ChartIntelligenceError(ValueError):
    """Raised when chart input or detector configuration is not safe to use."""


def _finite(value: Any, name: str, *, positive: bool = False, non_negative: bool = False) -> float:
    if isinstance(value, bool):
        raise ChartIntelligenceError(f"{name} must be finite")
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ChartIntelligenceError(f"{name} must be finite") from exc
    if not math.isfinite(result):
        raise ChartIntelligenceError(f"{name} must be finite")
    if positive and result <= 0:
        raise ChartIntelligenceError(f"{name} must be > 0")
    if non_negative and result < 0:
        raise ChartIntelligenceError(f"{name} must be >= 0")
    return result


def _strict_int(value: Any, name: str, *, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise ChartIntelligenceError(f"{name} must be an integer >= {minimum}")
    return value


def _text(value: Any, name: str, *, maximum: int = 128) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ChartIntelligenceError(f"{name} is required")
    result = value.strip()
    if len(result) > maximum:
        raise ChartIntelligenceError(f"{name} is too long")
    return result


def _canonical(value: Any) -> bytes:
    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError, RecursionError) as exc:
        raise ChartIntelligenceError("value must be finite JSON") from exc


def _event_id(*, instrument_id: str, timeframe_seconds: int, kind: str, anchor_timestamp: int, identity: Mapping[str, Any]) -> str:
    payload = {
        "rule_version": RULE_VERSION,
        "instrument_id": instrument_id,
        "timeframe_seconds": timeframe_seconds,
        "kind": kind,
        "anchor_timestamp": anchor_timestamp,
        "identity": dict(identity),
    }
    return hashlib.sha256(_canonical(payload)).hexdigest()


def _bar_id(timestamp: int) -> str:
    return f"bar:{timestamp}"


@dataclass(frozen=True, slots=True)
class ChartBar:
    """One normalized OHLC bar; ``timestamp`` is its UTC close time."""

    timestamp: int
    open: float
    high: float
    low: float
    close: float
    volume: float | None = None

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any], *, index: int = 0) -> "ChartBar":
        if not isinstance(value, Mapping):
            raise ChartIntelligenceError(f"bars[{index}] must be an object")
        allowed = {"timestamp", "open", "high", "low", "close", "volume"}
        unknown = set(value) - allowed
        if unknown:
            raise ChartIntelligenceError(f"bars[{index}] has unsupported fields: {sorted(unknown)}")
        timestamp = _strict_int(value.get("timestamp"), f"bars[{index}].timestamp", minimum=1)
        opening = _finite(value.get("open"), f"bars[{index}].open", positive=True)
        high = _finite(value.get("high"), f"bars[{index}].high", positive=True)
        low = _finite(value.get("low"), f"bars[{index}].low", positive=True)
        close = _finite(value.get("close"), f"bars[{index}].close", positive=True)
        if high < max(opening, close) or low > min(opening, close) or low > high:
            raise ChartIntelligenceError(f"bars[{index}] has invalid OHLC bounds")
        volume = None if value.get("volume") is None else _finite(value["volume"], f"bars[{index}].volume", non_negative=True)
        return cls(timestamp, opening, high, low, close, volume)


@dataclass(frozen=True, slots=True)
class SessionSpec:
    name: str
    timezone: str
    start: str
    end: str

    def __post_init__(self) -> None:
        name = _text(self.name, "session.name", maximum=64)
        zone = _text(self.timezone, "session.timezone", maximum=128)
        try:
            ZoneInfo(zone)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ChartIntelligenceError("session.timezone must be an IANA timezone") from exc
        for field, text in (("start", self.start), ("end", self.end)):
            if not isinstance(text, str):
                raise ChartIntelligenceError(f"session.{field} must be HH:MM")
            try:
                datetime.strptime(text, "%H:%M")
            except ValueError as exc:
                raise ChartIntelligenceError(f"session.{field} must be HH:MM") from exc
        object.__setattr__(self, "name", name)
        object.__setattr__(self, "timezone", zone)
        object.__setattr__(self, "start", datetime.strptime(self.start, "%H:%M").strftime("%H:%M"))
        object.__setattr__(self, "end", datetime.strptime(self.end, "%H:%M").strftime("%H:%M"))

    @property
    def _start_time(self) -> time:
        return datetime.strptime(self.start, "%H:%M").time()

    @property
    def _end_time(self) -> time:
        return datetime.strptime(self.end, "%H:%M").time()

    def contains(self, local_dt: datetime) -> bool:
        current = local_dt.timetz().replace(tzinfo=None)
        if self._start_time <= self._end_time:
            return self._start_time <= current < self._end_time
        return current >= self._start_time or current < self._end_time

    def session_date(self, local_dt: datetime) -> date:
        if self._start_time > self._end_time and local_dt.timetz().replace(tzinfo=None) < self._end_time:
            return local_dt.date() - timedelta(days=1)
        return local_dt.date()


@dataclass(frozen=True, slots=True)
class ChartEngineConfig:
    instrument_id: str
    timeframe_seconds: int
    timezone: str = "UTC"
    swing_left: int = 2
    swing_right: int = 2
    fvg_min_gap: float = 0.0
    session: SessionSpec | None = None
    source: Mapping[str, Any] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        instrument = _text(self.instrument_id, "instrument_id", maximum=64).upper()
        timeframe = _strict_int(self.timeframe_seconds, "timeframe_seconds", minimum=1)
        zone = _text(self.timezone, "timezone", maximum=128)
        try:
            ZoneInfo(zone)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ChartIntelligenceError("timezone must be an IANA timezone") from exc
        left = _strict_int(self.swing_left, "swing_left", minimum=1)
        right = _strict_int(self.swing_right, "swing_right", minimum=1)
        gap = _finite(self.fvg_min_gap, "fvg_min_gap", non_negative=True)
        source = self.source if self.source is not None else {"kind": "synthetic", "id": "chart-c1"}
        if not isinstance(source, Mapping):
            raise ChartIntelligenceError("source must be an object")
        # The existing contract validates source identity and rejects unsupported fields.
        normalized_source = dict(source)
        if "kind" not in normalized_source or "id" not in normalized_source:
            raise ChartIntelligenceError("source requires kind and id")
        object.__setattr__(self, "instrument_id", instrument)
        object.__setattr__(self, "timeframe_seconds", timeframe)
        object.__setattr__(self, "timezone", zone)
        object.__setattr__(self, "swing_left", left)
        object.__setattr__(self, "swing_right", right)
        object.__setattr__(self, "fvg_min_gap", gap)
        object.__setattr__(self, "source", normalized_source)


@dataclass(frozen=True, slots=True)
class ChartEvent:
    """Canonical event emitted by the causal detector."""

    event_id: str
    kind: str
    direction: str
    instrument_id: str
    timeframe_seconds: int
    anchor_timestamp: int
    known_at: int
    source_bar_ids: tuple[str, ...]
    price_low: float
    price_high: float
    state: str
    confirmation_lag_bars: int
    parameters: Mapping[str, Any]
    identity: Mapping[str, Any]

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema": EVENT_SCHEMA,
            "event_id": self.event_id,
            "kind": self.kind,
            "direction": self.direction,
            "instrument_id": self.instrument_id,
            "timeframe_seconds": self.timeframe_seconds,
            "anchor_timestamp": self.anchor_timestamp,
            "known_at": self.known_at,
            "source_bar_ids": list(self.source_bar_ids),
            "price_low": self.price_low,
            "price_high": self.price_high,
            "state": self.state,
            "confirmation_lag_bars": self.confirmation_lag_bars,
            "rule_version": RULE_VERSION,
            "parameters": dict(self.parameters),
            "identity": dict(self.identity),
        }


def _normalize_bars(bars: Iterable[ChartBar | Mapping[str, Any]]) -> tuple[ChartBar, ...]:
    normalized: list[ChartBar] = []
    for index, raw in enumerate(bars):
        bar = raw if isinstance(raw, ChartBar) else ChartBar.from_mapping(raw, index=index)
        if normalized and bar.timestamp <= normalized[-1].timestamp:
            reason = "duplicate" if bar.timestamp == normalized[-1].timestamp else "out of order"
            raise ChartIntelligenceError(f"bars must be strictly increasing ({reason} timestamp)")
        normalized.append(bar)
    if not normalized:
        raise ChartIntelligenceError("bars must contain at least one bar")
    return tuple(normalized)


def _event(config: ChartEngineConfig, *, kind: str, direction: str, anchor_timestamp: int, known_at: int, source_bars: Sequence[ChartBar], price_low: float, price_high: float, confirmation_lag_bars: int, parameters: Mapping[str, Any], identity: Mapping[str, Any]) -> ChartEvent:
    if known_at < anchor_timestamp:
        # A confirmed event may be known after its anchor, never before it.
        raise ChartIntelligenceError("event known_at precedes anchor_timestamp")
    if not math.isfinite(price_low) or not math.isfinite(price_high) or price_low <= 0 or price_high < price_low:
        raise ChartIntelligenceError("event price range is invalid")
    source_ids = tuple(_bar_id(bar.timestamp) for bar in source_bars)
    event_id = _event_id(
        instrument_id=config.instrument_id,
        timeframe_seconds=config.timeframe_seconds,
        kind=kind,
        anchor_timestamp=anchor_timestamp,
        identity=identity,
    )
    return ChartEvent(
        event_id=event_id,
        kind=kind,
        direction=direction,
        instrument_id=config.instrument_id,
        timeframe_seconds=config.timeframe_seconds,
        anchor_timestamp=anchor_timestamp,
        known_at=known_at,
        source_bar_ids=source_ids,
        price_low=float(price_low),
        price_high=float(price_high),
        state="confirmed",
        confirmation_lag_bars=confirmation_lag_bars,
        parameters=dict(parameters),
        identity=dict(identity),
    )


def _detect_fvg(config: ChartEngineConfig, bars: tuple[ChartBar, ...], cutoff: int) -> list[ChartEvent]:
    events: list[ChartEvent] = []
    for index in range(2, len(bars)):
        current = bars[index]
        if current.timestamp > cutoff:
            break
        first = bars[index - 2]
        bullish_gap = current.low - first.high
        bearish_gap = first.low - current.high
        if bullish_gap >= config.fvg_min_gap and bullish_gap > 0:
            identity = {"direction": "bullish", "first": first.timestamp, "third": current.timestamp}
            events.append(_event(
                config,
                kind="FVG",
                direction="bullish",
                anchor_timestamp=current.timestamp,
                known_at=current.timestamp,
                source_bars=(first, bars[index - 1], current),
                price_low=first.high,
                price_high=current.low,
                confirmation_lag_bars=0,
                parameters={"min_gap": config.fvg_min_gap, "gap": bullish_gap},
                identity=identity,
            ))
        elif bearish_gap >= config.fvg_min_gap and bearish_gap > 0:
            identity = {"direction": "bearish", "first": first.timestamp, "third": current.timestamp}
            events.append(_event(
                config,
                kind="FVG",
                direction="bearish",
                anchor_timestamp=current.timestamp,
                known_at=current.timestamp,
                source_bars=(first, bars[index - 1], current),
                price_low=current.high,
                price_high=first.low,
                confirmation_lag_bars=0,
                parameters={"min_gap": config.fvg_min_gap, "gap": bearish_gap},
                identity=identity,
            ))
    return events


def _is_swing_high(bars: tuple[ChartBar, ...], index: int, left: int, right: int) -> bool:
    pivot = bars[index].high
    return all(pivot > bars[item].high for item in range(index - left, index)) and all(pivot >= bars[item].high for item in range(index + 1, index + right + 1))


def _is_swing_low(bars: tuple[ChartBar, ...], index: int, left: int, right: int) -> bool:
    pivot = bars[index].low
    return all(pivot < bars[item].low for item in range(index - left, index)) and all(pivot <= bars[item].low for item in range(index + 1, index + right + 1))


def _detect_structure(config: ChartEngineConfig, bars: tuple[ChartBar, ...], cutoff: int) -> list[ChartEvent]:
    events: list[ChartEvent] = []
    confirmed_high: tuple[int, ChartBar] | None = None
    confirmed_low: tuple[int, ChartBar] | None = None
    broken_high_id: str | None = None
    broken_low_id: str | None = None
    for current_index, current in enumerate(bars):
        if current.timestamp > cutoff:
            break
        pivot_index = current_index - config.swing_right
        if pivot_index >= config.swing_left:
            pivot = bars[pivot_index]
            window_end = pivot_index + config.swing_right
            if window_end < len(bars):
                if _is_swing_high(bars, pivot_index, config.swing_left, config.swing_right):
                    identity = {"pivot": pivot.timestamp, "swing": "high", "left": config.swing_left, "right": config.swing_right}
                    swing = _event(
                        config,
                        kind="SWING",
                        direction="bearish",
                        anchor_timestamp=pivot.timestamp,
                        known_at=current.timestamp,
                        source_bars=bars[pivot_index - config.swing_left : window_end + 1],
                        price_low=pivot.high,
                        price_high=pivot.high,
                        confirmation_lag_bars=config.swing_right,
                        parameters={"swing": "high", "left": config.swing_left, "right": config.swing_right},
                        identity=identity,
                    )
                    events.append(swing)
                    confirmed_high = (pivot_index, pivot)
                    broken_high_id = None
                if _is_swing_low(bars, pivot_index, config.swing_left, config.swing_right):
                    identity = {"pivot": pivot.timestamp, "swing": "low", "left": config.swing_left, "right": config.swing_right}
                    swing = _event(
                        config,
                        kind="SWING",
                        direction="bullish",
                        anchor_timestamp=pivot.timestamp,
                        known_at=current.timestamp,
                        source_bars=bars[pivot_index - config.swing_left : window_end + 1],
                        price_low=pivot.low,
                        price_high=pivot.low,
                        confirmation_lag_bars=config.swing_right,
                        parameters={"swing": "low", "left": config.swing_left, "right": config.swing_right},
                        identity=identity,
                    )
                    events.append(swing)
                    confirmed_low = (pivot_index, pivot)
                    broken_low_id = None
        # Use only swings confirmed on an earlier/current closed bar.  No
        # future pivot is consulted, so the same prefix is stable in replay.
        if confirmed_high is not None:
            pivot_index, pivot = confirmed_high
            swing_id = _bar_id(pivot.timestamp)
            if current.close > pivot.high and broken_high_id != swing_id:
                events.append(_event(
                    config,
                    kind="BOS",
                    direction="bullish",
                    anchor_timestamp=current.timestamp,
                    known_at=current.timestamp,
                    source_bars=(pivot, current),
                    price_low=pivot.high,
                    price_high=current.close,
                    confirmation_lag_bars=0,
                    parameters={"protected_swing": "high", "close_break": True},
                    identity={"protected": pivot.timestamp, "break": current.timestamp, "direction": "bullish"},
                ))
                broken_high_id = swing_id
        if confirmed_low is not None:
            pivot_index, pivot = confirmed_low
            swing_id = _bar_id(pivot.timestamp)
            if current.close < pivot.low and broken_low_id != swing_id:
                events.append(_event(
                    config,
                    kind="BOS",
                    direction="bearish",
                    anchor_timestamp=current.timestamp,
                    known_at=current.timestamp,
                    source_bars=(pivot, current),
                    price_low=current.close,
                    price_high=pivot.low,
                    confirmation_lag_bars=0,
                    parameters={"protected_swing": "low", "close_break": True},
                    identity={"protected": pivot.timestamp, "break": current.timestamp, "direction": "bearish"},
                ))
                broken_low_id = swing_id
    return events


def _detect_session(config: ChartEngineConfig, bars: tuple[ChartBar, ...], cutoff: int) -> list[ChartEvent]:
    if config.session is None:
        return []
    session = config.session
    zone = ZoneInfo(session.timezone)
    events: list[ChartEvent] = []
    previous_inside = False
    previous: ChartBar | None = None
    for current in bars:
        if current.timestamp > cutoff:
            break
        current_dt = datetime.fromtimestamp(current.timestamp, UTC).astimezone(zone)
        inside = session.contains(current_dt)
        session_date = session.session_date(current_dt).isoformat()
        if inside and not previous_inside:
            events.append(_event(
                config,
                kind="SESSION",
                direction="neutral",
                anchor_timestamp=current.timestamp,
                known_at=current.timestamp,
                source_bars=(current,),
                price_low=current.low,
                price_high=current.high,
                confirmation_lag_bars=0,
                parameters={"boundary": "start", "session": session.name, "session_date": session_date, "timezone": session.timezone, "start": session.start, "end": session.end},
                identity={"session": session.name, "date": session_date, "boundary": "start"},
            ))
        elif not inside and previous_inside and previous is not None:
            previous_dt = datetime.fromtimestamp(previous.timestamp, UTC).astimezone(zone)
            previous_date = session.session_date(previous_dt).isoformat()
            events.append(_event(
                config,
                kind="SESSION",
                direction="neutral",
                anchor_timestamp=previous.timestamp,
                known_at=current.timestamp,
                source_bars=(previous, current),
                price_low=previous.low,
                price_high=previous.high,
                confirmation_lag_bars=1,
                parameters={"boundary": "end", "session": session.name, "session_date": previous_date, "timezone": session.timezone, "start": session.start, "end": session.end},
                identity={"session": session.name, "date": previous_date, "boundary": "end"},
            ))
        previous_inside = inside
        previous = current
    return events


def run_chart_intelligence(
    bars: Iterable[ChartBar | Mapping[str, Any]],
    config: ChartEngineConfig,
    *,
    cutoff_timestamp: int | None = None,
) -> tuple[ChartEvent, ...]:
    """Run the C1 detectors through a replay cutoff on closed bars only.

    ``cutoff_timestamp`` is inclusive.  A future bar is never read to emit an
    event whose ``known_at`` is at or before the cutoff.  Prefix callers can
    therefore compare ``run(prefix)`` with ``run(full, cutoff=prefix[-1])``.
    """

    normalized = _normalize_bars(bars)
    cutoff = normalized[-1].timestamp if cutoff_timestamp is None else _strict_int(cutoff_timestamp, "cutoff_timestamp", minimum=1)
    if cutoff < normalized[0].timestamp:
        raise ChartIntelligenceError("cutoff_timestamp precedes first bar")
    # A future cutoff is harmless and means the full normalized input.
    events = _detect_fvg(config, normalized, cutoff)
    events.extend(_detect_structure(config, normalized, cutoff))
    events.extend(_detect_session(config, normalized, cutoff))
    events.sort(key=lambda item: (item.known_at, item.kind, item.event_id))
    ids = [item.event_id for item in events]
    if len(ids) != len(set(ids)):
        raise ChartIntelligenceError("detector emitted duplicate event IDs")
    return tuple(events)


def _indicator(config: ChartEngineConfig, indicator_id: str, family: str, *, parameters: Mapping[str, Any], session: SessionSpec | None = None) -> dict[str, Any]:
    spec: dict[str, Any] = {
        "schema": INDICATOR_SCHEMA,
        "mode": PREP_ONLY_MODE,
        "engine": DETERMINISTIC_ENGINE,
        "family": family,
        "indicator_id": indicator_id,
        "version": RULE_VERSION,
        "timezone": config.timezone,
        "display_timeframe_seconds": config.timeframe_seconds,
        "source_timeframe_seconds": config.timeframe_seconds,
        "mtf_policy": "same_timeframe",
        "lookahead": "closed_only",
        "causal_delay_bars": config.swing_right if indicator_id == "swing_points" else 0,
        "repaint": {"flag": False, "state": "confirmed", "confirmation_bars": 0},
        "parameters": dict(parameters),
    }
    if session is not None:
        spec["session"] = {"name": session.name, "timezone": session.timezone, "start": session.start, "end": session.end}
    return validate_indicator_spec(spec)


def build_overlay_packets(config: ChartEngineConfig, events: Sequence[ChartEvent], *, cutoff_timestamp: int | None = None) -> dict[str, dict[str, Any]]:
    """Adapt canonical events to validated renderer packets by indicator family."""

    if not events:
        raise ChartIntelligenceError("events must contain at least one event")
    cutoff = max(event.known_at for event in events) if cutoff_timestamp is None else _strict_int(cutoff_timestamp, "cutoff_timestamp", minimum=1)
    if any(event.known_at > cutoff for event in events):
        raise ChartIntelligenceError("events exceed overlay cutoff")
    groups: dict[str, tuple[str, str, SessionSpec | None]] = {
        "fvg": ("fvg", "ict", None),
        "structure": ("market_structure", "smc", None),
        "session": ("session_range", "ict", config.session),
    }
    packets: dict[str, dict[str, Any]] = {}
    for group, (indicator_id, family, session) in groups.items():
        selected = [event for event in events if (group == "fvg" and event.kind == "FVG") or (group == "structure" and event.kind in {"SWING", "BOS"}) or (group == "session" and event.kind == "SESSION")]
        if not selected:
            continue
        indicator = _indicator(
            config,
            indicator_id,
            family,
            parameters={"rule_version": RULE_VERSION, "swing_left": config.swing_left, "swing_right": config.swing_right, "fvg_min_gap": config.fvg_min_gap},
            session=session,
        )
        indicator_hash = definition_sha256(indicator)
        overlays: list[dict[str, Any]] = []
        for event in selected:
            if event.kind == "FVG":
                first_timestamp = int(event.identity["first"])
                anchors = [
                    {"timestamp": first_timestamp, "price": event.price_high},
                    {"timestamp": event.anchor_timestamp, "price": event.price_low},
                ]
                kind = "zone"
            else:
                anchors = [{"timestamp": event.anchor_timestamp, "price": event.price_high if event.kind == "BOS" else event.price_low}]
                kind = "marker"
            normalized_source = dict(config.source)
            overlay = {
                "schema": OVERLAY_SCHEMA,
                "mode": PREP_ONLY_MODE,
                "overlay_id": event.event_id,
                "kind": kind,
                "instrument_id": config.instrument_id,
                "display_timeframe_seconds": config.timeframe_seconds,
                "cutoff_timestamp": cutoff,
                "source": normalized_source,
                "anchors": anchors,
                "confidence": {"state": "known", "value": 1.0},
                "repaint": {"flag": False, "state": "confirmed", "confirmation_bars": 0},
                "status": "committed",
                "revision": 1,
                "indicator_sha256": indicator_hash,
                "cache_key": cache_key(indicator=indicator, source=normalized_source, instrument_id=config.instrument_id, display_timeframe_seconds=config.timeframe_seconds, cutoff_timestamp=cutoff),
                "label": f"{event.kind} {event.direction} | known_at={event.known_at} | lag={event.confirmation_lag_bars}",
            }
            overlays.append(overlay)
        payload = {
            "schema": PACKET_SCHEMA,
            "mode": PREP_ONLY_MODE,
            "engine": DETERMINISTIC_ENGINE,
            "indicator": indicator,
            "indicator_sha256": indicator_hash,
            "source": normalized_source,
            "cutoff_timestamp": cutoff,
            "overlays": overlays,
        }
        try:
            packets[group] = validate_overlay_packet(payload)
        except ChartOverlayContractError as exc:
            raise ChartIntelligenceError(f"overlay packet validation failed for {group}") from exc
    return packets


__all__ = [
    "ChartBar",
    "ChartEngineConfig",
    "ChartEvent",
    "ChartIntelligenceError",
    "EVENT_SCHEMA",
    "RULE_VERSION",
    "SessionSpec",
    "build_overlay_packets",
    "run_chart_intelligence",
]
