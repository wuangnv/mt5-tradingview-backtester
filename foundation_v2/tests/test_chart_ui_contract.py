from __future__ import annotations

import copy

import pytest

from trading_workspace_v2.chart_ai_contract import ChartAIRequest, compute_context_hash
from trading_workspace_v2.chart_alert_contract import evaluate_chart_alerts
from trading_workspace_v2.chart_explainability_contract import build_chart_explanation
from trading_workspace_v2.chart_intelligence import ChartEngineConfig, run_chart_intelligence
from trading_workspace_v2.chart_overlay_contract import (
    PREP_ONLY_MODE,
    cache_key,
    definition_sha256,
    validate_indicator_spec,
)
from trading_workspace_v2.chart_renderer_contract import build_render_plan
from trading_workspace_v2.chart_ui_contract import build_chart_ui_state


def indicator() -> dict:
    return {
        "schema": "indicator-definition-v1",
        "mode": PREP_ONLY_MODE,
        "engine": "deterministic-offline",
        "family": "ict",
        "indicator_id": "fvg",
        "version": "ict-fvg-v1",
        "timezone": "UTC",
        "display_timeframe_seconds": 60,
        "source_timeframe_seconds": 60,
        "mtf_policy": "same_timeframe",
        "lookahead": "closed_only",
        "causal_delay_bars": 0,
        "repaint": {"flag": False, "state": "confirmed", "confirmation_bars": 0},
        "parameters": {"min_gap_ticks": 1},
    }


def render_plan() -> tuple[object, dict, list[dict]]:
    spec = validate_indicator_spec(indicator())
    source = {"kind": "synthetic", "id": "ui-fixture", "dataset_id": "ui"}
    cutoff = 1_700_000_120
    overlay = {
        "schema": "chart-overlay-v1",
        "mode": PREP_ONLY_MODE,
        "overlay_id": "fvg-1",
        "kind": "zone",
        "instrument_id": "EURUSD",
        "display_timeframe_seconds": 60,
        "cutoff_timestamp": cutoff,
        "source": source,
        "anchors": [
            {"timestamp": 1_700_000_060, "price": 1.101},
            {"timestamp": 1_700_000_090, "price": 1.102},
        ],
        "confidence": {"state": "known", "value": 1.0},
        "repaint": {"flag": False, "state": "confirmed", "confirmation_bars": 0},
        "status": "committed",
        "revision": 1,
        "indicator_sha256": definition_sha256(spec),
        "cache_key": cache_key(
            indicator=spec,
            source=source,
            instrument_id="EURUSD",
            display_timeframe_seconds=60,
            cutoff_timestamp=cutoff,
        ),
        "label": "FVG",
    }
    packet = {
        "schema": "chart-overlay-packet-v1",
        "mode": PREP_ONLY_MODE,
        "engine": "deterministic-offline",
        "indicator": spec,
        "indicator_sha256": definition_sha256(spec),
        "source": source,
        "cutoff_timestamp": cutoff,
        "overlays": [overlay],
    }
    plan = build_render_plan(packet)
    bars = [
        {"timestamp": 1_700_000_000, "open": 99.5, "high": 100.0, "low": 99.0, "close": 99.5},
        {"timestamp": 1_700_000_060, "open": 99.5, "high": 100.0, "low": 99.4, "close": 99.8},
        {"timestamp": 1_700_000_120, "open": 101.0, "high": 102.0, "low": 101.0, "close": 101.5},
    ]
    return plan, source, bars


def event_and_bars() -> tuple[dict, list[dict], int]:
    bars = [
        {"timestamp": 1_700_000_000, "open": 99.5, "high": 100.0, "low": 99.0, "close": 99.5},
        {"timestamp": 1_700_000_060, "open": 99.5, "high": 100.0, "low": 99.4, "close": 99.8},
        {"timestamp": 1_700_000_120, "open": 101.0, "high": 102.0, "low": 101.0, "close": 101.5},
    ]
    event = next(
        item
        for item in run_chart_intelligence(
            bars,
            ChartEngineConfig(
                instrument_id="EURUSD",
                timeframe_seconds=60,
                fvg_min_gap=0.5,
                source={"kind": "synthetic", "id": "ui-fixture", "dataset_id": "ui"},
            ),
        )
        if item.kind == "FVG"
    )
    return event.as_dict(), bars, 1_700_000_120


def alert_rule() -> dict:
    return {
        "schema": "chart-alert-rule-v1",
        "mode": PREP_ONLY_MODE,
        "engine": "offline-advisory",
        "rule_id": "fvg-advisory",
        "version": "1",
        "enabled": True,
        "event_kinds": ["FVG"],
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


def ai_request(cutoff: int) -> dict:
    payload = {
        "schema_version": "chart-ai-request-v1",
        "mode": "advisory",
        "request_id": "ui-ai-1",
        "workspace_id_server_bound": "workspace-a",
        "job": "chart_explanation",
        "context_version": "ui-fixture-v1",
        "context_hash": "sha256:" + ("0" * 64),
        "instrument_id": "EURUSD",
        "timeframe_seconds": 60,
        "cursor_or_cutoff": cutoff,
        "visible_slice": {"bars": [{"timestamp": cutoff, "close": 101.5}]},
        "source_revisions": [{"workspace_id": "workspace-a", "kind": "replay", "id": "ui-fixture", "revision": 1}],
        "method_versions": {"chart_engine": "smc-core.v1"},
        "quality_warnings": [],
        "evidence_event_ids": [],
        "evidence_bar_ids": [],
    }
    request = ChartAIRequest.model_validate(payload)
    payload["context_hash"] = compute_context_hash(request)
    return payload


def ai_response(request: dict) -> dict:
    return {
        "schema_version": "chart-ai-response-v1",
        "mode": "advisory",
        "request_id": request["request_id"],
        "status": "uncertain",
        "provider": "offline",
        "model": "chart-advisory-offline-v1",
        "context_hash": request["context_hash"],
        "result": {
            "schema_version": "chart-ai-result-v1",
            "claim": "unknown",
            "summary": "Evidence is insufficient for a grounded chart claim.",
            "uncertainty": "unknown",
            "action": "review",
            "invalid_if": ["cutoff changes"],
        },
        "evidence_event_ids": [],
        "evidence_bar_ids": [],
        "execution_capability": False,
        "write_authority": False,
    }


def test_view_model_binds_scope_and_keeps_advisory_capabilities_closed() -> None:
    plan, source, bars = render_plan()
    event, _, cutoff = event_and_bars()
    explanation = build_chart_explanation(
        event,
        bars,
        cutoff_timestamp=cutoff,
        provenance={
            "source": source,
            "revision": "ui-fixture-r1",
            "engine_commit": "ui-contract-test",
        },
    )
    alerts = evaluate_chart_alerts(alert_rule(), [event], cutoff)
    request = ai_request(cutoff)
    state = build_chart_ui_state(
        plan,
        ai_request=request,
        ai_response=ai_response(request),
        explanation=explanation,
        alert_evaluation=alerts,
    )

    assert state["schema"] == "chart-ui-state-v1"
    assert state["scope"]["cutoff_timestamp"] == cutoff
    assert state["renderer"]["status"] == "ready"
    assert state["ai"]["status"] == "uncertain"
    assert state["explainability"]["status"] == "ready"
    assert state["alerts"]["status"] == "ready"
    assert state["alerts"]["delivery"] == "local_advisory"
    assert state["capabilities"]["broker_execution"] is False
    assert state["capabilities"]["annotation_write_authority"] is False
    assert state["alerts"]["execution_capability"] is False


def test_missing_panels_are_explicitly_unavailable() -> None:
    plan, _, _ = render_plan()
    state = build_chart_ui_state(plan)
    assert state["ai"] == {"status": "unavailable", "reason": "not_requested"}
    assert state["explainability"] == {"status": "unavailable", "reason": "not_requested"}
    assert state["alerts"] == {"status": "unavailable", "reason": "not_requested"}


def test_mismatched_cutoff_or_source_cannot_appear_current() -> None:
    plan, source, bars = render_plan()
    event, _, cutoff = event_and_bars()
    explanation = build_chart_explanation(
        event,
        bars,
        cutoff_timestamp=cutoff,
        provenance={
            "source": {**source, "id": "different-source"},
            "revision": "ui-fixture-r1",
            "engine_commit": "ui-contract-test",
        },
    )
    request = ai_request(cutoff + 60)
    state = build_chart_ui_state(
        plan,
        ai_request=request,
        ai_response=ai_response(request),
        explanation=explanation,
    )
    assert state["ai"]["status"] == "stale"
    assert state["ai"]["reason"] == "cutoff_mismatch"
    assert state["explainability"]["status"] == "stale"
    assert state["explainability"]["reason"] == "source_mismatch"


def test_tampered_render_scope_is_rejected() -> None:
    plan, _, _ = render_plan()
    payload = plan.as_dict()
    payload["objects"][0]["cutoff_timestamp"] += 1
    with pytest.raises(Exception, match="cutoff"):
        build_chart_ui_state(payload)

    payload = plan.as_dict()
    payload["stats"]["objects_visible"] = 0
    with pytest.raises(Exception, match="stats"):
        build_chart_ui_state(payload)

