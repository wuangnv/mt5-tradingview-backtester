from __future__ import annotations

import pytest

from trading_workspace_v2.chart_alert_contract import (
    ALERT_ENGINE,
    PREP_ONLY_MODE,
    ChartAlertContractError,
    evaluate_chart_alerts,
)
from trading_workspace_v2.chart_intelligence import (
    ChartEngineConfig,
    ChartIntelligenceError,
    build_overlay_packets,
    run_chart_intelligence,
)


def bar(timestamp: int, opening: float, high: float, low: float, close: float) -> dict:
    return {"timestamp": timestamp, "open": opening, "high": high, "low": low, "close": close}


def alert_rule() -> dict:
    return {
        "schema": "chart-alert-rule-v1",
        "mode": PREP_ONLY_MODE,
        "engine": ALERT_ENGINE,
        "rule_id": "parity-fixture",
        "version": "1",
        "enabled": True,
        "event_kinds": ["SWING", "BOS"],
        "directions": ["any"],
        "instruments": [],
        "timeframes_seconds": [],
        "ttl_seconds": 300,
        "delivery": "local_advisory",
        "confirmed_only": True,
        "replay_policy": "dedupe_event_id",
        "execution_capability": False,
        "order_effect": "none",
        "fill_effect": "none",
    }


def alert_event(*, event_id: str = "evt:delayed", anchor: int = 100, known_at: int = 120, state: str = "confirmed") -> dict:
    return {
        "schema": "chart-event-v1",
        "event_id": event_id,
        "kind": "SWING",
        "direction": "bearish",
        "instrument_id": "EURUSD",
        "timeframe_seconds": 60,
        "anchor_timestamp": anchor,
        "known_at": known_at,
        "source_bar_ids": [f"bar:{anchor}", f"bar:{known_at - 1}"],
        "price_low": 1.1,
        "price_high": 1.2,
        "state": state,
        "confirmation_lag_bars": 2,
        "rule_version": "smc-core.v1",
        "parameters": {"fixture": True},
        "identity": {"fixture": event_id},
    }


def test_pivot_tie_policy_is_named_and_deterministic_for_equal_right_value() -> None:
    start = 1_700_100_000
    bars = [
        bar(start, 10.0, 10.0, 9.0, 9.5),
        bar(start + 1, 14.0, 15.0, 13.0, 14.0),
        # Equal right high: the earliest candidate wins under the frozen policy.
        bar(start + 2, 14.0, 15.0, 13.0, 14.0),
        bar(start + 3, 12.0, 12.0, 11.0, 11.5),
    ]
    config = ChartEngineConfig(
        "EURUSD",
        60,
        swing_left=1,
        swing_right=1,
        pivot_tie_policy="left_strict_right_inclusive",
        source={"kind": "synthetic", "id": "parity-tie"},
    )

    swings = [event for event in run_chart_intelligence(bars, config) if event.kind == "SWING"]

    assert config.pivot_tie_policy == "left_strict_right_inclusive"
    assert [(event.anchor_timestamp, event.parameters["tie_policy"]) for event in swings] == [
        (start + 1, "left_strict_right_inclusive"),
    ]

    with pytest.raises(ChartIntelligenceError, match="pivot_tie_policy must be one of"):
        ChartEngineConfig("EURUSD", 60, pivot_tie_policy="pine_unknown")


def test_pivot_plot_backfill_never_becomes_visible_before_confirmation_cutoff() -> None:
    start = 1_700_100_100
    bars = [
        bar(start, 10.0, 10.0, 9.0, 9.5),
        bar(start + 1, 14.0, 15.0, 13.0, 14.0),
        bar(start + 2, 11.0, 12.0, 10.0, 11.0),
    ]
    config = ChartEngineConfig(
        "EURUSD",
        60,
        swing_left=1,
        swing_right=1,
        source={"kind": "synthetic", "id": "parity-plot-offset"},
    )

    prefix_events = run_chart_intelligence(bars[:2], config)
    full_events = run_chart_intelligence(bars, config)
    swing = next(event for event in full_events if event.kind == "SWING")
    packet = build_overlay_packets(config, [swing], cutoff_timestamp=swing.known_at)["swing"]

    assert not [event for event in prefix_events if event.kind == "SWING"]
    assert swing.anchor_timestamp < swing.known_at
    assert packet["overlays"][0]["anchors"][0]["timestamp"] == swing.anchor_timestamp
    assert packet["overlays"][0]["known_at"] == swing.known_at
    with pytest.raises(ChartIntelligenceError, match="events exceed overlay cutoff"):
        build_overlay_packets(config, [swing], cutoff_timestamp=swing.anchor_timestamp)


def test_alert_is_close_only_and_dedupes_same_confirmed_event_after_reconnect() -> None:
    delayed = alert_event()

    with pytest.raises(ChartAlertContractError, match="beyond cutoff"):
        evaluate_chart_alerts(alert_rule(), [delayed], delayed["anchor_timestamp"])

    first = evaluate_chart_alerts(alert_rule(), [delayed], delayed["known_at"])
    assert len(first.emitted) == 1
    assert first.emitted[0]["event_known_at"] == delayed["known_at"]
    assert first.emitted[0]["input_snapshot"]["cutoff_timestamp"] == delayed["known_at"]

    reconnect = evaluate_chart_alerts(
        alert_rule(),
        [delayed],
        delayed["known_at"],
        previous_ledger=first.next_ledger,
    )
    assert reconnect.emitted == ()
    assert reconnect.suppressed == ({"event_id": delayed["event_id"], "alert_id": first.emitted[0]["alert_id"], "reason": "duplicate"},)

    same_bar = alert_event(event_id="evt:same-bar", anchor=200, known_at=200)
    same_bar_result = evaluate_chart_alerts(alert_rule(), [same_bar], 200)
    assert len(same_bar_result.emitted) == 1
    assert same_bar_result.emitted[0]["event_known_at"] == same_bar["anchor_timestamp"]

    provisional = alert_event(event_id="evt:provisional", anchor=300, known_at=300, state="provisional")
    provisional_result = evaluate_chart_alerts(alert_rule(), [provisional], 300)
    assert provisional_result.emitted == ()
    assert provisional_result.suppressed == (({"event_id": provisional["event_id"], "reason": "not_confirmed"}),)
