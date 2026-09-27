"""Offline MQL5/Pine time-series parity primitives.

The MT5 gateway exposes ``MqlRates.time`` as a bar-open timestamp and may
return the currently forming bar.  The canonical chart engine consumes
strictly increasing UTC *bar-close* timestamps instead.  This module keeps
that boundary explicit and deterministic without importing MetaTrader,
opening a provider connection, or granting execution capability.

The functions deliberately model the two MQL details that are easy to lose
when an adapter is written from memory:

* ``CopyRates`` output is normalized to oldest-first order before any
  canonical processing; and
* ``iBarShift(..., exact=true)`` returns ``-1`` for an absent bar rather than
  silently filling a gap with the nearest bar.

No function in this module infers a broker timezone.  A non-UTC server clock
must be declared explicitly and ambiguous/nonexistent DST wall-clock values
fail closed.
"""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass
from datetime import UTC, datetime
import math
from typing import Any, Iterable, Mapping
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .chart_intelligence import ChartBar, ChartIntelligenceError, MTFBarMapping


MQL_PARITY_SCHEMA = "mql-chart-parity-v1"
_ORDER_POLICIES = frozenset({"auto", "oldest_first", "newest_first"})
_PROVISIONAL_POLICIES = frozenset({"reject", "drop_last"})
_BOUNDARY_POLICIES = frozenset({"inclusive_closed_boundary", "pine_offset_first_next_bar"})


class MqlParityError(ChartIntelligenceError):
    """Raised when MQL time-series input cannot be normalized safely."""


def _strict_int(value: Any, name: str, *, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise MqlParityError(f"{name} must be an integer >= {minimum}")
    return value


def _finite_number(value: Any, name: str, *, positive: bool = False, non_negative: bool = False) -> float:
    if isinstance(value, bool):
        raise MqlParityError(f"{name} must be finite")
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise MqlParityError(f"{name} must be finite") from exc
    if not math.isfinite(result):
        raise MqlParityError(f"{name} must be finite")
    if positive and result <= 0:
        raise MqlParityError(f"{name} must be > 0")
    if non_negative and result < 0:
        raise MqlParityError(f"{name} must be >= 0")
    return result


def resolve_mql_timeframe(value: Any) -> int:
    """Resolve only the timeframe vocabulary supported by the gateway.

    The legacy gateway falls back unknown strings to ``PERIOD_CURRENT``.  A
    parity adapter must reject that ambiguity instead of turning a typo into
    an unrelated chart timeframe.
    """

    values = {
        "M1": 60,
        "M5": 300,
        "M15": 900,
        "M30": 1_800,
        "H1": 3_600,
        "H4": 14_400,
        "D1": 86_400,
        "W1": 604_800,
        "MN1": 2_592_000,
    }
    if type(value) is int:
        if value <= 0:
            raise MqlParityError("timeframe_seconds must be > 0")
        if value not in values.values():
            raise MqlParityError(f"unsupported MQL timeframe seconds: {value}")
        return value
    if not isinstance(value, str) or not value.strip():
        raise MqlParityError("timeframe must be a supported MQL timeframe")
    key = value.strip().upper()
    try:
        return values[key]
    except KeyError as exc:
        raise MqlParityError(f"unsupported MQL timeframe: {value!r}") from exc


def _wall_clock_to_utc(timestamp: int, timezone: str, dst_fold_policy: str) -> int:
    """Interpret an integer as a wall-clock epoch in ``timezone``.

    UTC input is already an absolute epoch and takes the direct path.  For a
    non-UTC source the integer is treated as the naive wall-clock value that
    the MQL server supplied.  This makes the required timezone conversion
    explicit and lets us reject DST gaps/folds instead of guessing.
    """

    if timezone == "UTC":
        return timestamp
    if not isinstance(timezone, str) or not timezone.strip():
        raise MqlParityError("source_timezone must be a non-empty IANA timezone")
    try:
        zone = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise MqlParityError("source_timezone must be an IANA timezone") from exc
    policy = dst_fold_policy.strip().lower() if isinstance(dst_fold_policy, str) else ""
    if policy not in {"reject", "first", "second"}:
        raise MqlParityError("dst_fold_policy must be one of: reject, first, second")
    try:
        wall = datetime.fromtimestamp(timestamp, UTC).replace(tzinfo=None)
    except (OverflowError, OSError, ValueError) as exc:
        raise MqlParityError("MQL bar-open timestamp is outside supported datetime range") from exc
    candidates = tuple(wall.replace(tzinfo=zone, fold=fold) for fold in (0, 1))
    valid = tuple(
        candidate
        for candidate in candidates
        if candidate.astimezone(UTC).astimezone(zone).replace(tzinfo=None) == wall
    )
    if not valid:
        raise MqlParityError("MQL bar-open timestamp falls in a nonexistent local time")
    if len(valid) > 1:
        if policy == "reject":
            raise MqlParityError("MQL bar-open timestamp falls in an ambiguous DST fold")
        selected_fold = 0 if policy == "first" else 1
        return int(candidates[selected_fold].astimezone(UTC).timestamp())
    return int(valid[0].astimezone(UTC).timestamp())


def normalize_mql_open_timestamp(
    value: Any,
    *,
    source_timezone: str = "UTC",
    dst_fold_policy: str = "reject",
) -> int:
    """Convert one MQL bar-open timestamp to a UTC epoch integer."""

    timestamp = _strict_int(value, "bar_open_timestamp", minimum=1)
    return _wall_clock_to_utc(timestamp, source_timezone, dst_fold_policy)


def _raw_order(rows: tuple[Mapping[str, Any], ...], order: str) -> tuple[tuple[Mapping[str, Any], ...], str]:
    if order not in _ORDER_POLICIES:
        raise MqlParityError("order must be one of: auto, oldest_first, newest_first")
    timestamps = tuple(
        _strict_int(row.get("time"), f"rates[{index}].time", minimum=1)
        for index, row in enumerate(rows)
    )
    if len(timestamps) <= 1:
        return rows, "oldest_first" if order == "auto" else order
    increasing = all(left < right for left, right in zip(timestamps, timestamps[1:]))
    decreasing = all(left > right for left, right in zip(timestamps, timestamps[1:]))
    if not increasing and not decreasing:
        raise MqlParityError("CopyRates timestamps must be strictly monotonic")
    detected = "oldest_first" if increasing else "newest_first"
    if order != "auto" and order != detected:
        raise MqlParityError(f"CopyRates order declared {order!r}, detected {detected!r}")
    return (rows if detected == "oldest_first" else tuple(reversed(rows))), detected


def _row_is_provisional(row: Mapping[str, Any], index: int) -> bool | None:
    state_values: list[bool] = []
    if "closed" in row:
        if type(row["closed"]) is not bool:
            raise MqlParityError(f"rates[{index}].closed must be boolean")
        state_values.append(not row["closed"])
    if "provisional" in row:
        if type(row["provisional"]) is not bool:
            raise MqlParityError(f"rates[{index}].provisional must be boolean")
        state_values.append(row["provisional"])
    if not state_values:
        return None
    if any(value != state_values[0] for value in state_values[1:]):
        raise MqlParityError(f"rates[{index}] has conflicting closed/provisional state")
    return state_values[0]


@dataclass(frozen=True, slots=True)
class MqlNormalization:
    """Immutable result and provenance of one offline MQL normalization."""

    bars: tuple[ChartBar, ...]
    source_open_timestamps: tuple[int, ...]
    detected_order: str
    timeframe_seconds: int
    source_timezone: str
    timestamp_policy: str
    provisional_policy: str
    dropped_provisional_rows: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema": MQL_PARITY_SCHEMA,
            "detected_order": self.detected_order,
            "timeframe_seconds": self.timeframe_seconds,
            "source_timezone": self.source_timezone,
            "timestamp_policy": self.timestamp_policy,
            "provisional_policy": self.provisional_policy,
            "dropped_provisional_rows": self.dropped_provisional_rows,
            "source_open_timestamps": list(self.source_open_timestamps),
            "bar_close_timestamps": [bar.timestamp for bar in self.bars],
            "execution_capability": False,
        }


def normalize_mql_rates(
    rows: Iterable[Mapping[str, Any]],
    *,
    timeframe_seconds: int | str,
    order: str = "auto",
    source_timezone: str = "UTC",
    dst_fold_policy: str = "reject",
    provisional_policy: str = "reject",
) -> MqlNormalization:
    """Normalize MQL ``MqlRates``-shaped rows to canonical closed bars.

    ``provisional_policy='reject'`` is the safe default.  With
    ``'drop_last'``, an explicitly provisional or state-less final row is
    dropped; any provisional row in the middle still fails closed.  The latter
    policy models ``CopyRates(..., start_pos=0)`` where the newest row is the
    only potentially forming bar.  It never mutates an OHLC value.
    """

    timeframe = resolve_mql_timeframe(timeframe_seconds)
    if provisional_policy not in _PROVISIONAL_POLICIES:
        raise MqlParityError("provisional_policy must be one of: reject, drop_last")
    raw = tuple(rows)
    if not raw:
        raise MqlParityError("rates must contain at least one row")
    if any(not isinstance(row, Mapping) for row in raw):
        raise MqlParityError("rates rows must be objects")
    normalized_rows, detected_order = _raw_order(raw, order)

    # A source row's `time` is the MQL bar-open timestamp.  Keep this separate
    # from the canonical close timestamp so iBarShift can be checked against
    # the exact source identity before conversion.
    parsed: list[tuple[Mapping[str, Any], int, bool | None]] = []
    for index, row in enumerate(normalized_rows):
        open_ts = normalize_mql_open_timestamp(
            row.get("time"), source_timezone=source_timezone, dst_fold_policy=dst_fold_policy
        )
        parsed.append((row, open_ts, _row_is_provisional(row, index)))

    kept: list[tuple[Mapping[str, Any], int]] = []
    dropped = 0
    for index, (row, open_ts, provisional) in enumerate(parsed):
        is_last = index == len(parsed) - 1
        if provisional is True or (provisional is None and is_last):
            if provisional_policy == "drop_last" and is_last:
                dropped += 1
                continue
            raise MqlParityError(
                f"rates[{index}] is provisional or state-less latest row; "
                "declare closed=true or use provisional_policy='drop_last'"
            )
        if provisional is False or provisional is None:
            kept.append((row, open_ts))

    bars: list[ChartBar] = []
    source_open_timestamps: list[int] = []
    previous_open: int | None = None
    for index, (row, open_ts) in enumerate(kept):
        if previous_open is not None and open_ts <= previous_open:
            raise MqlParityError("normalized MQL bar-open timestamps must be strictly increasing")
        previous_open = open_ts
        try:
            close_ts = open_ts + timeframe
        except OverflowError as exc:
            raise MqlParityError("bar-close timestamp overflow") from exc
        if close_ts <= open_ts:
            raise MqlParityError("bar-close timestamp must exceed bar-open timestamp")
        bars.append(
            ChartBar.from_mapping(
                {
                    "timestamp": close_ts,
                    "open": row.get("open"),
                    "high": row.get("high"),
                    "low": row.get("low"),
                    "close": row.get("close"),
                    "volume": (
                        row.get("volume")
                        if row.get("volume") is not None
                        else row.get("tick_volume", row.get("real_volume"))
                    ),
                },
                index=index,
            )
        )
        source_open_timestamps.append(open_ts)

    if not bars:
        raise MqlParityError("normalization produced no closed bars")
    return MqlNormalization(
        bars=tuple(bars),
        source_open_timestamps=tuple(source_open_timestamps),
        detected_order=detected_order,
        timeframe_seconds=timeframe,
        source_timezone=source_timezone,
        timestamp_policy="mql_bar_open_to_utc_bar_close",
        provisional_policy=provisional_policy,
        dropped_provisional_rows=dropped,
    )


def i_bar_shift(
    open_timestamps: Iterable[int],
    target_open_timestamp: int,
    *,
    exact: bool = True,
    source_order: str = "oldest_first",
    return_order: str = "series",
) -> int:
    """Return an MQL-compatible bar index for an offline timestamp corpus.

    ``source_order`` describes the physical input array.  ``return_order``
    defaults to MQL series indexing (newest bar is index zero).  Exact lookup
    returns ``-1`` for a gap; nearest lookup returns the latest bar at or
    before the target and also returns ``-1`` when the target predates history.
    """

    if type(exact) is not bool:
        raise MqlParityError("exact must be boolean")
    if source_order not in {"oldest_first", "newest_first"}:
        raise MqlParityError("source_order must be oldest_first or newest_first")
    if return_order not in {"oldest_first", "series"}:
        raise MqlParityError("return_order must be oldest_first or series")
    target = _strict_int(target_open_timestamp, "target_open_timestamp", minimum=1)
    timestamps = tuple(_strict_int(value, "open_timestamps item", minimum=1) for value in open_timestamps)
    if not timestamps:
        return -1
    if source_order == "newest_first":
        timestamps = tuple(reversed(timestamps))
    if any(left >= right for left, right in zip(timestamps, timestamps[1:])):
        raise MqlParityError("open_timestamps must be strictly monotonic")
    position = bisect_right(timestamps, target) - 1
    if exact and (position < 0 or timestamps[position] != target):
        return -1
    if position < 0:
        return -1
    return len(timestamps) - 1 - position if return_order == "series" else position


def map_htf_boundary(
    display_bars: Iterable[ChartBar | Mapping[str, Any]],
    source_bars: Iterable[ChartBar | Mapping[str, Any]],
    *,
    display_timeframe_seconds: int,
    source_timeframe_seconds: int,
    boundary_policy: str = "inclusive_closed_boundary",
    cutoff_timestamp: int | None = None,
) -> tuple[MTFBarMapping, ...]:
    """Map display bars under an explicit closed-HTF boundary policy.

    ``inclusive_closed_boundary`` is the canonical local policy: source close
    equal to display close is visible on that display bar.  Pine's common
    ``expression[1]`` + ``lookahead_on`` parity mode exposes the confirmed
    source value from the first display bar *after* the boundary, represented
    here by ``pine_offset_first_next_bar`` (strict ``source_close <
    display_close``).  Both modes are causal; the policy must be versioned so
    a parity comparison does not silently mix them.
    """

    if boundary_policy not in _BOUNDARY_POLICIES:
        raise MqlParityError(
            "boundary_policy must be one of: inclusive_closed_boundary, pine_offset_first_next_bar"
        )
    display_tf = _strict_int(display_timeframe_seconds, "display_timeframe_seconds", minimum=1)
    source_tf = _strict_int(source_timeframe_seconds, "source_timeframe_seconds", minimum=1)
    if source_tf <= display_tf:
        raise MqlParityError("source_timeframe_seconds must be greater than display_timeframe_seconds")

    def normalize(values: Iterable[ChartBar | Mapping[str, Any]], name: str) -> tuple[ChartBar, ...]:
        output: list[ChartBar] = []
        for index, value in enumerate(values):
            bar = value if isinstance(value, ChartBar) else ChartBar.from_mapping(value, index=index)
            if output and bar.timestamp <= output[-1].timestamp:
                raise MqlParityError(f"{name} must be strictly increasing")
            output.append(bar)
        if not output:
            raise MqlParityError(f"{name} must contain at least one bar")
        return tuple(output)

    displays = normalize(display_bars, "display_bars")
    sources = normalize(source_bars, "source_bars")
    cutoff = (
        displays[-1].timestamp
        if cutoff_timestamp is None
        else _strict_int(cutoff_timestamp, "cutoff_timestamp", minimum=1)
    )
    if cutoff < displays[0].timestamp:
        raise MqlParityError("cutoff_timestamp precedes first display bar")
    inclusive = boundary_policy == "inclusive_closed_boundary"
    result: list[MTFBarMapping] = []
    source_index = 0
    confirmed: ChartBar | None = None
    for display in displays:
        if display.timestamp > cutoff:
            break
        while source_index < len(sources):
            source = sources[source_index]
            eligible = source.timestamp <= display.timestamp if inclusive else source.timestamp < display.timestamp
            if not eligible:
                break
            confirmed = source
            source_index += 1
        result.append(
            MTFBarMapping(
                display_bar=display,
                source_bar=confirmed,
                display_timeframe_seconds=display_tf,
                source_timeframe_seconds=source_tf,
                policy="higher_closed" if inclusive else "pine_offset_first_next_bar",
            )
        )
    return tuple(result)


__all__ = [
    "MQL_PARITY_SCHEMA",
    "MqlNormalization",
    "MqlParityError",
    "i_bar_shift",
    "map_htf_boundary",
    "normalize_mql_open_timestamp",
    "normalize_mql_rates",
    "resolve_mql_timeframe",
]
