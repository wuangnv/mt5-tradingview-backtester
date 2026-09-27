"""Offline visible-range seam for browser chart adapters.

The browser only supplies a bounded viewport and an optimistic renderer
generation.  This module binds that request to the canonical overlay packet
before calling the existing renderer contract.  It deliberately has no
browser/SDK, provider, network, persistence, broker, or order dependency.
"""

from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass
from typing import Any, Literal, Mapping

from .chart_overlay_contract import ChartOverlayContractError, validate_overlay_packet
from .chart_renderer_contract import (
    ChartRendererContractError,
    RenderPlan,
    RendererBudget,
    RendererState,
    RendererViewport,
    build_render_plan,
)


VISIBLE_RANGE_REQUEST_SCHEMA = "chart-visible-range-request-v1"
VISIBLE_RANGE_RESPONSE_SCHEMA = "chart-visible-range-response-v1"
VISIBLE_RANGE_MODE = "PREP_ONLY"
VISIBLE_RANGE_ADAPTER = "browser-visible-range"
_HASH_RE = re.compile(r"^[0-9a-f]{64}$", re.IGNORECASE)
_REQUEST_FIELDS = {
    "schema",
    "mode",
    "adapter",
    "request_id",
    "source",
    "cutoff_timestamp",
    "indicator_sha256",
    "viewport",
    "expected_generation",
}
_SOURCE_FIELDS = {"kind", "id", "dataset_id", "dataset_sha256"}


class VisibleRangeAdapterError(ValueError):
    """Raised when a visible-range request is not a trusted typed packet."""


def _text(value: Any, name: str, *, maximum: int = 128) -> str:
    if not isinstance(value, str) or not value.strip():
        raise VisibleRangeAdapterError(f"{name} is required")
    result = value.strip()
    if len(result) > maximum:
        raise VisibleRangeAdapterError(f"{name} is too long")
    return result


def _strict_int(value: Any, name: str, *, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise VisibleRangeAdapterError(f"{name} must be an integer >= {minimum}")
    return value


def _finite_json(value: Any, name: str) -> None:
    try:
        json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True)
    except (TypeError, ValueError, RecursionError) as exc:
        raise VisibleRangeAdapterError(f"{name} must be finite JSON") from exc


def _source(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise VisibleRangeAdapterError("source must be an object")
    unknown = set(value) - _SOURCE_FIELDS
    if unknown:
        raise VisibleRangeAdapterError(f"source has unsupported fields: {sorted(unknown)}")
    result: dict[str, Any] = {
        "kind": _text(value.get("kind"), "source.kind", maximum=64),
        "id": _text(value.get("id"), "source.id"),
    }
    for key, maximum in (("dataset_id", 128), ("dataset_sha256", 64)):
        if key not in value:
            continue
        normalized = _text(value[key], f"source.{key}", maximum=maximum)
        if key == "dataset_sha256":
            normalized = normalized.lower()
        if key == "dataset_sha256" and not _HASH_RE.fullmatch(normalized):
            raise VisibleRangeAdapterError("source.dataset_sha256 must be a SHA-256 hex digest")
        result[key] = normalized
    _finite_json(result, "source")
    return result


def _hash(value: Any) -> str:
    result = _text(value, "indicator_sha256", maximum=64).lower()
    if not _HASH_RE.fullmatch(result):
        raise VisibleRangeAdapterError("indicator_sha256 must be a SHA-256 hex digest")
    return result


@dataclass(frozen=True)
class VisibleRangeRequest:
    """Typed browser viewport request bound to one chart source/cutoff."""

    request_id: str
    source: dict[str, Any]
    cutoff_timestamp: int
    indicator_sha256: str
    viewport: RendererViewport
    expected_generation: int | None = None
    schema: str = VISIBLE_RANGE_REQUEST_SCHEMA
    mode: str = VISIBLE_RANGE_MODE
    adapter: str = VISIBLE_RANGE_ADAPTER

    def __post_init__(self) -> None:
        if self.schema != VISIBLE_RANGE_REQUEST_SCHEMA:
            raise VisibleRangeAdapterError("request schema is unsupported")
        if self.mode != VISIBLE_RANGE_MODE:
            raise VisibleRangeAdapterError("request must remain PREP_ONLY")
        if self.adapter != VISIBLE_RANGE_ADAPTER:
            raise VisibleRangeAdapterError("request adapter is unsupported")
        object.__setattr__(self, "request_id", _text(self.request_id, "request_id"))
        object.__setattr__(self, "source", _source(self.source))
        object.__setattr__(
            self,
            "cutoff_timestamp",
            _strict_int(self.cutoff_timestamp, "cutoff_timestamp", minimum=1),
        )
        object.__setattr__(self, "indicator_sha256", _hash(self.indicator_sha256))
        if isinstance(self.viewport, Mapping):
            object.__setattr__(self, "viewport", RendererViewport(**dict(self.viewport)))
        if not isinstance(self.viewport, RendererViewport):
            raise VisibleRangeAdapterError("viewport must be RendererViewport")
        if self.expected_generation is not None:
            object.__setattr__(
                self,
                "expected_generation",
                _strict_int(self.expected_generation, "expected_generation"),
            )

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "VisibleRangeRequest":
        if not isinstance(payload, Mapping):
            raise VisibleRangeAdapterError("request must be an object")
        unknown = set(payload) - _REQUEST_FIELDS
        missing = _REQUEST_FIELDS - set(payload)
        if unknown:
            raise VisibleRangeAdapterError(f"request has unsupported fields: {sorted(unknown)}")
        if missing:
            raise VisibleRangeAdapterError(f"request missing fields: {sorted(missing)}")
        try:
            source = payload["source"]
            viewport = payload["viewport"]
            if not isinstance(source, Mapping) or not isinstance(viewport, Mapping):
                raise VisibleRangeAdapterError("source and viewport must be objects")
            return cls(
                request_id=payload["request_id"],
                source=dict(source),
                cutoff_timestamp=payload["cutoff_timestamp"],
                indicator_sha256=payload["indicator_sha256"],
                viewport=RendererViewport(**dict(viewport)),
                expected_generation=payload["expected_generation"],
                schema=payload["schema"],
                mode=payload["mode"],
                adapter=payload["adapter"],
            )
        except (TypeError, ValueError) as exc:
            if isinstance(exc, VisibleRangeAdapterError):
                raise
            raise VisibleRangeAdapterError(str(exc)) from exc

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema": self.schema,
            "mode": self.mode,
            "adapter": self.adapter,
            "request_id": self.request_id,
            "source": copy.deepcopy(self.source),
            "cutoff_timestamp": self.cutoff_timestamp,
            "indicator_sha256": self.indicator_sha256,
            "viewport": self.viewport.as_dict(),
            "expected_generation": self.expected_generation,
        }


@dataclass(frozen=True)
class VisibleRangeResponse:
    """Typed local result; rejected responses never contain a render plan."""

    request: VisibleRangeRequest
    status: Literal["ok", "rejected"]
    reason: str | None
    plan: RenderPlan | None

    def __post_init__(self) -> None:
        if self.status not in {"ok", "rejected"}:
            raise VisibleRangeAdapterError("response status is unsupported")
        if self.status == "ok" and self.plan is None:
            raise VisibleRangeAdapterError("ok response requires a render plan")
        if self.status == "rejected" and self.plan is not None:
            raise VisibleRangeAdapterError("rejected response cannot contain a render plan")
        if self.status == "ok" and self.reason is not None:
            raise VisibleRangeAdapterError("ok response cannot contain a rejection reason")
        if self.status == "rejected" and not self.reason:
            raise VisibleRangeAdapterError("rejected response requires a reason")

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema": VISIBLE_RANGE_RESPONSE_SCHEMA,
            "mode": VISIBLE_RANGE_MODE,
            "adapter": VISIBLE_RANGE_ADAPTER,
            "request_id": self.request.request_id,
            "status": self.status,
            "reason": self.reason,
            "request": self.request.as_dict(),
            "plan": self.plan.as_dict() if self.plan is not None else None,
        }


def _rejected(request: VisibleRangeRequest, reason: str) -> VisibleRangeResponse:
    return VisibleRangeResponse(request=request, status="rejected", reason=reason, plan=None)


def adapt_visible_range(
    packet: Mapping[str, Any],
    request: VisibleRangeRequest | Mapping[str, Any],
    *,
    previous_state: RendererState | None = None,
    budget: RendererBudget | None = None,
) -> VisibleRangeResponse:
    """Build one deterministic plan for the requested browser-visible range.

    Scope or generation mismatches are returned as typed rejections before any
    renderer operation is produced.  This makes a future browser callback
    replaceable without giving it chart, provider, or execution authority.
    """

    normalized_request = (
        request
        if isinstance(request, VisibleRangeRequest)
        else VisibleRangeRequest.from_payload(request)
    )
    if normalized_request.expected_generation is not None:
        current_generation = previous_state.generation if previous_state is not None else 0
        if normalized_request.expected_generation != current_generation:
            return _rejected(normalized_request, "generation_conflict")
    try:
        normalized_packet = validate_overlay_packet(dict(packet))
    except (ChartOverlayContractError, TypeError, ValueError):
        return _rejected(normalized_request, "invalid_packet")
    if (
        normalized_request.source != normalized_packet["source"]
        or normalized_request.cutoff_timestamp != normalized_packet["cutoff_timestamp"]
        or normalized_request.indicator_sha256 != normalized_packet["indicator_sha256"]
    ):
        return _rejected(normalized_request, "scope_mismatch")
    try:
        plan = build_render_plan(
            normalized_packet,
            previous_state=previous_state,
            viewport=normalized_request.viewport,
            budget=budget,
        )
    except ChartRendererContractError:
        return _rejected(normalized_request, "render_rejected")
    return VisibleRangeResponse(request=normalized_request, status="ok", reason=None, plan=plan)


__all__ = [
    "VISIBLE_RANGE_ADAPTER",
    "VISIBLE_RANGE_MODE",
    "VISIBLE_RANGE_REQUEST_SCHEMA",
    "VISIBLE_RANGE_RESPONSE_SCHEMA",
    "VisibleRangeAdapterError",
    "VisibleRangeRequest",
    "VisibleRangeResponse",
    "adapt_visible_range",
]
