"""Deterministic, closed-bar chart intelligence for the C1/C2 research slice.

This module intentionally implements a small causal core rather than an
``AI-SMC`` indicator.  It consumes validated, UTC-timestamped OHLC bars and
emits immutable event records for fair-value gaps, confirmed swing points,
breaks of structure, change-of-character transitions, liquidity sweeps, and
explicit session entry/exit boundaries.  Every event has a source-bar set and
a ``known_at`` timestamp; future bars can therefore not change the prefix
emitted at a replay cutoff.

``ChartBar.timestamp`` is the **close timestamp** of the bar in UTC epoch
seconds.  Callers that receive exchange/open timestamps must normalize them
before calling :func:`run_chart_intelligence`.

The detector is PREP_ONLY: it does not call a provider, broker, filesystem,
network, or execution route.  ``build_overlay_packets`` adapts the canonical
events to the existing :mod:`chart_overlay_contract` renderer boundary.  The
small C2 MTF adapter below maps a lower-timeframe close to the latest already
closed higher-timeframe bar; it never exposes a future HTF close to a lower
bar.
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
_DST_FOLD_POLICIES = frozenset({"reject", "first", "second"})
_PIVOT_TIE_POLICIES = frozenset({"left_strict_right_inclusive"})


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
    dst_fold_policy: str = "reject"

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
        policy = _text(self.dst_fold_policy, "session.dst_fold_policy", maximum=16).lower()
        if policy not in _DST_FOLD_POLICIES:
            choices = ", ".join(sorted(_DST_FOLD_POLICIES))
            raise ChartIntelligenceError(f"session.dst_fold_policy must be one of: {choices}")
        object.__setattr__(self, "name", name)
        object.__setattr__(self, "timezone", zone)
        object.__setattr__(self, "start", datetime.strptime(self.start, "%H:%M").strftime("%H:%M"))
        object.__setattr__(self, "end", datetime.strptime(self.end, "%H:%M").strftime("%H:%M"))
        object.__setattr__(self, "dst_fold_policy", policy)

    @property
    def _start_time(self) -> time:
        return datetime.strptime(self.start, "%H:%M").time()

    @property
    def _end_time(self) -> time:
        return datetime.strptime(self.end, "%H:%M").time()

    @staticmethod
    def _is_ambiguous_local(local_dt: datetime) -> bool:
        """Return whether an aware local time has two valid UTC occurrences.

        ``datetime.astimezone`` sets ``fold`` for timestamps obtained from UTC,
        but checking both candidates here keeps the policy safe for callers
        that construct aware local datetimes themselves.  A nonexistent local
        time during a spring-forward gap is not considered a fold: neither
        candidate round-trips to the same wall-clock value.
        """

        zone = local_dt.tzinfo
        if zone is None:
            return False
        wall_clock = local_dt.replace(tzinfo=None)
        candidates = tuple(wall_clock.replace(tzinfo=zone, fold=fold) for fold in (0, 1))
        if candidates[0].utcoffset() == candidates[1].utcoffset():
            return False
        return all(
            candidate.astimezone(UTC).astimezone(zone).replace(tzinfo=None) == wall_clock
            for candidate in candidates
        )

    def contains(self, local_dt: datetime) -> bool:
        current = local_dt.timetz().replace(tzinfo=None)
        if self._start_time <= self._end_time:
            in_wall_clock = self._start_time <= current < self._end_time
        else:
            in_wall_clock = current >= self._start_time or current < self._end_time
        if not in_wall_clock:
            return False
        if not self._is_ambiguous_local(local_dt):
            return True
        if self.dst_fold_policy == "reject":
            raise ChartIntelligenceError(
                f"session {self.name!r} encountered an ambiguous DST fold at "
                f"{local_dt.isoformat()}; set session.dst_fold_policy to 'first' or 'second'"
            )
        # For an autumn fold, fold=0 is the first occurrence and fold=1 is
        # the second.  Unambiguous local times were returned above, so an
        # explicit policy cannot silently include the wrong occurrence.
        return local_dt.fold == (0 if self.dst_fold_policy == "first" else 1)

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
    # The explicit policy matches the current detector semantics: an equal
    # high/low on the left disqualifies the candidate, while an equal value on
    # the right leaves the earliest candidate as the pivot.  Keeping this in
    # the canonical config makes Pine/MQL tie behaviour a versioned contract.
    pivot_tie_policy: str = "left_strict_right_inclusive"

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
        tie_policy = _text(self.pivot_tie_policy, "pivot_tie_policy", maximum=64).lower()
        if tie_policy not in _PIVOT_TIE_POLICIES:
            choices = ", ".join(sorted(_PIVOT_TIE_POLICIES))
            raise ChartIntelligenceError(f"pivot_tie_policy must be one of: {choices}")
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
        object.__setattr__(self, "pivot_tie_policy", tie_policy)


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


@dataclass(frozen=True, slots=True)
class MTFBarMapping:
    """Causal mapping from one display bar to its latest confirmed HTF bar.

    ``ChartBar.timestamp`` is a close timestamp.  A source bar is therefore
    eligible exactly when ``source_bar.timestamp <= display_bar.timestamp``;
    equality is intentional because both bars are closed at that boundary.
    ``source_bar`` stays available to a caller that needs OHLC context while
    :meth:`as_dict` exposes only stable IDs/timestamps for JSON or overlays.
    A missing source bar is represented by ``None`` instead of carrying a
    provisional/future value.  The default ``higher_closed`` policy includes
    equality at a closed boundary.  ``pine_offset_first_next_bar`` is an
    explicit strict-boundary parity mode for Pine's common
    ``expression[1]`` + ``lookahead_on`` idiom.
    """

    display_bar: ChartBar
    source_bar: ChartBar | None
    display_timeframe_seconds: int
    source_timeframe_seconds: int
    policy: str = "higher_closed"

    def __post_init__(self) -> None:
        if not isinstance(self.display_bar, ChartBar):
            raise ChartIntelligenceError("display_bar must be a ChartBar")
        if self.source_bar is not None and not isinstance(self.source_bar, ChartBar):
            raise ChartIntelligenceError("source_bar must be a ChartBar or None")
        display_tf = _strict_int(self.display_timeframe_seconds, "display_timeframe_seconds", minimum=1)
        source_tf = _strict_int(self.source_timeframe_seconds, "source_timeframe_seconds", minimum=1)
        if source_tf <= display_tf:
            raise ChartIntelligenceError(
                "source_timeframe_seconds must be greater than display_timeframe_seconds for higher_closed mapping"
            )
        if self.policy not in {"higher_closed", "pine_offset_first_next_bar"}:
            raise ChartIntelligenceError(
                "MTF mapping policy must be higher_closed or pine_offset_first_next_bar"
            )
        if self.source_bar is not None:
            if self.source_bar.timestamp > self.display_bar.timestamp:
                raise ChartIntelligenceError("source_bar close must not exceed display_bar close")
            if self.policy == "pine_offset_first_next_bar" and self.source_bar.timestamp >= self.display_bar.timestamp:
                raise ChartIntelligenceError(
                    "pine_offset_first_next_bar requires source_bar close before display_bar close"
                )

    @property
    def display_timestamp(self) -> int:
        return self.display_bar.timestamp

    @property
    def source_bar_close_timestamp(self) -> int | None:
        return None if self.source_bar is None else self.source_bar.timestamp

    @property
    def source_bar_id(self) -> str | None:
        return None if self.source_bar is None else _bar_id(self.source_bar.timestamp)

    def as_dict(self) -> dict[str, Any]:
        """Return the bounded, causal mapping metadata."""

        return {
            "policy": self.policy,
            "display_bar_id": _bar_id(self.display_bar.timestamp),
            "display_timestamp": self.display_timestamp,
            "display_timeframe_seconds": self.display_timeframe_seconds,
            "source_timeframe_seconds": self.source_timeframe_seconds,
            "source_bar_id": self.source_bar_id,
            "source_bar_close_timestamp": self.source_bar_close_timestamp,
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


def map_last_confirmed_htf(
    display_bars: Iterable[ChartBar | Mapping[str, Any]],
    source_bars: Iterable[ChartBar | Mapping[str, Any]],
    *,
    display_timeframe_seconds: int,
    source_timeframe_seconds: int,
    cutoff_timestamp: int | None = None,
) -> tuple[MTFBarMapping, ...]:
    """Map each lower/display close to the last confirmed HTF close.

    Both inputs contain UTC close timestamps.  The source timeframe must be
    strictly higher than the display timeframe, matching the overlay
    contract's ``higher_closed`` policy.  The linear merge only advances the
    source cursor while its close is at or before the current display close,
    which makes the no-lookahead rule explicit and independent of source
    values.  Missing history before the first source close remains unknown
    (`source_bar is None`), and is never backfilled from a future bar.

    ``cutoff_timestamp`` is inclusive.  Display bars after it are not part of
    the returned mapping; a cutoff before the first display bar is rejected,
    consistent with :func:`run_chart_intelligence`.
    """

    display_tf = _strict_int(display_timeframe_seconds, "display_timeframe_seconds", minimum=1)
    source_tf = _strict_int(source_timeframe_seconds, "source_timeframe_seconds", minimum=1)
    if source_tf <= display_tf:
        raise ChartIntelligenceError(
            "source_timeframe_seconds must be greater than display_timeframe_seconds for higher_closed mapping"
        )

    normalized_display = _normalize_bars(display_bars)
    normalized_source = _normalize_bars(source_bars)
    cutoff = normalized_display[-1].timestamp if cutoff_timestamp is None else _strict_int(
        cutoff_timestamp, "cutoff_timestamp", minimum=1
    )
    if cutoff < normalized_display[0].timestamp:
        raise ChartIntelligenceError("cutoff_timestamp precedes first display bar")

    mappings: list[MTFBarMapping] = []
    source_index = 0
    confirmed: ChartBar | None = None
    for display_bar in normalized_display:
        if display_bar.timestamp > cutoff:
            break
        while source_index < len(normalized_source) and normalized_source[source_index].timestamp <= display_bar.timestamp:
            confirmed = normalized_source[source_index]
            source_index += 1
        mappings.append(
            MTFBarMapping(
                display_bar=display_bar,
                source_bar=confirmed,
                display_timeframe_seconds=display_tf,
                source_timeframe_seconds=source_tf,
            )
        )
    return tuple(mappings)


# Descriptive alias for callers that use the generic MTF terminology.  Keep a
# single implementation so both names carry exactly the same causal policy.
map_last_confirmed_mtf = map_last_confirmed_htf


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


def _is_swing_high(
    bars: tuple[ChartBar, ...], index: int, left: int, right: int, tie_policy: str
) -> bool:
    pivot = bars[index].high
    if tie_policy != "left_strict_right_inclusive":
        raise ChartIntelligenceError("unsupported pivot_tie_policy")
    return all(pivot > bars[item].high for item in range(index - left, index)) and all(pivot >= bars[item].high for item in range(index + 1, index + right + 1))


def _is_swing_low(
    bars: tuple[ChartBar, ...], index: int, left: int, right: int, tie_policy: str
) -> bool:
    pivot = bars[index].low
    if tie_policy != "left_strict_right_inclusive":
        raise ChartIntelligenceError("unsupported pivot_tie_policy")
    return all(pivot < bars[item].low for item in range(index - left, index)) and all(pivot <= bars[item].low for item in range(index + 1, index + right + 1))


def _detect_structure(config: ChartEngineConfig, bars: tuple[ChartBar, ...], cutoff: int) -> list[ChartEvent]:
    events: list[ChartEvent] = []
    confirmed_high: tuple[int, ChartBar] | None = None
    confirmed_low: tuple[int, ChartBar] | None = None
    broken_high_id: str | None = None
    broken_low_id: str | None = None
    swept_high_ids: set[int] = set()
    swept_low_ids: set[int] = set()
    structure_direction: str | None = None
    for current_index, current in enumerate(bars):
        if current.timestamp > cutoff:
            break
        pivot_index = current_index - config.swing_right
        if pivot_index >= config.swing_left:
            pivot = bars[pivot_index]
            window_end = pivot_index + config.swing_right
            if window_end < len(bars):
                if _is_swing_high(bars, pivot_index, config.swing_left, config.swing_right, config.pivot_tie_policy):
                    identity = {"pivot": pivot.timestamp, "swing": "high", "left": config.swing_left, "right": config.swing_right, "tie_policy": config.pivot_tie_policy}
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
                        parameters={"swing": "high", "left": config.swing_left, "right": config.swing_right, "tie_policy": config.pivot_tie_policy},
                        identity=identity,
                    )
                    events.append(swing)
                    confirmed_high = (pivot_index, pivot)
                    broken_high_id = None
                if _is_swing_low(bars, pivot_index, config.swing_left, config.swing_right, config.pivot_tie_policy):
                    identity = {"pivot": pivot.timestamp, "swing": "low", "left": config.swing_left, "right": config.swing_right, "tie_policy": config.pivot_tie_policy}
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
                        parameters={"swing": "low", "left": config.swing_left, "right": config.swing_right, "tie_policy": config.pivot_tie_policy},
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
            if (
                pivot.timestamp not in swept_high_ids
                and current.high > pivot.high
                and current.close < pivot.high
            ):
                events.append(_event(
                    config,
                    kind="LIQUIDITY_SWEEP",
                    direction="bearish",
                    anchor_timestamp=current.timestamp,
                    known_at=current.timestamp,
                    source_bars=(pivot, current),
                    price_low=pivot.high,
                    price_high=current.high,
                    confirmation_lag_bars=0,
                    parameters={
                        "pool": "swing_high",
                        "sweep_type": "high",
                        "liquidity_level": pivot.high,
                        "wick_extreme": current.high,
                        "close_reclaimed": True,
                    },
                    identity={
                        "pool": "swing_high",
                        "pivot": pivot.timestamp,
                        "sweep": current.timestamp,
                        "direction": "bearish",
                    },
                ))
                swept_high_ids.add(pivot.timestamp)
            if current.close > pivot.high and broken_high_id != swing_id:
                previous_direction = structure_direction
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
                if previous_direction == "bearish":
                    events.append(_event(
                        config,
                        kind="CHoCH",
                        direction="bullish",
                        anchor_timestamp=current.timestamp,
                        known_at=current.timestamp,
                        source_bars=(pivot, current),
                        price_low=pivot.high,
                        price_high=current.close,
                        confirmation_lag_bars=0,
                        parameters={
                            "protected_swing": "high",
                            "close_break": True,
                            "break_level": pivot.high,
                            "prior_structure": previous_direction,
                            "structure_change": "CHoCH",
                        },
                        identity={
                            "protected": pivot.timestamp,
                            "break": current.timestamp,
                            "direction": "bullish",
                            "prior_structure": previous_direction,
                        },
                    ))
                structure_direction = "bullish"
                broken_high_id = swing_id
        if confirmed_low is not None:
            pivot_index, pivot = confirmed_low
            swing_id = _bar_id(pivot.timestamp)
            if (
                pivot.timestamp not in swept_low_ids
                and current.low < pivot.low
                and current.close > pivot.low
            ):
                events.append(_event(
                    config,
                    kind="LIQUIDITY_SWEEP",
                    direction="bullish",
                    anchor_timestamp=current.timestamp,
                    known_at=current.timestamp,
                    source_bars=(pivot, current),
                    price_low=current.low,
                    price_high=pivot.low,
                    confirmation_lag_bars=0,
                    parameters={
                        "pool": "swing_low",
                        "sweep_type": "low",
                        "liquidity_level": pivot.low,
                        "wick_extreme": current.low,
                        "close_reclaimed": True,
                    },
                    identity={
                        "pool": "swing_low",
                        "pivot": pivot.timestamp,
                        "sweep": current.timestamp,
                        "direction": "bullish",
                    },
                ))
                swept_low_ids.add(pivot.timestamp)
            if current.close < pivot.low and broken_low_id != swing_id:
                previous_direction = structure_direction
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
                if previous_direction == "bullish":
                    events.append(_event(
                        config,
                        kind="CHoCH",
                        direction="bearish",
                        anchor_timestamp=current.timestamp,
                        known_at=current.timestamp,
                        source_bars=(pivot, current),
                        price_low=current.close,
                        price_high=pivot.low,
                        confirmation_lag_bars=0,
                        parameters={
                            "protected_swing": "low",
                            "close_break": True,
                            "break_level": pivot.low,
                            "prior_structure": previous_direction,
                            "structure_change": "CHoCH",
                        },
                        identity={
                            "protected": pivot.timestamp,
                            "break": current.timestamp,
                            "direction": "bearish",
                            "prior_structure": previous_direction,
                        },
                    ))
                structure_direction = "bearish"
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
                parameters={"boundary": "start", "session": session.name, "session_date": session_date, "timezone": session.timezone, "start": session.start, "end": session.end, "dst_fold_policy": session.dst_fold_policy},
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
                parameters={"boundary": "end", "session": session.name, "session_date": previous_date, "timezone": session.timezone, "start": session.start, "end": session.end, "dst_fold_policy": session.dst_fold_policy},
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


def _indicator(config: ChartEngineConfig, indicator_id: str, family: str, *, parameters: Mapping[str, Any], session: SessionSpec | None = None, causal_delay_bars: int | None = None) -> dict[str, Any]:
    delay = config.swing_right if indicator_id == "swing_points" else 0
    if causal_delay_bars is not None:
        delay = _strict_int(causal_delay_bars, "causal_delay_bars")
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
        "causal_delay_bars": delay,
        "repaint": {"flag": False, "state": "confirmed", "confirmation_bars": 0},
        "parameters": dict(parameters),
    }
    if session is not None:
        spec["session"] = {"name": session.name, "timezone": session.timezone, "start": session.start, "end": session.end}
        spec["parameters"]["dst_fold_policy"] = session.dst_fold_policy
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
        "liquidity": ("liquidity_sweep", "smc", None),
        # Swing confirmation has a right-bar delay; keep it in its own packet
        # so a zero-delay BOS/CHoCH packet cannot overclaim timing parity.
        "swing": ("swing_points", "smc", None),
        "session": ("session_range", "ict", config.session),
    }
    packets: dict[str, dict[str, Any]] = {}
    for group, (indicator_id, family, session) in groups.items():
        selected = [event for event in events if (group == "fvg" and event.kind == "FVG") or (group == "structure" and event.kind in {"BOS", "CHoCH"}) or (group == "liquidity" and event.kind == "LIQUIDITY_SWEEP") or (group == "swing" and event.kind == "SWING") or (group == "session" and event.kind == "SESSION")]
        if not selected:
            continue
        indicator = _indicator(
            config,
            indicator_id,
            family,
            parameters={"rule_version": RULE_VERSION, "swing_left": config.swing_left, "swing_right": config.swing_right, "fvg_min_gap": config.fvg_min_gap, "pivot_tie_policy": config.pivot_tie_policy},
            session=session,
            causal_delay_bars=max(event.confirmation_lag_bars for event in selected),
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
            elif event.kind == "LIQUIDITY_SWEEP":
                anchors = [{"timestamp": event.anchor_timestamp, "price": event.parameters["liquidity_level"]}]
                kind = "marker"
            else:
                if event.kind in {"BOS", "CHoCH"}:
                    price = event.price_low if event.direction == "bullish" else event.price_high
                else:
                    price = event.price_low
                anchors = [{"timestamp": event.anchor_timestamp, "price": price}]
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
                "known_at": event.known_at,
                "source_bar_ids": list(event.source_bar_ids),
                "confirmation_lag_bars": event.confirmation_lag_bars,
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
    "MTFBarMapping",
    "RULE_VERSION",
    "SessionSpec",
    "build_overlay_packets",
    "map_last_confirmed_htf",
    "map_last_confirmed_mtf",
    "run_chart_intelligence",
]
