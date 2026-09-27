from __future__ import annotations

import copy

import pytest

from trading_workspace_v2.chart_explainability_contract import (
    ChartExplainabilityError,
    build_chart_explanation,
    validate_chart_explanation,
)
from trading_workspace_v2.chart_intelligence import ChartEngineConfig, run_chart_intelligence


def bar(timestamp: int, opening: float, high: float, low: float, close: float) -> dict:
    return {"timestamp": timestamp, "open": opening, "high": high, "low": low, "close": close}


def fixture() -> tuple[object, list[dict], int]:
    start = 1_700_100_000
    bars = [
        bar(start, 99.5, 100.0, 99.0, 99.5),
        bar(start + 1, 99.5, 100.0, 99.4, 99.8),
        bar(start + 2, 101.0, 102.0, 101.0, 101.5),
    ]
    config = ChartEngineConfig(
        instrument_id="EURUSD",
        timeframe_seconds=60,
        fvg_min_gap=0.5,
        source={"kind": "synthetic", "id": "c4-fixture", "dataset_id": "c4"},
    )
    event = next(item for item in run_chart_intelligence(bars, config) if item.kind == "FVG")
    return event, bars, start + 2


def provenance() -> dict:
    return {
        "source": {"kind": "synthetic", "id": "c4-fixture", "dataset_id": "c4"},
        "revision": "fixture-r1",
        "engine_commit": "offline-c4",
    }


def test_builds_typed_causal_packet_with_manual_recompute() -> None:
    event, bars, cutoff = fixture()
    packet = build_chart_explanation(event, bars, cutoff_timestamp=cutoff, provenance=provenance())

    assert packet["schema"] == "chart-explanation-v1"
    assert packet["mode"] == "PREP_ONLY"
    assert packet["event"]["event_id"] == event.event_id
    assert packet["rule"]["version"] == event.as_dict()["rule_version"]
    assert packet["source_bars"][0]["availability"] == "available"
    assert packet["recompute"]["status"] == "available"
    assert packet["recompute"]["values"]["price_range"] == event.price_high - event.price_low
    assert packet["invalidation"]["state"] == "unknown"
    assert packet["invalidation"]["unknown_fields"]
    assert validate_chart_explanation(packet) == packet


def test_packet_is_deterministic_and_requires_every_source_bar() -> None:
    event, bars, cutoff = fixture()
    first = build_chart_explanation(event, bars, cutoff_timestamp=cutoff, provenance=provenance())
    second = build_chart_explanation(event, list(reversed(bars)), cutoff_timestamp=cutoff, provenance=provenance())
    assert first == second

    with pytest.raises(ChartExplainabilityError, match="missing source bar"):
        build_chart_explanation(event, bars[:-1], cutoff_timestamp=cutoff, provenance=provenance())


def test_future_source_reference_and_future_event_cutoff_fail_closed() -> None:
    event, bars, cutoff = fixture()
    future = bars + [bar(cutoff + 1, 102.0, 103.0, 101.0, 102.5)]
    with pytest.raises(ChartExplainabilityError, match="unknown source bar|exceeds"):
        build_chart_explanation(event, future, cutoff_timestamp=cutoff, provenance=provenance())

    payload = build_chart_explanation(event, bars, cutoff_timestamp=cutoff, provenance=provenance())
    payload["cutoff_timestamp"] = event.known_at - 1
    with pytest.raises(ChartExplainabilityError, match="exceeds replay cutoff"):
        validate_chart_explanation(payload)


def test_tampered_rule_recompute_and_invalidation_reference_are_rejected() -> None:
    event, bars, cutoff = fixture()
    packet = build_chart_explanation(event, bars, cutoff_timestamp=cutoff, provenance=provenance())

    tampered_rule = copy.deepcopy(packet)
    tampered_rule["rule"]["parameters"]["gap"] = 999.0
    with pytest.raises(ChartExplainabilityError, match="definition hash"):
        validate_chart_explanation(tampered_rule)

    tampered_recompute = copy.deepcopy(packet)
    tampered_recompute["recompute"]["values"]["price_low"] = 0.0
    with pytest.raises(ChartExplainabilityError, match="recompute values"):
        validate_chart_explanation(tampered_recompute)

    tampered_invalidation = copy.deepcopy(packet)
    tampered_invalidation["invalidation"] = {
        "state": "invalidated",
        "condition": "close through range",
        "known_at": cutoff,
        "evidence_bar_ids": ["bar:9999999999"],
        "unknown_fields": [],
    }
    with pytest.raises(ChartExplainabilityError, match="unavailable source bar"):
        validate_chart_explanation(tampered_invalidation)


def test_provenance_forbidden_provider_and_unknown_values_fail_closed() -> None:
    event, bars, cutoff = fixture()
    with pytest.raises(ChartExplainabilityError, match="provenance has unsupported"):
        build_chart_explanation(
            event,
            bars,
            cutoff_timestamp=cutoff,
            provenance={**provenance(), "provider": "remote"},
        )

    packet = build_chart_explanation(event, bars, cutoff_timestamp=cutoff, provenance=provenance())
    packet["source_bars"][0]["close"] = 0.0
    with pytest.raises(ChartExplainabilityError, match="finite|OHLC|must be > 0"):
        validate_chart_explanation(packet)

