"""Offline renderer contract for causal chart overlays.

The canonical chart engine emits validated overlay packets, while a renderer
is responsible only for deciding which objects are visible and reconciling
them with a local chart surface.  This module is deliberately provider-free:
it does not import a chart SDK, call a browser, create an MQL5 object, request
AI output, or send an order.

The packet passed to :func:`build_render_plan` is a *full snapshot* for the
same source/cutoff.  A plan is therefore safe to apply as a reconciliation
batch: objects absent from the new packet are stale and are removed.  The
returned state keeps hidden objects and tombstones so a later viewport change
cannot resurrect an older revision silently.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any, Mapping

from .chart_overlay_contract import (
    ChartOverlayContractError,
    validate_overlay_packet,
)


RENDER_PLAN_SCHEMA = "chart-render-plan-v1"
RENDER_STATE_SCHEMA = "chart-render-state-v1"
RENDERER_MODE = "PREP_ONLY"
RENDERER_ENGINE = "offline-reconcile"
_ACTIVE_STATUSES = {"preview", "committed"}
_LIFECYCLE_STATUSES = {"preview", "committed", "undone"}
_CAUSAL_FIELDS = ("known_at", "source_bar_ids", "confirmation_lag_bars")


class ChartRendererContractError(ValueError):
    """Raised when a renderer transition would be ambiguous or stale."""


def _strict_int(value: Any, name: str, *, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise ChartRendererContractError(f"{name} must be an integer >= {minimum}")
    return value


def _as_bool(value: Any, name: str) -> bool:
    if type(value) is not bool:
        raise ChartRendererContractError(f"{name} must be boolean")
    return value


@dataclass(frozen=True)
class RendererBudget:
    """Hard limits for one renderer surface.

    ``max_objects`` bounds the registered objects even when they are outside
    the viewport.  ``max_visible_objects`` bounds objects that an adapter may
    paint in one batch.  The latter cannot exceed the former; this prevents a
    renderer from hiding an object-cap violation behind viewport filtering.
    """

    max_objects: int = 256
    max_visible_objects: int = 256

    def __post_init__(self) -> None:
        _strict_int(self.max_objects, "max_objects", minimum=1)
        _strict_int(self.max_visible_objects, "max_visible_objects", minimum=1)
        if self.max_visible_objects > self.max_objects:
            raise ChartRendererContractError(
                "max_visible_objects cannot exceed max_objects"
            )

    def as_dict(self) -> dict[str, int]:
        return {
            "max_objects": self.max_objects,
            "max_visible_objects": self.max_visible_objects,
        }


@dataclass(frozen=True)
class RendererViewport:
    """Inclusive UTC timestamp window used for visibility filtering."""

    start_timestamp: int | None = None
    end_timestamp: int | None = None

    def __post_init__(self) -> None:
        if self.start_timestamp is not None:
            _strict_int(self.start_timestamp, "viewport.start_timestamp", minimum=1)
        if self.end_timestamp is not None:
            _strict_int(self.end_timestamp, "viewport.end_timestamp", minimum=1)
        if (
            self.start_timestamp is not None
            and self.end_timestamp is not None
            and self.start_timestamp > self.end_timestamp
        ):
            raise ChartRendererContractError(
                "viewport.start_timestamp cannot exceed end_timestamp"
            )

    def intersects(self, start_timestamp: int, end_timestamp: int) -> bool:
        if (
            self.start_timestamp is not None
            and end_timestamp < self.start_timestamp
        ):
            return False
        if self.end_timestamp is not None and start_timestamp > self.end_timestamp:
            return False
        return True

    def as_dict(self) -> dict[str, int | None]:
        return {
            "start_timestamp": self.start_timestamp,
            "end_timestamp": self.end_timestamp,
        }


@dataclass
class RendererState:
    """Local reconciliation state; never a broker or event-store authority."""

    generation: int = 0
    objects: dict[str, dict[str, Any]] = field(default_factory=dict)
    tombstones: dict[str, int] = field(default_factory=dict)
    source: dict[str, Any] | None = None
    cutoff_timestamp: int | None = None
    indicator_sha256: str | None = None

    def __post_init__(self) -> None:
        _strict_int(self.generation, "state.generation", minimum=0)
        if not isinstance(self.objects, dict) or not isinstance(self.tombstones, dict):
            raise ChartRendererContractError("state objects and tombstones must be objects")
        if self.source is not None and not isinstance(self.source, dict):
            raise ChartRendererContractError("state.source must be an object or null")
        if self.cutoff_timestamp is not None:
            _strict_int(self.cutoff_timestamp, "state.cutoff_timestamp", minimum=1)
        if self.indicator_sha256 is not None:
            if (
                not isinstance(self.indicator_sha256, str)
                or len(self.indicator_sha256) != 64
                or any(character not in "0123456789abcdef" for character in self.indicator_sha256.lower())
            ):
                raise ChartRendererContractError("state.indicator_sha256 must be a SHA-256 hex digest")
            self.indicator_sha256 = self.indicator_sha256.lower()
        self.source = copy.deepcopy(self.source) if self.source is not None else None
        normalized_objects: dict[str, dict[str, Any]] = {}
        for object_id, value in self.objects.items():
            if not isinstance(object_id, str) or not object_id:
                raise ChartRendererContractError("state object IDs must be non-empty strings")
            if not isinstance(value, dict):
                raise ChartRendererContractError("state object values must be objects")
            if value.get("object_id") != object_id:
                raise ChartRendererContractError("state object_id key mismatch")
            if value.get("status") not in _ACTIVE_STATUSES:
                raise ChartRendererContractError("state objects must be active overlays")
            _strict_int(value.get("revision"), f"state.objects[{object_id}].revision", minimum=1)
            _as_bool(value.get("visible"), f"state.objects[{object_id}].visible")
            normalized_objects[object_id] = copy.deepcopy(value)
        normalized_tombstones: dict[str, int] = {}
        for object_id, revision in self.tombstones.items():
            if not isinstance(object_id, str) or not object_id:
                raise ChartRendererContractError("state tombstone IDs must be non-empty strings")
            if object_id in normalized_objects:
                raise ChartRendererContractError("state object cannot also be tombstoned")
            normalized_tombstones[object_id] = _strict_int(
                revision, f"state.tombstones[{object_id}]", minimum=1
            )
        self.objects = normalized_objects
        self.tombstones = normalized_tombstones

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema": RENDER_STATE_SCHEMA,
            "mode": RENDERER_MODE,
            "engine": RENDERER_ENGINE,
            "generation": self.generation,
            "source": copy.deepcopy(self.source),
            "cutoff_timestamp": self.cutoff_timestamp,
            "indicator_sha256": self.indicator_sha256,
            "objects": copy.deepcopy(self.objects),
            "tombstones": dict(sorted(self.tombstones.items())),
        }


@dataclass(frozen=True)
class RenderPlan:
    """A deterministic renderer patch and the state after applying it."""

    source: dict[str, Any]
    cutoff_timestamp: int
    indicator_sha256: str
    viewport: RendererViewport
    budget: RendererBudget
    objects: tuple[dict[str, Any], ...]
    operations: tuple[dict[str, Any], ...]
    stale_cleanup: dict[str, Any]
    stats: dict[str, int]
    next_state: RendererState

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema": RENDER_PLAN_SCHEMA,
            "mode": RENDERER_MODE,
            "engine": RENDERER_ENGINE,
            "source": copy.deepcopy(self.source),
            "cutoff_timestamp": self.cutoff_timestamp,
            "indicator_sha256": self.indicator_sha256,
            "viewport": self.viewport.as_dict(),
            "budget": self.budget.as_dict(),
            "objects": copy.deepcopy(list(self.objects)),
            "operations": copy.deepcopy(list(self.operations)),
            "stale_cleanup": copy.deepcopy(self.stale_cleanup),
            "stats": dict(self.stats),
            "next_state": self.next_state.as_dict(),
        }


def _overlay_span(overlay: Mapping[str, Any]) -> tuple[int, int]:
    anchors = overlay.get("anchors")
    if not isinstance(anchors, list) or not anchors:
        raise ChartRendererContractError("overlay anchors are required")
    timestamps = [
        _strict_int(anchor.get("timestamp"), "overlay anchor timestamp", minimum=1)
        for anchor in anchors
    ]
    return min(timestamps), max(timestamps)


def _render_object(
    overlay: Mapping[str, Any],
    *,
    indicator: Mapping[str, Any],
    source: Mapping[str, Any],
    cutoff_timestamp: int,
    viewport: RendererViewport,
) -> dict[str, Any]:
    start_timestamp, end_timestamp = _overlay_span(overlay)
    object_id = overlay["overlay_id"]
    if not isinstance(object_id, str) or not object_id:
        raise ChartRendererContractError("overlay_id must be a non-empty string")
    status = overlay["status"]
    if status not in _ACTIVE_STATUSES:
        raise ChartRendererContractError("only active overlays can become renderer objects")
    visible = viewport.intersects(start_timestamp, end_timestamp)
    result: dict[str, Any] = {
        "object_id": object_id,
        "overlay_id": object_id,
        "kind": overlay["kind"],
        "layer": indicator["indicator_id"],
        "instrument_id": overlay["instrument_id"],
        "display_timeframe_seconds": overlay["display_timeframe_seconds"],
        "cutoff_timestamp": cutoff_timestamp,
        "source": copy.deepcopy(dict(source)),
        "anchors": copy.deepcopy(overlay["anchors"]),
        "status": status,
        "revision": overlay["revision"],
        "confidence": copy.deepcopy(overlay["confidence"]),
        "repaint": copy.deepcopy(overlay["repaint"]),
        "indicator_sha256": overlay["indicator_sha256"],
        "cache_key": overlay["cache_key"],
        "span_start_timestamp": start_timestamp,
        "span_end_timestamp": end_timestamp,
        "visible": visible,
    }
    if "label" in overlay:
        result["label"] = overlay["label"]
    # Preserve causal event metadata for browser/MQL adapters.  The renderer
    # may project an object, but it must not erase when the event became known
    # or which source bars justified it.
    for field in _CAUSAL_FIELDS:
        if field in overlay:
            result[field] = copy.deepcopy(overlay[field])
    return result


def _identity_without_visibility(value: Mapping[str, Any]) -> dict[str, Any]:
    result = copy.deepcopy(dict(value))
    result.pop("visible", None)
    return result


def _priority(value: Mapping[str, Any]) -> tuple[int, int, int, str]:
    # Committed objects win over previews; within a status, the most recent
    # anchor/revision wins.  The ID is a deterministic final tie-breaker.
    return (
        1 if value["status"] == "committed" else 0,
        int(value["span_end_timestamp"]),
        int(value["revision"]),
        str(value["object_id"]),
    )


def _operation(
    op: str,
    object_id: str,
    *,
    reason: str,
    revision: int | None = None,
    object_value: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "op": op,
        "object_id": object_id,
        "reason": reason,
    }
    if revision is not None:
        result["revision"] = revision
    # Adapters commonly consume the operation stream without retaining the
    # object snapshot.  Carry the same causal fields on mutating operations so
    # they cannot accidentally infer event time from a plotted anchor.
    if object_value is not None and all(field in object_value for field in _CAUSAL_FIELDS):
        for field in _CAUSAL_FIELDS:
            result[field] = copy.deepcopy(object_value[field])
    return result


def transition_overlay_status(
    packet: Mapping[str, Any],
    overlay_id: str,
    target_status: str,
    *,
    expected_revision: int | None = None,
) -> dict[str, Any]:
    """Apply one explicit preview/accept/undo lifecycle transition.

    ``packet`` remains a full snapshot.  Every real transition increments the
    overlay revision, and undo records the exact revision it invalidates.  A
    same-state call is idempotent, which allows a reconnecting UI to retry a
    transition without creating another revision.
    """

    if not isinstance(overlay_id, str) or not overlay_id.strip():
        raise ChartRendererContractError("overlay_id must be a non-empty string")
    if target_status not in _LIFECYCLE_STATUSES:
        raise ChartRendererContractError("target_status is unsupported")
    try:
        normalized = validate_overlay_packet(dict(packet))
    except ChartOverlayContractError as exc:
        raise ChartRendererContractError("packet is not a valid overlay snapshot") from exc
    overlays = normalized["overlays"]
    matches = [item for item in overlays if item["overlay_id"] == overlay_id]
    if len(matches) != 1:
        raise ChartRendererContractError("overlay_id must identify exactly one overlay")
    current = matches[0]
    current_revision = _strict_int(current["revision"], "overlay.revision", minimum=1)
    if expected_revision is not None and expected_revision != current_revision:
        raise ChartRendererContractError(
            f"revision conflict: expected {expected_revision}, current {current_revision}"
        )
    current_status = current["status"]
    if target_status == current_status:
        return normalized
    allowed = {
        "preview": {"committed", "undone"},
        "committed": {"undone"},
        "undone": set(),
    }
    if target_status not in allowed[current_status]:
        raise ChartRendererContractError(
            f"invalid lifecycle transition {current_status}->{target_status}"
        )
    updated = copy.deepcopy(current)
    updated["status"] = target_status
    updated["revision"] = current_revision + 1
    if target_status == "undone":
        updated["undo_of_revision"] = current_revision
    else:
        updated.pop("undo_of_revision", None)
    normalized["overlays"] = [
        updated if item["overlay_id"] == overlay_id else item for item in overlays
    ]
    try:
        return validate_overlay_packet(normalized)
    except ChartOverlayContractError as exc:
        raise ChartRendererContractError("lifecycle transition produced an invalid packet") from exc


def preview_overlay(
    packet: Mapping[str, Any], overlay_id: str, *, expected_revision: int | None = None
) -> dict[str, Any]:
    """Idempotent helper naming the preview stage explicitly."""

    return transition_overlay_status(
        packet, overlay_id, "preview", expected_revision=expected_revision
    )


def accept_overlay(
    packet: Mapping[str, Any], overlay_id: str, *, expected_revision: int | None = None
) -> dict[str, Any]:
    """Accept a preview into the committed renderer lifecycle."""

    return transition_overlay_status(
        packet, overlay_id, "committed", expected_revision=expected_revision
    )


def undo_overlay(
    packet: Mapping[str, Any], overlay_id: str, *, expected_revision: int | None = None
) -> dict[str, Any]:
    """Undo a preview or committed overlay with an explicit tombstone revision."""

    return transition_overlay_status(
        packet, overlay_id, "undone", expected_revision=expected_revision
    )


def _validate_previous_state(state: RendererState) -> None:
    if not isinstance(state, RendererState):
        raise ChartRendererContractError("previous_state must be RendererState")


def build_render_plan(
    packet: Mapping[str, Any],
    *,
    previous_state: RendererState | None = None,
    viewport: RendererViewport | None = None,
    budget: RendererBudget | None = None,
) -> RenderPlan:
    """Build a bounded, deterministic renderer reconciliation plan.

    The returned ``next_state`` is suitable for the next call.  The plan is
    purely local and can be handed to either a TradingView adapter (marks and
    bounded shapes) or an MQL5 adapter (buffers and registry-prefixed objects)
    without changing event semantics.
    """

    try:
        normalized = validate_overlay_packet(dict(packet))
    except ChartOverlayContractError as exc:
        raise ChartRendererContractError("packet is not a valid overlay snapshot") from exc
    if previous_state is not None:
        _validate_previous_state(previous_state)
    viewport = viewport or RendererViewport()
    budget = budget or RendererBudget()
    indicator = normalized["indicator"]
    source = normalized["source"]
    cutoff_timestamp = normalized["cutoff_timestamp"]
    active: dict[str, dict[str, Any]] = {}
    undone: dict[str, dict[str, Any]] = {}
    for overlay in normalized["overlays"]:
        if overlay["status"] == "undone":
            undone[overlay["overlay_id"]] = overlay
        else:
            active[overlay["overlay_id"]] = _render_object(
                overlay,
                indicator=indicator,
                source=source,
                cutoff_timestamp=cutoff_timestamp,
                viewport=viewport,
            )

    scope_reset = bool(
        previous_state
        and previous_state.source is not None
        and (
            previous_state.source != source
            or previous_state.cutoff_timestamp != cutoff_timestamp
            or previous_state.indicator_sha256 != normalized["indicator_sha256"]
        )
    )
    previous_objects = (
        previous_state.objects if previous_state and not scope_reset else {}
    )
    previous_tombstones = (
        previous_state.tombstones if previous_state and not scope_reset else {}
    )
    scope_reset_ids = sorted(previous_state.objects) if scope_reset and previous_state else []
    # A scope reset intentionally clears the prior objects from reconciliation
    # and tombstone checks.  Keep a separate cleanup view, though: adapters
    # still need the old object's causal metadata when removing it from the
    # previous surface.  Dropping that snapshot would make a scope-reset
    # ``remove`` operation lose ``known_at`` and its source bars.
    cleanup_objects = previous_state.objects if previous_state else previous_objects
    for object_id, object_value in active.items():
        old = previous_objects.get(object_id)
        tombstone_revision = previous_tombstones.get(object_id)
        if tombstone_revision is not None and object_value["revision"] <= tombstone_revision:
            raise ChartRendererContractError(
                f"overlay {object_id} attempts to resurrect a stale revision"
            )
        if old is not None:
            old_revision = old["revision"]
            new_revision = object_value["revision"]
            if new_revision < old_revision:
                raise ChartRendererContractError(
                    f"overlay {object_id} revision regressed from {old_revision} to {new_revision}"
                )
            if new_revision == old_revision and (
                _identity_without_visibility(old)
                != _identity_without_visibility(object_value)
            ):
                raise ChartRendererContractError(
                    f"overlay {object_id} changed without a revision increment"
                )

    previous_ids = set(previous_objects)
    active_ids = set(active)
    undone_ids = set(undone)
    for object_id, overlay in undone.items():
        old = previous_objects.get(object_id)
        tombstone_revision = previous_tombstones.get(object_id)
        undo_of_revision = overlay.get("undo_of_revision")
        if old is not None:
            if undo_of_revision != old["revision"]:
                raise ChartRendererContractError(
                    f"undo for {object_id} does not match current revision"
                )
            if overlay["revision"] <= old["revision"]:
                raise ChartRendererContractError(
                    f"undo revision for {object_id} must increase current revision"
                )
        elif tombstone_revision is not None and overlay["revision"] <= tombstone_revision:
            raise ChartRendererContractError(
                f"undo for {object_id} is older than its tombstone"
            )

    candidates = list(active.values())
    ordered = sorted(candidates, key=_priority, reverse=True)
    selected = ordered[: budget.max_objects]
    selected_ids = {item["object_id"] for item in selected}
    evicted_ids = sorted(item["object_id"] for item in ordered[budget.max_objects :])
    visible_ordered = sorted(
        (item for item in selected if item["visible"]),
        key=_priority,
        reverse=True,
    )
    visible_ids = {item["object_id"] for item in visible_ordered[: budget.max_visible_objects]}
    for item in selected:
        item["visible"] = item["object_id"] in visible_ids
    next_objects = {item["object_id"]: item for item in selected}

    stale_ids = sorted(previous_ids - active_ids - undone_ids - selected_ids)
    budget_evicted_previous_ids = sorted((previous_ids & active_ids) - selected_ids)
    undo_removed_ids = sorted(previous_ids & undone_ids)
    remove_reasons = {
        object_id: "stale_snapshot" for object_id in stale_ids
    }
    remove_reasons.update({object_id: "scope_reset" for object_id in scope_reset_ids})
    remove_reasons.update(
        {object_id: "budget_evicted" for object_id in budget_evicted_previous_ids}
    )
    remove_reasons.update({object_id: "undo" for object_id in undo_removed_ids})

    operations: list[dict[str, Any]] = []
    for object_id in sorted(remove_reasons):
        old = cleanup_objects.get(object_id)
        operations.append(
            _operation(
                "remove",
                object_id,
                reason=remove_reasons[object_id],
                revision=old["revision"] if old else None,
                object_value=old,
            )
        )
    for object_id in sorted(next_objects):
        item = next_objects[object_id]
        old = previous_objects.get(object_id)
        if item["visible"]:
            if old is None or not old.get("visible"):
                reason = "new" if old is None else "viewport_visible"
                operations.append(
                    _operation(
                        "upsert",
                        object_id,
                        reason=reason,
                        revision=item["revision"],
                        object_value=item,
                    )
                )
            elif _identity_without_visibility(old) != _identity_without_visibility(item):
                operations.append(
                    _operation(
                        "upsert",
                        object_id,
                        reason="revision_update",
                        revision=item["revision"],
                        object_value=item,
                    )
                )
        elif old is not None and old.get("visible"):
            operations.append(
                _operation(
                    "hide",
                    object_id,
                    reason="viewport_or_visible_cap",
                    revision=item["revision"],
                    object_value=item,
                )
            )
    operations.sort(key=lambda value: (value["object_id"], value["op"], value["reason"]))

    next_tombstones = dict(previous_tombstones)
    for object_id in stale_ids:
        old = previous_objects.get(object_id)
        if old is not None:
            next_tombstones[object_id] = max(next_tombstones.get(object_id, 0), old["revision"])
    for object_id, overlay in undone.items():
        next_tombstones[object_id] = max(
            next_tombstones.get(object_id, 0), overlay["revision"]
        )
    for object_id in selected_ids:
        if object_id in next_tombstones and active[object_id]["revision"] > next_tombstones[object_id]:
            del next_tombstones[object_id]
    for object_id in selected_ids:
        next_tombstones.pop(object_id, None)
    next_state = RendererState(
        generation=(previous_state.generation + 1) if previous_state else 1,
        objects=next_objects,
        tombstones=next_tombstones,
        source=source,
        cutoff_timestamp=cutoff_timestamp,
        indicator_sha256=normalized["indicator_sha256"],
    )
    visible_count = sum(1 for item in selected if item["visible"])
    stats = {
        "objects_received": len(active),
        "objects_registered": len(selected),
        "objects_visible": visible_count,
        "objects_hidden": len(selected) - visible_count,
        "objects_evicted": len(evicted_ids),
        "objects_stale_removed": len(stale_ids),
        "objects_scope_reset": len(scope_reset_ids),
        "objects_undone": len(undone_ids),
        "operations": len(operations),
    }
    stale_cleanup = {
        "policy": "full_snapshot_reconcile",
        "stale_ids": stale_ids,
        "scope_reset_ids": scope_reset_ids,
        "undone_ids": sorted(undone_ids),
        "evicted_ids": evicted_ids,
        "removed_previous_ids": sorted(remove_reasons),
    }
    return RenderPlan(
        source=copy.deepcopy(source),
        cutoff_timestamp=cutoff_timestamp,
        indicator_sha256=normalized["indicator_sha256"],
        viewport=viewport,
        budget=budget,
        objects=tuple(copy.deepcopy(item) for item in selected),
        operations=tuple(copy.deepcopy(item) for item in operations),
        stale_cleanup=stale_cleanup,
        stats=stats,
        next_state=next_state,
    )


__all__ = [
    "ChartRendererContractError",
    "RENDER_PLAN_SCHEMA",
    "RENDER_STATE_SCHEMA",
    "RENDERER_ENGINE",
    "RENDERER_MODE",
    "RenderPlan",
    "RendererBudget",
    "RendererState",
    "RendererViewport",
    "accept_overlay",
    "build_render_plan",
    "preview_overlay",
    "transition_overlay_status",
    "undo_overlay",
]
