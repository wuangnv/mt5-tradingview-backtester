from __future__ import annotations

from datetime import UTC, datetime
import math

import pytest

from trading_workspace_v2.chart_intelligence import (
    ChartEngineConfig,
    ChartIntelligenceError,
    SessionSpec,
    map_last_confirmed_htf,
    run_chart_intelligence,
    build_overlay_packets,
)


def bar(timestamp: int, opening: float, high: float, low: float, close: float) -> dict:
    return {
        "timestamp": timestamp,
        "open": opening,
        "high": high,
        "low": low,
        "close": close,
    }


def structure_bars(start: int = 1_700_000_000) -> list[dict]:
    # A confirmed high at index 2, followed by a close through it at index 5.
    return [
        bar(start + 0, 9.0, 10.0, 8.0, 9.0),
        bar(start + 1, 10.0, 11.0, 9.0, 10.0),
        bar(start + 2, 14.0, 15.0, 10.0, 14.0),
        bar(start + 3, 11.0, 12.0, 9.0, 11.0),
        bar(start + 4, 12.0, 13.0, 10.0, 12.0),
        bar(start + 5, 15.0, 16.0, 12.0, 16.0),
    ]


def test_fvg_and_bos_are_closed_bar_events_with_stable_identity() -> None:
    start = 1_700_001_000
    bars = [
        bar(start + 0, 99.5, 100.0, 99.0, 99.5),
        bar(start + 1, 99.5, 100.0, 99.4, 99.8),
        bar(start + 2, 101.0, 102.0, 101.0, 101.5),
        *structure_bars(start + 10),
    ]
    config = ChartEngineConfig(
        instrument_id="eurusd",
        timeframe_seconds=60,
        fvg_min_gap=0.5,
        source={"kind": "synthetic", "id": "c1-fixture"},
    )
    events = run_chart_intelligence(bars, config)
    fvg = next(event for event in events if event.kind == "FVG")
    assert fvg.direction == "bullish"
    assert fvg.known_at == start + 2
    assert fvg.source_bar_ids == tuple(f"bar:{start + offset}" for offset in (0, 1, 2))
    assert fvg.as_dict()["identity"]["third"] == start + 2

    structure = run_chart_intelligence(structure_bars(), config)
    bos = next(event for event in structure if event.kind == "BOS")
    assert bos.direction == "bullish"
    assert bos.known_at == 1_700_000_005
    assert bos.parameters["close_break"] is True


def test_prefix_replay_matches_full_run_at_cutoff() -> None:
    bars = structure_bars()
    config = ChartEngineConfig(
        instrument_id="EURUSD",
        timeframe_seconds=60,
        source={"kind": "synthetic", "id": "prefix-fixture"},
    )
    cutoff = bars[4]["timestamp"]
    prefix = run_chart_intelligence(bars[:5], config)
    full_cutoff = run_chart_intelligence(bars, config, cutoff_timestamp=cutoff)
    assert [event.as_dict() for event in prefix] == [event.as_dict() for event in full_cutoff]
    assert all(event.known_at <= cutoff for event in full_cutoff)


def test_session_boundaries_use_declared_timezone_and_known_at() -> None:
    stamp = lambda hour, minute: int(datetime(2026, 3, 29, hour, minute, tzinfo=UTC).timestamp())
    # Europe/London is on BST on this date, so 09:00 local is 08:00 UTC.
    bars = [
        bar(stamp(7, 59), 1.0, 1.1, 0.9, 1.0),
        bar(stamp(8, 0), 1.0, 1.2, 0.95, 1.1),
        bar(stamp(8, 59), 1.1, 1.3, 1.0, 1.2),
        bar(stamp(9, 0), 1.2, 1.25, 1.05, 1.1),
    ]
    config = ChartEngineConfig(
        instrument_id="EURUSD",
        timeframe_seconds=60,
        session=SessionSpec("London", "Europe/London", "09:00", "10:00"),
        source={"kind": "synthetic", "id": "session-fixture"},
    )
    events = [event for event in run_chart_intelligence(bars, config) if event.kind == "SESSION"]
    assert [(event.parameters["boundary"], event.known_at) for event in events] == [
        ("start", bars[1]["timestamp"]),
        ("end", bars[3]["timestamp"]),
    ]
    assert events[1].anchor_timestamp == bars[2]["timestamp"]


def test_overlay_packets_validate_and_keep_events_bounded() -> None:
    config = ChartEngineConfig(
        instrument_id="EURUSD",
        timeframe_seconds=60,
        fvg_min_gap=0.1,
        source={"kind": "synthetic", "id": "packet-fixture"},
    )
    bars = [
        bar(1_700_002_000, 99.5, 100.0, 99.0, 99.5),
        bar(1_700_002_001, 99.5, 100.0, 99.4, 99.8),
        bar(1_700_002_002, 101.0, 102.0, 101.0, 101.5),
    ]
    events = run_chart_intelligence(bars, config)
    packets = build_overlay_packets(config, events)
    assert set(packets) == {"fvg"}
    assert packets["fvg"]["overlays"][0]["status"] == "committed"


@pytest.mark.parametrize("bad_value", [math.nan, math.inf, -math.inf])
def test_non_finite_ohlc_fails_closed(bad_value: float) -> None:
    with pytest.raises(ChartIntelligenceError, match="finite"):
        run_chart_intelligence(
            [bar(1_700_003_000, 1.0, bad_value, 0.9, 1.0)],
            ChartEngineConfig("EURUSD", 60),
        )


def test_invalid_order_and_cutoff_fail_closed() -> None:
    config = ChartEngineConfig("EURUSD", 60)
    with pytest.raises(ChartIntelligenceError, match="strictly increasing"):
        run_chart_intelligence(
            [bar(1_700_004_000, 1.0, 1.1, 0.9, 1.0), bar(1_700_004_000, 1.0, 1.1, 0.9, 1.0)],
            config,
        )
    with pytest.raises(ChartIntelligenceError, match="precedes"):
        run_chart_intelligence(
            [bar(1_700_004_000, 1.0, 1.1, 0.9, 1.0)],
            config,
            cutoff_timestamp=1_700_003_999,
        )


def test_mtf_last_confirmed_mapping_uses_closed_boundary_and_keeps_unknown_prefix() -> None:
    start = 1_700_010_000
    display = [
        bar(start + offset, 10.0, 11.0, 9.0, 10.0)
        for offset in (100, 199, 200, 399, 400, 500)
    ]
    source = [
        bar(start + 200, 10.0, 12.0, 9.0, 11.0),
        bar(start + 400, 11.0, 13.0, 10.0, 12.0),
    ]

    mappings = map_last_confirmed_htf(
        display,
        source,
        display_timeframe_seconds=60,
        source_timeframe_seconds=300,
    )

    assert [mapping.source_bar_close_timestamp for mapping in mappings] == [
        None,
        None,
        start + 200,
        start + 200,
        start + 400,
        start + 400,
    ]
    assert mappings[2].source_bar_id == f"bar:{start + 200}"
    assert mappings[2].as_dict() == {
        "policy": "higher_closed",
        "display_bar_id": f"bar:{start + 200}",
        "display_timestamp": start + 200,
        "display_timeframe_seconds": 60,
        "source_timeframe_seconds": 300,
        "source_bar_id": f"bar:{start + 200}",
        "source_bar_close_timestamp": start + 200,
    }


def test_mtf_mapping_does_not_leak_future_source_and_is_prefix_stable_at_cutoff() -> None:
    start = 1_700_020_000
    display = [
        bar(start + offset, 10.0, 11.0, 9.0, 10.0)
        for offset in (100, 200, 300, 400)
    ]
    confirmed = bar(start + 200, 10.0, 12.0, 9.0, 11.0)
    future = bar(start + 400, 11.0, 13.0, 10.0, 12.0)
    cutoff = start + 300

    prefix = map_last_confirmed_htf(
        display[:3],
        [confirmed],
        display_timeframe_seconds=60,
        source_timeframe_seconds=300,
    )
    full_cutoff = map_last_confirmed_htf(
        display,
        [confirmed, future],
        display_timeframe_seconds=60,
        source_timeframe_seconds=300,
        cutoff_timestamp=cutoff,
    )

    assert [mapping.as_dict() for mapping in prefix] == [mapping.as_dict() for mapping in full_cutoff]
    assert len(full_cutoff) == 3
    assert all(
        mapping.source_bar_close_timestamp is None
        or mapping.source_bar_close_timestamp <= mapping.display_timestamp <= cutoff
        for mapping in full_cutoff
    )


def test_mtf_mapping_accepts_utc_boundary_across_dst_without_local_rebucketing() -> None:
    # The timestamps straddle London's 2026 spring-forward boundary.  MTF
    # mapping is defined on UTC close times, so no local-hour conversion may
    # move the source boundary.
    transition = int(datetime(2026, 3, 29, 0, 59, tzinfo=UTC).timestamp())
    display = [
        bar(transition + seconds, 10.0, 11.0, 9.0, 10.0)
        for seconds in (0, 60, 3_660)
    ]
    source = [
        bar(transition, 10.0, 12.0, 9.0, 11.0),
        bar(transition + 3_660, 11.0, 13.0, 10.0, 12.0),
    ]

    mappings = map_last_confirmed_htf(
        display,
        source,
        display_timeframe_seconds=60,
        source_timeframe_seconds=3_600,
    )

    assert [mapping.source_bar_close_timestamp for mapping in mappings] == [
        transition,
        transition,
        transition + 3_660,
    ]


def test_mtf_mapping_rejects_non_higher_timeframe_and_invalid_source_order() -> None:
    display = [bar(1_700_030_000, 10.0, 11.0, 9.0, 10.0)]
    source = [bar(1_700_030_000, 10.0, 11.0, 9.0, 10.0)]
    with pytest.raises(ChartIntelligenceError, match="greater than display_timeframe_seconds"):
        map_last_confirmed_htf(
            display,
            source,
            display_timeframe_seconds=300,
            source_timeframe_seconds=300,
        )

    with pytest.raises(ChartIntelligenceError, match="strictly increasing"):
        map_last_confirmed_htf(
            display,
            [
                bar(1_700_030_100, 10.0, 11.0, 9.0, 10.0),
                bar(1_700_030_099, 10.0, 11.0, 9.0, 10.0),
            ],
            display_timeframe_seconds=60,
            source_timeframe_seconds=300,
        )
