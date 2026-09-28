from __future__ import annotations

import copy

import pytest

from trading_workspace_v2.chart_overlay_contract import (
    OVERLAY_SCHEMA,
    PACKET_SCHEMA,
    PREP_ONLY_MODE,
    cache_key,
    definition_sha256,
    validate_indicator_spec,
)
from trading_workspace_v2.chart_renderer_contract import (
    ChartRendererContractError,
    RendererBudget,
    RendererState,
    RendererViewport,
    accept_overlay,
    build_render_plan,
    preview_overlay,
    undo_overlay,
)


def indicator() -> dict:
    return {
        "schema": "indicator-definition-v1",
        "mode": PREP_ONLY_MODE,
        "engine": "deterministic-offline",
        "family": "ict",
        "indicator_id": "fvg",
        "version": "ict-fvg-v1",
        "timezone": "Asia/Ho_Chi_Minh",
        "display_timeframe_seconds": 60,
        "source_timeframe_seconds": 60,
        "mtf_policy": "same_timeframe",
        "lookahead": "closed_only",
        "causal_delay_bars": 0,
        "repaint": {"flag": False, "state": "confirmed", "confirmation_bars": 0},
        "parameters": {"min_gap_ticks": 1},
    }


def packet(
    *,
    statuses: tuple[str, ...] = ("preview",),
    source_id: str = "renderer-fixture",
    cutoff: int = 1_700_000_180,
) -> dict:
    spec = validate_indicator_spec(indicator())
    source = {"kind": "replay", "id": source_id, "dataset_id": "fixture"}
    overlays: list[dict] = []
    for index, status in enumerate(statuses, start=1):
        object_id = f"fvg-{index}"
        anchors = [
            {"timestamp": 1_700_000_020 + index * 10, "price": 1.1010 + index / 10000},
            {"timestamp": 1_700_000_030 + index * 10, "price": 1.1020 + index / 10000},
        ]
        overlay = {
            "schema": OVERLAY_SCHEMA,
            "mode": PREP_ONLY_MODE,
            "overlay_id": object_id,
            "kind": "zone",
            "instrument_id": "EURUSD",
            "display_timeframe_seconds": 60,
            "cutoff_timestamp": cutoff,
            "source": source,
            "anchors": anchors,
            "confidence": {"state": "known", "value": 1.0},
            "repaint": {"flag": False, "state": "confirmed", "confirmation_bars": 0},
            "status": status,
            "revision": 1,
            "indicator_sha256": definition_sha256(spec),
            "cache_key": cache_key(
                indicator=spec,
                source=source,
                instrument_id="EURUSD",
                display_timeframe_seconds=60,
                cutoff_timestamp=cutoff,
            ),
            "label": f"fixture-{index}",
        }
        overlays.append(overlay)
    return {
        "schema": PACKET_SCHEMA,
        "mode": PREP_ONLY_MODE,
        "engine": "deterministic-offline",
        "indicator": spec,
        "indicator_sha256": definition_sha256(spec),
        "source": source,
        "cutoff_timestamp": cutoff,
        "overlays": overlays,
    }


def test_preview_accept_undo_lifecycle_reconciles_and_tombstones() -> None:
    preview = preview_overlay(packet(), "fvg-1")
    first = build_render_plan(preview)
    assert first.stats["objects_visible"] == 1
    assert [item["op"] for item in first.operations] == ["upsert"]

    accepted = accept_overlay(preview, "fvg-1", expected_revision=1)
    assert accepted["overlays"][0]["status"] == "committed"
    assert accepted["overlays"][0]["revision"] == 2
    second = build_render_plan(accepted, previous_state=first.next_state)
    assert second.operations[0]["reason"] == "revision_update"

    undone = undo_overlay(accepted, "fvg-1", expected_revision=2)
    assert undone["overlays"][0]["undo_of_revision"] == 2
    third = build_render_plan(undone, previous_state=second.next_state)
    assert third.operations == (
        {"op": "remove", "object_id": "fvg-1", "reason": "undo", "revision": 2},
    )
    assert third.next_state.tombstones == {"fvg-1": 3}


def test_render_objects_retain_causal_overlay_metadata() -> None:
    payload = packet()
    overlay = payload["overlays"][0]
    known_at = max(anchor["timestamp"] for anchor in overlay["anchors"])
    overlay.update(
        {
            "known_at": known_at,
            "source_bar_ids": [f"bar:{anchor['timestamp']}" for anchor in overlay["anchors"]],
            "confirmation_lag_bars": 0,
        }
    )

    plan = build_render_plan(payload)
    rendered = plan.objects[0]
    assert rendered["known_at"] == known_at
    assert rendered["source_bar_ids"] == [f"bar:{anchor['timestamp']}" for anchor in overlay["anchors"]]
    assert rendered["confirmation_lag_bars"] == 0
    operation = plan.operations[0]
    assert operation["op"] == "upsert"
    assert operation["known_at"] == known_at
    assert operation["source_bar_ids"] == rendered["source_bar_ids"]
    assert operation["confirmation_lag_bars"] == 0
    assert plan.next_state.objects["fvg-1"]["known_at"] == known_at


def test_causal_metadata_survives_revision_update_and_removal_operations() -> None:
    payload = packet()
    overlay = payload["overlays"][0]
    known_at = max(anchor["timestamp"] for anchor in overlay["anchors"])
    overlay.update(
        {
            "known_at": known_at,
            "source_bar_ids": [f"bar:{anchor['timestamp']}" for anchor in overlay["anchors"]],
            "confirmation_lag_bars": 0,
        }
    )
    first = build_render_plan(payload)
    accepted = accept_overlay(payload, "fvg-1", expected_revision=1)
    second = build_render_plan(accepted, previous_state=first.next_state)
    update = second.operations[0]
    assert update["reason"] == "revision_update"
    assert update["known_at"] == known_at
    # An empty full snapshot is outside the packet contract, so retain the
    # valid overlay but mark it undone to exercise the removal path.
    undone = undo_overlay(accepted, "fvg-1", expected_revision=2)
    third = build_render_plan(undone, previous_state=second.next_state)
    removal = third.operations[0]
    assert removal["op"] == "remove"
    assert removal["known_at"] == known_at
    assert removal["source_bar_ids"] == overlay["source_bar_ids"]
    assert removal["confirmation_lag_bars"] == 0


def test_missing_overlay_is_stale_and_cleanup_is_explicit() -> None:
    original = packet(statuses=("committed", "committed"))
    first = build_render_plan(original)
    reduced = copy.deepcopy(original)
    reduced["overlays"] = reduced["overlays"][:1]
    second = build_render_plan(reduced, previous_state=first.next_state)
    assert second.stale_cleanup["policy"] == "full_snapshot_reconcile"
    assert second.stale_cleanup["stale_ids"] == ["fvg-2"]
    assert {item["object_id"] for item in second.operations} == {"fvg-2"}
    assert second.operations[0]["reason"] == "stale_snapshot"
    assert second.next_state.tombstones == {"fvg-2": 1}


def test_source_or_cutoff_change_resets_old_surface_scope() -> None:
    original = packet(statuses=("committed",))
    overlay = original["overlays"][0]
    known_at = max(anchor["timestamp"] for anchor in overlay["anchors"])
    overlay.update(
        {
            "known_at": known_at,
            "source_bar_ids": [f"bar:{anchor['timestamp']}" for anchor in overlay["anchors"]],
            "confirmation_lag_bars": 0,
        }
    )
    first = build_render_plan(original)
    changed = build_render_plan(
        packet(statuses=("committed",), source_id="renderer-fixture-next"),
        previous_state=first.next_state,
    )
    assert changed.stale_cleanup["scope_reset_ids"] == ["fvg-1"]
    assert changed.stats["objects_scope_reset"] == 1
    assert {item["reason"] for item in changed.operations} == {
        "scope_reset",
        "new",
    }
    scope_removal = next(item for item in changed.operations if item["reason"] == "scope_reset")
    assert scope_removal["known_at"] == known_at
    assert scope_removal["source_bar_ids"] == overlay["source_bar_ids"]
    assert scope_removal["confirmation_lag_bars"] == 0
    assert changed.next_state.tombstones == {}


def test_object_and_visible_caps_are_bounded_with_deterministic_eviction() -> None:
    plan = build_render_plan(
        packet(statuses=("preview", "committed", "committed")),
        budget=RendererBudget(max_objects=2, max_visible_objects=1),
        viewport=RendererViewport(1_700_000_000, 1_700_000_180),
    )
    assert plan.stats["objects_received"] == 3
    assert plan.stats["objects_registered"] == 2
    assert plan.stats["objects_evicted"] == 1
    assert plan.stats["objects_visible"] == 1
    assert len([item for item in plan.objects if item["visible"]]) == 1
    assert plan.stale_cleanup["evicted_ids"] == ["fvg-1"]


def test_stale_revision_and_bad_undo_fail_closed() -> None:
    committed = accept_overlay(packet(), "fvg-1", expected_revision=1)
    first = build_render_plan(committed)
    with pytest.raises(ChartRendererContractError, match="revision regressed"):
        build_render_plan(packet(), previous_state=first.next_state)

    invalid_undo = undo_overlay(committed, "fvg-1", expected_revision=2)
    invalid_undo["overlays"][0]["undo_of_revision"] = 1
    with pytest.raises(ChartRendererContractError, match="does not match"):
        build_render_plan(invalid_undo, previous_state=first.next_state)


def test_state_rejects_object_tombstone_collision_and_budget_shape() -> None:
    with pytest.raises(ChartRendererContractError, match="cannot also be tombstoned"):
        RendererState(
            objects={"x": {"object_id": "x", "status": "preview", "revision": 1, "visible": True}},
            tombstones={"x": 1},
        )
    with pytest.raises(ChartRendererContractError, match="cannot exceed"):
        RendererBudget(max_objects=1, max_visible_objects=2)


if __name__ == "__main__":
    pytest.main([__file__])
