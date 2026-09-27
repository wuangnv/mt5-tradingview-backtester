from __future__ import annotations

from datetime import UTC, datetime

import pytest

from trading_workspace_v2.chart_intelligence import (
    ChartEngineConfig,
    ChartIntelligenceError,
    SessionSpec,
    build_overlay_packets,
    run_chart_intelligence,
)


def _bar(timestamp: int, opening: float, high: float, low: float, close: float, **extra) -> dict:
    value = {
        "timestamp": timestamp,
        "open": opening,
        "high": high,
        "low": low,
        "close": close,
    }
    value.update(extra)
    return value


@pytest.mark.parametrize(
    ("bad_bar", "message"),
    [
        ({"timestamp": True, "open": 1.0, "high": 1.1, "low": 0.9, "close": 1.0}, "integer"),
        (_bar(1_800_000_000, 1.0, 0.9, 0.8, 1.0), "OHLC bounds"),
        (_bar(1_800_000_000, 1.0, 1.1, 0.9, 1.0, volume=-1.0), ">= 0"),
        (_bar(1_800_000_000, 1.0, 1.1, 0.9, 1.0, unsupported=1), "unsupported fields"),
    ],
)
def test_malformed_bar_schema_fails_closed(bad_bar: dict, message: str) -> None:
    with pytest.raises(ChartIntelligenceError, match=message):
        run_chart_intelligence([bad_bar], ChartEngineConfig("EURUSD", 60))


def test_fall_back_dst_uses_the_post_transition_offset() -> None:
    # On 2026-10-25 London has already moved from BST to GMT by 09:00 local.
    # The boundary must still be emitted at the correct UTC timestamps.
    stamp = lambda hour, minute: int(datetime(2026, 10, 25, hour, minute, tzinfo=UTC).timestamp())
    bars = [
        _bar(stamp(8, 59), 1.0, 1.1, 0.9, 1.0),
        _bar(stamp(9, 0), 1.0, 1.1, 0.9, 1.0),
        _bar(stamp(9, 59), 1.0, 1.1, 0.9, 1.0),
        _bar(stamp(10, 0), 1.0, 1.1, 0.9, 1.0),
    ]
    config = ChartEngineConfig(
        "EURUSD",
        60,
        session=SessionSpec("London", "Europe/London", "09:00", "10:00"),
    )
    events = [event for event in run_chart_intelligence(bars, config) if event.kind == "SESSION"]
    assert [(event.parameters["boundary"], event.known_at) for event in events] == [
        ("start", bars[1]["timestamp"]),
        ("end", bars[3]["timestamp"]),
    ]
    assert events[0].parameters["session_date"] == "2026-10-25"
    assert events[1].parameters["session_date"] == "2026-10-25"


def _monotone_fvg_bars(count: int) -> list[dict]:
    # Every third-bar window has a positive bullish gap.  The count is chosen
    # to exercise both sides of the 256-overlay packet limit.
    start = 1_800_100_000
    return [
        _bar(start + index, 100.0 + index * 2, 101.0 + index * 2, 99.0 + index * 2, 100.5 + index * 2)
        for index in range(count)
    ]


def test_overlay_packet_accepts_256_and_rejects_257_overlays() -> None:
    config = ChartEngineConfig("EURUSD", 60, source={"kind": "synthetic", "id": "cap-fixture"})
    accepted_events = run_chart_intelligence(_monotone_fvg_bars(258), config)
    accepted_fvg = [event for event in accepted_events if event.kind == "FVG"]
    assert len(accepted_fvg) == 256
    accepted = build_overlay_packets(config, accepted_events)
    assert len(accepted["fvg"]["overlays"]) == 256

    rejected_events = run_chart_intelligence(_monotone_fvg_bars(259), config)
    rejected_fvg = [event for event in rejected_events if event.kind == "FVG"]
    assert len(rejected_fvg) == 257
    with pytest.raises(ChartIntelligenceError, match="overlay packet validation failed for fvg"):
        build_overlay_packets(config, rejected_events)


def _long_series(count: int) -> list[dict]:
    start = 1_800_200_000
    return [
        _bar(
            start + index,
            100.0 + (index % 17) * 0.001,
            100.01 + (index % 17) * 0.001,
            99.99 + (index % 17) * 0.001,
            100.0 + (index % 17) * 0.001,
        )
        for index in range(count)
    ]


def test_long_series_prefix_replay_is_deterministic() -> None:
    bars = _long_series(20_000)
    config = ChartEngineConfig("EURUSD", 60, source={"kind": "synthetic", "id": "long-fixture"})
    cutoff = bars[9_999]["timestamp"]
    prefix = run_chart_intelligence(bars[:10_000], config)
    full_cutoff = run_chart_intelligence(bars, config, cutoff_timestamp=cutoff)
    assert [event.as_dict() for event in prefix] == [event.as_dict() for event in full_cutoff]
    assert len({event.event_id for event in full_cutoff}) == len(full_cutoff)
