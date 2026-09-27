"""Offline chart UI view-model for renderer, AI, explainability and alerts.

The chart contracts are the source of truth for semantics.  This module only
projects already-validated packets into one bounded, flat-first view-model for
the chart shell and inspector panels.  It never calculates an event, calls a
provider, emits a notification, or grants broker/order authority.

Every optional panel has an explicit state.  Missing or invalid advisory data
is represented as unavailable/unknown instead of being rendered as a zero or
as a successful result.  The renderer scope (source, cutoff and indicator
revision) is carried into the model and must match any attached inspector or
alert evaluation.
"""

from __future__ import annotations

import copy
from collections.abc import Mapping
from typing import Any

from .chart_ai_contract import (
    ChartAIContractError,
    ChartAIRequest,
    validate_chart_ai_request,
    validate_chart_ai_response,
)
from .chart_alert_contract import (
    AlertLedger,
    ChartAlertContractError,
    input_snapshot_sha256,
    rule_sha256,
    validate_alert_receipt,
    validate_alert_rule,
)
from .chart_explainability_contract import (
    ChartExplainabilityError,
    validate_chart_explanation,
)
from .chart_renderer_contract import RenderPlan


UI_SCHEMA = "chart-ui-state-v1"
UI_MODE = "PREP_ONLY"
UI_ENGINE = "offline-view-model"


class ChartUIContractError(ValueError):
    """Raised when a chart view-model cannot be bound to one causal scope."""


def _strict_int(value: Any, name: str, *, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise ChartUIContractError(f"{name} must be an integer >= {minimum}")
    return value


def _digest(value: Any, name: str) -> str:
    if not isinstance(value, str) or len(value) != 64:
        raise ChartUIContractError(f"{name} must be a SHA-256 hex digest")
    normalized = value.lower()
    if any(character not in "0123456789abcdef" for character in normalized):
        raise ChartUIContractError(f"{name} must be a SHA-256 hex digest")
    return normalized


def _json_copy(value: Any) -> Any:
    try:
        return copy.deepcopy(value)
    except (TypeError, ValueError, RecursionError) as exc:
        raise ChartUIContractError("chart UI payload must be copyable JSON data") from exc


_FORBIDDEN_KEYS = {
    "api_key",
    "access_token",
    "authorization",
    "broker_credentials",
    "broker_action",
    "broker_request",
    "holdout_bars",
    "holdout_content",
    "live_order",
    "order_send",
    "place_order",
    "password",
    "private_key",
    "secret",
}


def _assert_safe_json(value: Any, *, path: str = "payload") -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            normalized = str(key).strip().lower().replace("-", "_")
            if normalized in _FORBIDDEN_KEYS:
                raise ChartUIContractError(f"{path}.{key} is forbidden")
            _assert_safe_json(child, path=f"{path}.{key}")
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            _assert_safe_json(child, path=f"{path}[{index}]")


def _render_plan_payload(plan: RenderPlan | Mapping[str, Any]) -> dict[str, Any]:
    if isinstance(plan, RenderPlan):
        payload = plan.as_dict()
    elif isinstance(plan, Mapping):
        payload = _json_copy(dict(plan))
    else:
        raise ChartUIContractError("render_plan must be RenderPlan or an object")
    _assert_safe_json(payload, path="render_plan")

    required = {
        "schema",
        "mode",
        "engine",
        "source",
        "cutoff_timestamp",
        "indicator_sha256",
        "viewport",
        "budget",
        "objects",
        "operations",
        "stale_cleanup",
        "stats",
        "next_state",
    }
    if set(payload) != required:
        missing = sorted(required - set(payload))
        unknown = sorted(set(payload) - required)
        raise ChartUIContractError(f"render plan fields mismatch: missing={missing}, unknown={unknown}")
    if payload["schema"] != "chart-render-plan-v1" or payload["mode"] != UI_MODE:
        raise ChartUIContractError("render plan schema or mode is unsupported")
    if payload["engine"] != "offline-reconcile":
        raise ChartUIContractError("render plan engine is unsupported")
    if not isinstance(payload["source"], Mapping) or not payload["source"]:
        raise ChartUIContractError("render plan source must be a non-empty object")
    cutoff = _strict_int(payload["cutoff_timestamp"], "render_plan.cutoff_timestamp", minimum=1)
    indicator_sha256 = _digest(payload["indicator_sha256"], "render_plan.indicator_sha256")
    viewport = payload["viewport"]
    budget = payload["budget"]
    if not isinstance(viewport, Mapping) or not isinstance(budget, Mapping):
        raise ChartUIContractError("render plan viewport and budget must be objects")
    max_objects = _strict_int(budget.get("max_objects"), "render_plan.budget.max_objects", minimum=1)
    max_visible = _strict_int(
        budget.get("max_visible_objects"),
        "render_plan.budget.max_visible_objects",
        minimum=1,
    )
    if max_visible > max_objects:
        raise ChartUIContractError("render plan visible budget exceeds object budget")
    objects = payload["objects"]
    operations = payload["operations"]
    if not isinstance(objects, list) or len(objects) > max_objects:
        raise ChartUIContractError("render plan objects exceed its bounded budget")
    if not isinstance(operations, list):
        raise ChartUIContractError("render plan operations must be an array")
    stats = payload["stats"]
    if not isinstance(stats, Mapping):
        raise ChartUIContractError("render plan stats must be an object")
    stat_names = {
        "objects_received",
        "objects_registered",
        "objects_visible",
        "objects_hidden",
        "objects_evicted",
        "objects_stale_removed",
        "objects_scope_reset",
        "objects_undone",
        "operations",
    }
    if set(stats) != stat_names:
        raise ChartUIContractError("render plan stats fields are unsupported")
    for name in stat_names:
        _strict_int(stats[name], f"render_plan.stats.{name}", minimum=0)
    object_ids: set[str] = set()
    for index, item in enumerate(objects):
        if not isinstance(item, Mapping):
            raise ChartUIContractError(f"render_plan.objects[{index}] must be an object")
        object_id = item.get("object_id")
        if not isinstance(object_id, str) or not object_id:
            raise ChartUIContractError(f"render_plan.objects[{index}].object_id is required")
        if object_id in object_ids:
            raise ChartUIContractError("render plan contains duplicate object IDs")
        object_ids.add(object_id)
        if item.get("status") not in {"preview", "committed"}:
            raise ChartUIContractError("render plan object status is unsupported")
        _strict_int(item.get("revision"), f"render_plan.objects[{index}].revision", minimum=1)
        if type(item.get("visible")) is not bool:
            raise ChartUIContractError("render plan object visibility must be boolean")
        if item.get("cutoff_timestamp") != cutoff:
            raise ChartUIContractError("render plan object cutoff does not match scope")
        if item.get("indicator_sha256") != indicator_sha256:
            raise ChartUIContractError("render plan object indicator hash does not match scope")
    state = payload["next_state"]
    if not isinstance(state, Mapping):
        raise ChartUIContractError("render plan next_state must be an object")
    if state.get("schema") != "chart-render-state-v1" or state.get("mode") != UI_MODE:
        raise ChartUIContractError("render plan next_state schema or mode is unsupported")
    if state.get("source") != payload["source"] or state.get("cutoff_timestamp") != cutoff:
        raise ChartUIContractError("render plan next_state is outside the render scope")
    if state.get("indicator_sha256") != indicator_sha256:
        raise ChartUIContractError("render plan next_state indicator hash does not match scope")
    _strict_int(state.get("generation"), "render_plan.next_state.generation", minimum=0)
    state_objects = state.get("objects")
    if not isinstance(state_objects, Mapping) or set(state_objects) != object_ids:
        raise ChartUIContractError("render plan next_state objects do not match the plan")
    if not isinstance(state.get("tombstones"), Mapping):
        raise ChartUIContractError("render plan next_state tombstones must be an object")
    if object_ids.intersection(state["tombstones"]):
        raise ChartUIContractError("render plan next_state object is also tombstoned")
    visible_count = sum(1 for item in objects if item["visible"])
    if stats["objects_registered"] != len(objects) or stats["objects_visible"] != visible_count:
        raise ChartUIContractError("render plan stats do not match objects")
    if stats["objects_hidden"] != len(objects) - visible_count or stats["operations"] != len(operations):
        raise ChartUIContractError("render plan stats do not match operations")
    return payload


def _unavailable(reason: str) -> dict[str, Any]:
    return {"status": "unavailable", "reason": reason}


def _ai_panel(
    response: Mapping[str, Any] | None,
    request: ChartAIRequest | Mapping[str, Any] | None,
    *,
    cutoff: int,
) -> dict[str, Any]:
    if response is None:
        return _unavailable("not_requested")
    if request is None:
        return {"status": "invalid_context", "reason": "request_required"}
    try:
        normalized_request = (
            request
            if isinstance(request, ChartAIRequest)
            else validate_chart_ai_request(request)
        )
        request_cutoff = (
            normalized_request.cursor_or_cutoff
            if isinstance(normalized_request, ChartAIRequest)
            else normalized_request["cursor_or_cutoff"]
        )
        if request_cutoff != cutoff:
            return {"status": "stale", "reason": "cutoff_mismatch"}
        normalized_response = validate_chart_ai_response(response, normalized_request)
    except (ChartAIContractError, TypeError, ValueError) as exc:
        return {"status": "invalid_context", "reason": "response_rejected", "detail": str(exc)}
    result = normalized_response["result"]
    return {
        "status": normalized_response["status"],
        "request_id": normalized_response["request_id"],
        "context_hash": normalized_response["context_hash"],
        "provider": normalized_response["provider"],
        "model": normalized_response["model"],
        "claim": result["claim"],
        "summary": result["summary"],
        "uncertainty": result["uncertainty"],
        "action": result["action"],
        "invalid_if": list(result["invalid_if"]),
        "evidence_event_ids": list(normalized_response["evidence_event_ids"]),
        "evidence_bar_ids": list(normalized_response["evidence_bar_ids"]),
        "reason_code": normalized_response.get("reason_code"),
        "execution_capability": False,
        "write_authority": False,
    }


def _explanation_panel(
    explanation: Mapping[str, Any] | None,
    *,
    render_source: Mapping[str, Any],
    cutoff: int,
) -> dict[str, Any]:
    if explanation is None:
        return _unavailable("not_requested")
    try:
        normalized = validate_chart_explanation(explanation)
    except (ChartExplainabilityError, TypeError, ValueError) as exc:
        return {"status": "unknown", "reason": "packet_rejected", "detail": str(exc)}
    if normalized["cutoff_timestamp"] != cutoff:
        return {"status": "stale", "reason": "cutoff_mismatch"}
    provenance_source = normalized["provenance"].get("source")
    if provenance_source != dict(render_source):
        return {"status": "stale", "reason": "source_mismatch"}
    event = normalized["event"]
    return {
        "status": "ready",
        "event_id": event["event_id"],
        "kind": event["kind"],
        "direction": event["direction"],
        "instrument_id": event["instrument_id"],
        "known_at": event["known_at"],
        "source_bar_ids": list(event["source_bar_ids"]),
        "rule": copy.deepcopy(normalized["rule"]),
        "source_bars": copy.deepcopy(normalized["source_bars"]),
        "invalidation": copy.deepcopy(normalized["invalidation"]),
        "recompute": copy.deepcopy(normalized["recompute"]),
        "provenance": copy.deepcopy(normalized["provenance"]),
    }


def _alert_panel(evaluation: Any, *, cutoff: int) -> dict[str, Any]:
    if evaluation is None:
        return _unavailable("not_requested")
    if hasattr(evaluation, "as_dict") and callable(evaluation.as_dict):
        evaluation = evaluation.as_dict()
    if not isinstance(evaluation, Mapping):
        return {"status": "unknown", "reason": "evaluation_rejected"}
    payload = dict(evaluation)
    required = {"schema", "mode", "engine", "rule_snapshot", "rule_sha256", "input_snapshot", "input_snapshot_sha256", "cutoff_timestamp", "as_of_timestamp", "emitted", "suppressed", "next_ledger"}
    if set(payload) != required:
        return {"status": "unknown", "reason": "evaluation_fields_rejected"}
    if payload["schema"] != "chart-alert-evaluation-v1" or payload["mode"] != UI_MODE or payload["engine"] != "offline-advisory":
        return {"status": "unknown", "reason": "evaluation_identity_rejected"}
    if payload["cutoff_timestamp"] != cutoff:
        return {"status": "stale", "reason": "cutoff_mismatch"}
    try:
        normalized_rule = validate_alert_rule(payload["rule_snapshot"])
        if rule_sha256(normalized_rule) != payload["rule_sha256"]:
            return {"status": "unknown", "reason": "rule_snapshot_mismatch"}
        if input_snapshot_sha256(payload["input_snapshot"]) != payload["input_snapshot_sha256"]:
            return {"status": "unknown", "reason": "input_snapshot_mismatch"}
        if payload["input_snapshot"].get("cutoff_timestamp") != cutoff:
            return {"status": "stale", "reason": "input_cutoff_mismatch"}
        ledger = AlertLedger.from_mapping(payload["next_ledger"])
        if ledger.rule_sha256 != payload["rule_sha256"]:
            return {"status": "unknown", "reason": "ledger_rule_mismatch"}
    except (ChartAlertContractError, TypeError, ValueError) as exc:
        return {"status": "unknown", "reason": "evaluation_rejected", "detail": str(exc)}
    emitted = payload["emitted"]
    suppressed = payload["suppressed"]
    if not isinstance(emitted, list) or not isinstance(suppressed, list):
        return {"status": "unknown", "reason": "evaluation_items_rejected"}
    try:
        receipts = [validate_alert_receipt(item) for item in emitted]
    except (ChartAlertContractError, TypeError, ValueError) as exc:
        return {"status": "unknown", "reason": "receipt_rejected", "detail": str(exc)}
    return {
        "status": "ready" if receipts else "empty",
        "delivery": "local_advisory",
        "rule_id": payload["rule_snapshot"]["rule_id"],
        "rule_version": payload["rule_snapshot"]["version"],
        "rule_sha256": payload["rule_sha256"],
        "cutoff_timestamp": cutoff,
        "receipts": copy.deepcopy(receipts),
        "suppressed": copy.deepcopy(suppressed),
        "execution_capability": False,
        "order_effect": "none",
        "fill_effect": "none",
    }


def build_chart_ui_state(
    render_plan: RenderPlan | Mapping[str, Any],
    *,
    ai_request: ChartAIRequest | Mapping[str, Any] | None = None,
    ai_response: Mapping[str, Any] | None = None,
    explanation: Mapping[str, Any] | None = None,
    alert_evaluation: Any = None,
) -> dict[str, Any]:
    """Project validated chart packets into one UI-safe, causal view-model."""

    plan = _render_plan_payload(render_plan)
    cutoff = plan["cutoff_timestamp"]
    state = plan["next_state"]
    stats = plan["stats"]
    return {
        "schema": UI_SCHEMA,
        "mode": UI_MODE,
        "engine": UI_ENGINE,
        "capabilities": {
            "annotation_preview": True,
            "annotation_write_authority": False,
            "broker_execution": False,
            "external_alert_delivery": False,
        },
        "scope": {
            "source": _json_copy(plan["source"]),
            "cutoff_timestamp": cutoff,
            "indicator_sha256": plan["indicator_sha256"],
            "renderer_generation": state["generation"],
        },
        "renderer": {
            "status": "ready" if stats.get("objects_registered", 0) else "empty",
            "viewport": _json_copy(plan["viewport"]),
            "budget": _json_copy(plan["budget"]),
            "objects": _json_copy(plan["objects"]),
            "operations": _json_copy(plan["operations"]),
            "stale_cleanup": _json_copy(plan["stale_cleanup"]),
            "stats": _json_copy(stats),
        },
        "ai": _ai_panel(ai_response, ai_request, cutoff=cutoff),
        "explainability": _explanation_panel(
            explanation,
            render_source=plan["source"],
            cutoff=cutoff,
        ),
        "alerts": _alert_panel(alert_evaluation, cutoff=cutoff),
    }


__all__ = ["ChartUIContractError", "UI_ENGINE", "UI_MODE", "UI_SCHEMA", "build_chart_ui_state"]
