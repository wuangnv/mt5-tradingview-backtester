from __future__ import annotations

from datetime import UTC, datetime

import pytest

from trading_workspace_v2.chart_intelligence import ChartBar
from trading_workspace_v2.mql_parity import (
    MqlParityError,
    i_bar_shift,
    map_htf_boundary,
    normalize_mql_open_timestamp,
    normalize_mql_rates,
    resolve_mql_timeframe,
)


def rate(open_time: int, *, close: float = 10.0, state: bool | None = True) -> dict:
    payload = {
        "time": open_time,
        "open": 10.0,
        "high": 11.0,
        "low": 9.0,
        "close": close,
        "volume": 100,
    }
    if state is not None:
        payload["closed"] = state
    return payload


def bar(timestamp: int, close: float = 10.0) -> ChartBar:
    return ChartBar(timestamp=timestamp, open=10.0, high=11.0, low=9.0, close=close)


def test_copyrates_order_is_normalized_and_mql_open_becomes_utc_close() -> None:
    result = normalize_mql_rates(
        [rate(1_700_000_060, close=10.8), rate(1_700_000_000, close=10.5)],
        timeframe_seconds="M1",
        order="auto",
    )

    assert result.detected_order == "newest_first"
    assert result.source_open_timestamps == (1_700_000_000, 1_700_000_060)
    assert [item.timestamp for item in result.bars] == [1_700_000_060, 1_700_000_120]
    assert [item.close for item in result.bars] == [10.5, 10.8]
    assert result.as_dict()["timestamp_policy"] == "mql_bar_open_to_utc_bar_close"
    assert result.as_dict()["execution_capability"] is False


def test_latest_state_less_copyrates_row_is_rejected_or_explicitly_dropped() -> None:
    rows = [rate(1_700_000_000), rate(1_700_000_060, state=None)]
    with pytest.raises(MqlParityError, match="provisional or state-less latest row"):
        normalize_mql_rates(rows, timeframe_seconds=60)

    result = normalize_mql_rates(rows, timeframe_seconds=60, provisional_policy="drop_last")
    assert result.dropped_provisional_rows == 1
    assert result.source_open_timestamps == (1_700_000_000,)
    assert result.bars[0].timestamp == 1_700_000_060


def test_provisional_middle_row_and_conflicting_state_fail_closed() -> None:
    with pytest.raises(MqlParityError, match="provisional or state-less latest row"):
        normalize_mql_rates(
            [rate(1_700_000_000), rate(1_700_000_060, state=False), rate(1_700_000_120)],
            timeframe_seconds=60,
            provisional_policy="drop_last",
        )
    conflict = rate(1_700_000_000)
    conflict["provisional"] = True
    with pytest.raises(MqlParityError, match="conflicting"):
        normalize_mql_rates([conflict], timeframe_seconds=60)


def test_copyrates_gaps_are_preserved_and_nonmonotonic_rows_are_rejected() -> None:
    result = normalize_mql_rates(
        [rate(1_700_000_120), rate(1_700_000_000)],
        timeframe_seconds=60,
        order="newest_first",
    )
    assert result.source_open_timestamps == (1_700_000_000, 1_700_000_120)

    with pytest.raises(MqlParityError, match="strictly monotonic"):
        normalize_mql_rates(
            [rate(1_700_000_000), rate(1_700_000_120), rate(1_700_000_060)],
            timeframe_seconds=60,
        )


def test_i_bar_shift_exact_gap_is_unknown_and_nearest_is_explicit() -> None:
    source = (100, 200, 400)
    assert i_bar_shift(source, 400) == 0  # MQL series order: newest first.
    assert i_bar_shift(source, 300, exact=True) == -1
    assert i_bar_shift(source, 300, exact=False) == 1
    assert i_bar_shift(source, 50, exact=False) == -1
    assert i_bar_shift(source, 500, exact=False) == 0
    assert i_bar_shift(tuple(reversed(source)), 200, source_order="newest_first") == 1
    assert i_bar_shift(source, 300, exact=False, return_order="oldest_first") == 1


def test_i_bar_shift_rejects_duplicates_and_invalid_order() -> None:
    with pytest.raises(MqlParityError, match="strictly monotonic"):
        i_bar_shift((100, 100), 100)
    with pytest.raises(MqlParityError, match="source_order"):
        i_bar_shift((100,), 100, source_order="auto")
    assert i_bar_shift((), 100) == -1


def test_unknown_mql_timeframe_is_rejected_instead_of_period_current_fallback() -> None:
    assert resolve_mql_timeframe("h1") == 3_600
    with pytest.raises(MqlParityError, match="unsupported MQL timeframe"):
        resolve_mql_timeframe("H2")
    with pytest.raises(MqlParityError, match="unsupported MQL timeframe"):
        normalize_mql_rates([rate(1_700_000_000)], timeframe_seconds="typo")


def test_non_utc_server_wall_clock_requires_explicit_dst_policy() -> None:
    ambiguous = int(datetime(2026, 10, 25, 2, 30, tzinfo=UTC).timestamp())
    with pytest.raises(MqlParityError, match="ambiguous DST fold"):
        normalize_mql_open_timestamp(ambiguous, source_timezone="Europe/Berlin")
    first = normalize_mql_open_timestamp(ambiguous, source_timezone="Europe/Berlin", dst_fold_policy="first")
    second = normalize_mql_open_timestamp(ambiguous, source_timezone="Europe/Berlin", dst_fold_policy="second")
    assert second - first == 3_600

    nonexistent = int(datetime(2026, 3, 29, 2, 30, tzinfo=UTC).timestamp())
    with pytest.raises(MqlParityError, match="nonexistent local time"):
        normalize_mql_open_timestamp(nonexistent, source_timezone="Europe/Berlin", dst_fold_policy="first")


def test_htf_boundary_policy_is_explicit_and_never_looks_ahead() -> None:
    displays = [bar(timestamp) for timestamp in (100, 200, 300, 400)]
    sources = [bar(timestamp, close=float(timestamp)) for timestamp in (200, 400)]
    inclusive = map_htf_boundary(
        displays,
        sources,
        display_timeframe_seconds=60,
        source_timeframe_seconds=300,
        boundary_policy="inclusive_closed_boundary",
    )
    pine = map_htf_boundary(
        displays,
        sources,
        display_timeframe_seconds=60,
        source_timeframe_seconds=300,
        boundary_policy="pine_offset_first_next_bar",
    )
    assert [item.source_bar_close_timestamp for item in inclusive] == [None, 200, 200, 400]
    assert [item.source_bar_close_timestamp for item in pine] == [None, None, 200, 200]
    assert [item.policy for item in inclusive] == ["higher_closed"] * 4
    assert [item.policy for item in pine] == ["pine_offset_first_next_bar"] * 4
    assert all(
        item.source_bar_close_timestamp is None
        or item.source_bar_close_timestamp < item.display_timestamp
        for item in pine
    )

    with pytest.raises(MqlParityError, match="boundary_policy"):
        map_htf_boundary(
            displays,
            sources,
            display_timeframe_seconds=60,
            source_timeframe_seconds=300,
            boundary_policy="nearest_fill",
        )


def test_htf_boundary_cutoff_keeps_prefix_and_unknown_history() -> None:
    displays = [bar(timestamp) for timestamp in (100, 200, 300, 400)]
    sources = [bar(timestamp) for timestamp in (200, 400)]
    prefix = map_htf_boundary(
        displays[:3],
        sources[:1],
        display_timeframe_seconds=60,
        source_timeframe_seconds=300,
        boundary_policy="pine_offset_first_next_bar",
    )
    full = map_htf_boundary(
        displays,
        sources,
        display_timeframe_seconds=60,
        source_timeframe_seconds=300,
        boundary_policy="pine_offset_first_next_bar",
        cutoff_timestamp=300,
    )
    assert [item.as_dict() for item in prefix] == [item.as_dict() for item in full]
