from __future__ import annotations

from trading_workspace_v2.chart_alert_contract import evaluate_chart_alerts
from trading_workspace_v2.chart_intelligence import ChartEngineConfig, run_chart_intelligence
from trading_workspace_v2.zone_lifecycle import (
    ZoneLifecycleConfig,
    build_zone_overlay_packets,
    run_chart_intelligence_with_zones,
)


def bar(timestamp: int, opening: float, high: float, low: float, close: float) -> dict:
    return {
        "timestamp": timestamp,
        "open": opening,
        "high": high,
        "low": low,
        "close": close,
    }


def bars() -> list[dict]:
    return [
        bar(100, 10.0, 11.0, 9.0, 10.0),
        bar(160, 10.0, 12.0, 9.8, 11.5),  # confirmed high after bar 220
        bar(220, 11.5, 11.7, 10.0, 10.5),  # bearish OB origin
        bar(280, 10.5, 13.0, 10.4, 12.8),  # bullish BOS
        bar(340, 12.8, 13.0, 10.5, 11.8),  # OB mitigation
        bar(400, 11.8, 12.0, 9.5, 9.8),  # OB close-through invalidation
    ]


def fvg_bars() -> list[dict]:
    return [
        bar(100, 9.5, 10.0, 9.0, 9.5),
        bar(160, 9.6, 10.2, 9.4, 9.9),
        bar(220, 11.0, 12.0, 11.0, 11.5),
        bar(280, 11.5, 12.0, 10.5, 10.6),
    ]


def configs() -> tuple[ChartEngineConfig, ZoneLifecycleConfig]:
    return (
        ChartEngineConfig(
            instrument_id="EURUSD",
            timeframe_seconds=60,
            swing_left=1,
            swing_right=1,
            source={"kind": "synthetic", "id": "zone-integration"},
        ),
        ZoneLifecycleConfig("EURUSD", 60, range_mode="wick"),
    )


def alert_rule() -> dict:
    return {
        "schema": "chart-alert-rule-v1",
        "mode": "PREP_ONLY",
        "engine": "offline-advisory",
        "rule_id": "zone-lifecycle",
        "version": "1",
        "enabled": True,
        "event_kinds": ["ORDER_BLOCK", "OTE"],
        "directions": ["any"],
        "instruments": ["EURUSD"],
        "timeframes_seconds": [60],
        "ttl_seconds": 86_400,
        "delivery": "local_advisory",
        "confirmed_only": True,
        "replay_policy": "dedupe_event_id",
        "execution_capability": False,
        "order_effect": "none",
        "fill_effect": "none",
    }


def test_zone_orchestrator_preserves_chart_events_and_records_ob_ote() -> None:
    chart_config, zone_config = configs()
    direct = run_chart_intelligence(bars(), chart_config, cutoff_timestamp=340)
    result = run_chart_intelligence_with_zones(
        bars(),
        chart_config,
        zone_config,
        cutoff_timestamp=340,
        ote_legs=[
            {
                "direction": "bullish",
                "leg_start_timestamp": 100,
                "leg_end_timestamp": 160,
            }
        ],
    )

    assert result.chart_events == direct
    assert {item.kind for item in result.zone_transitions} == {"ORDER_BLOCK", "OTE"}
    assert [item.state for item in result.zone_transitions].count("confirmed") == 2
    assert result.rejected_zone_events == ()


def test_zone_orchestrator_rejects_ambiguous_ote_without_breaking_chart_stream() -> None:
    chart_config, zone_config = configs()
    result = run_chart_intelligence_with_zones(
        bars(),
        chart_config,
        zone_config,
        cutoff_timestamp=340,
        ote_legs=[{"direction": "bullish", "leg_start_timestamp": 100}],
    )

    assert result.chart_events
    assert any(item["kind"] == "OTE" and "missing fields" in item["reason"] for item in result.rejected_zone_events)


def test_zone_alert_projection_keeps_existing_confirmed_only_semantics() -> None:
    chart_config, zone_config = configs()
    result = run_chart_intelligence_with_zones(
        bars(),
        chart_config,
        zone_config,
        cutoff_timestamp=400,
        ote_legs=[
            {
                "direction": "bullish",
                "leg_start_timestamp": 100,
                "leg_end_timestamp": 160,
            }
        ],
    )
    events = result.alert_events()
    assert {event["schema"] for event in events} == {"chart-event-v1"}
    assert {event["state"] for event in events} == {"confirmed", "invalidated"}
    assert all("zone_id" not in event and "mode" not in event and "engine" not in event for event in events)

    evaluation = evaluate_chart_alerts(alert_rule(), events, cutoff_timestamp=400)
    assert len(evaluation.emitted) == 2  # confirmed OB + confirmed OTE
    assert sum(item["reason"] == "not_confirmed" for item in evaluation.suppressed) == 1


def test_zone_overlay_is_causal_and_terminal_state_is_reconciled_by_omission() -> None:
    chart_config, zone_config = configs()
    result = run_chart_intelligence_with_zones(
        bars(),
        chart_config,
        zone_config,
        cutoff_timestamp=400,
        ote_legs=[
            {
                "direction": "bullish",
                "leg_start_timestamp": 100,
                "leg_end_timestamp": 160,
            }
        ],
    )

    active_packets = build_zone_overlay_packets(chart_config, result.zone_transitions, cutoff_timestamp=340)
    assert set(active_packets) == {"order_block", "ote"}
    assert active_packets["order_block"]["overlays"][0]["known_at"] <= 340
    assert "MITIGATED" in active_packets["order_block"]["overlays"][0]["label"]
    assert active_packets["ote"]["indicator"]["indicator_id"] == "ote"

    terminal_packets = build_zone_overlay_packets(chart_config, result.zone_transitions, cutoff_timestamp=400)
    assert "order_block" not in terminal_packets
    assert "ote" in terminal_packets


def test_zone_orchestrator_replay_prefix_is_stable() -> None:
    chart_config, zone_config = configs()
    prefix = run_chart_intelligence_with_zones(
        bars()[:5], chart_config, zone_config, cutoff_timestamp=340
    )
    full = run_chart_intelligence_with_zones(
        bars(), chart_config, zone_config, cutoff_timestamp=340
    )
    assert prefix.chart_events == full.chart_events
    assert [item.as_dict() for item in prefix.zone_transitions] == [
        item.as_dict() for item in full.zone_transitions
    ]


def test_zone_orchestrator_projects_fvg_lifecycle_and_overlay() -> None:
    chart_config = ChartEngineConfig(
        "EURUSD",
        60,
        fvg_min_gap=0.5,
        source={"kind": "synthetic", "id": "fvg-zone-integration"},
    )
    zone_config = ZoneLifecycleConfig("EURUSD", 60)
    result = run_chart_intelligence_with_zones(
        fvg_bars(), chart_config, zone_config, cutoff_timestamp=280
    )

    assert {item.kind for item in result.zone_transitions} == {"FVG"}
    assert [item.state for item in result.zone_transitions] == ["confirmed", "mitigated"]
    packets = build_zone_overlay_packets(chart_config, result.zone_transitions, cutoff_timestamp=280)
    assert set(packets) == {"fvg"}
    assert packets["fvg"]["indicator"]["indicator_id"] == "fvg"
    assert "MITIGATED" in packets["fvg"]["overlays"][0]["label"]
