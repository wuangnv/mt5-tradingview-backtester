"""Fail-closed, provider-neutral AI-on-chart advisory contracts.

The deterministic chart engine remains the authority for bars, events, replay
cutoffs and state.  This module only validates a bounded context snapshot and
normalizes an advisory response.  It intentionally has no provider, network,
broker, execution or persistence dependency.  A future TypeSafe/Jev adapter
may consume these models, but it must return through this boundary.
"""

from __future__ import annotations

from collections import deque
import hashlib
import json
import math
import re
from typing import Any, Literal, Mapping

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator


REQUEST_SCHEMA = "chart-ai-request-v1"
RESPONSE_SCHEMA = "chart-ai-response-v1"
RESULT_SCHEMA = "chart-ai-result-v1"
ADVISORY_MODE = "advisory"
OFFLINE_PROVIDER = "offline"
OFFLINE_MODEL = "chart-advisory-offline-v1"
MAX_CONTEXT_BYTES = 65_536
MAX_EVIDENCE_ITEMS = 512

ChartAIStatus = Literal["ok", "uncertain", "unavailable", "stale", "invalid_context"]
ChartAIAction = Literal["observe", "review", "backtest", "none"]
ChartAIUncertainty = Literal["low", "medium", "high", "unknown"]

# Keep this list closed at the boundary.  More jobs can be added as separately
# versioned contracts; an arbitrary client supplied job must never choose a
# provider workflow.
_ALLOWED_JOBS = frozenset(
    {
        "chart_explanation",
        "chart_overlay",
        "chart_annotation_review",
        "smc_setup_review",
    }
)

_FORBIDDEN_KEYS = frozenset(
    {
        "api_key",
        "access_token",
        "authorization",
        "broker_credentials",
        "broker_request",
        "broker_action",
        "holdout_bars",
        "holdout_content",
        "future_bars",
        "future_events",
        "answer_keys",
        "password",
        "private_key",
        "secret",
        "live_order",
        "order_send",
        "place_order",
        "close_position",
        "modify_order",
        "cancel_order",
        "select_live_account",
        "enable_live_mode",
    }
)

# Imported notes and questions are data.  These patterns are deliberately
# narrow enough to avoid treating ordinary market language as an instruction,
# while blocking common attempts to turn an annotation into a tool call.
_PROMPT_INJECTION_PATTERNS = (
    re.compile(r"\bignore\s+(?:all|any|the|previous|prior|above)\s+(?:rules?|instructions?|messages?)\b", re.I),
    re.compile(r"\b(?:disregard|override|bypass)\s+(?:all\s+)?(?:rules?|instructions?|policy)\b", re.I),
    re.compile(r"\b(?:execute|place|send|open|close|modify|cancel)\s+(?:a\s+)?(?:buy|sell|order|position)\b", re.I),
    re.compile(r"\b(?:broker|order_send|place_order|send_order)\s*[(.:]", re.I),
    re.compile(r"\b(?:read|reveal|exfiltrate|print)\b.{0,80}\b(?:secret|password|api[ _-]?key|credential|holdout)\b", re.I),
)

_HASH_RE = re.compile(r"^(?:sha256:)?[0-9a-f]{64}$", re.I)
_CLAIM_RE = re.compile(r"^[a-z0-9][a-z0-9_:-]{0,95}$")


class ChartAIContractError(ValueError):
    """Raised when a chart AI packet is unsafe, stale or structurally invalid."""


def _text(value: Any, name: str, *, maximum: int = 256) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} is required")
    value = value.strip()
    if len(value) > maximum:
        raise ValueError(f"{name} is too long")
    return value


def _strict_int(value: Any, name: str, *, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise ValueError(f"{name} must be an integer >= {minimum}")
    return value


def _canonical(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError, RecursionError) as exc:
        raise ChartAIContractError("chart AI context must be finite JSON") from exc


def _normalize_hash(value: Any, name: str = "context_hash") -> str:
    if not isinstance(value, str):
        raise ChartAIContractError(f"{name} must be a SHA-256 hash")
    candidate = value.strip().lower()
    if not _HASH_RE.fullmatch(candidate):
        raise ChartAIContractError(f"{name} must be a SHA-256 hash")
    return candidate if candidate.startswith("sha256:") else f"sha256:{candidate}"


def _walk_json(value: Any, *, reject_prompt_injection: bool = False) -> None:
    """Validate nested JSON without recursive traversal.

    This protects the provider boundary from non-finite values and adversarial
    nesting while keeping all imported text inert data.
    """

    pending: deque[tuple[str, Any]] = deque([("payload", value)])
    while pending:
        path, current = pending.pop()
        if isinstance(current, dict):
            for key, child in current.items():
                normalized = str(key).strip().lower().replace("-", "_")
                if normalized in _FORBIDDEN_KEYS:
                    raise ChartAIContractError(f"{path}.{key} is forbidden")
                pending.append((f"{path}.{key}", child))
        elif isinstance(current, (list, tuple)):
            for index, child in enumerate(current):
                pending.append((f"{path}[{index}]", child))
        elif isinstance(current, float) and not math.isfinite(current):
            raise ChartAIContractError(f"{path} must be finite")
        elif isinstance(current, (str, bytes)):
            if isinstance(current, bytes):
                raise ChartAIContractError(f"{path} must be JSON text")
            if reject_prompt_injection:
                for pattern in _PROMPT_INJECTION_PATTERNS:
                    if pattern.search(current):
                        raise ChartAIContractError("prompt_injection_blocked")


def _walk_causal_timestamps(value: Any, cutoff: int, *, path: str = "visible_slice") -> None:
    """Reject known bar/event timestamps beyond the replay cutoff."""

    pending: deque[tuple[str, Any]] = deque([(path, value)])
    timestamp_keys = {
        "timestamp",
        "timestamp_utc",
        "close_timestamp",
        "close_timestamp_utc",
        "known_at",
        "known_at_utc",
    }
    while pending:
        current_path, current = pending.pop()
        if isinstance(current, dict):
            for key, child in current.items():
                normalized = str(key).strip().lower().replace("-", "_")
                if normalized in timestamp_keys:
                    # Timestamps are part of the causal boundary, not free
                    # form annotation text.  Requiring a strict integer here
                    # prevents a float/string (or bool) future timestamp from
                    # bypassing the ``> cutoff`` comparison in an otherwise
                    # valid JSON context packet.
                    if type(child) is not int or child < 1:
                        raise ChartAIContractError(
                            f"{current_path}.{key} must be a positive integer timestamp"
                        )
                    if child > cutoff:
                        raise ChartAIContractError(f"{current_path}.{key} exceeds replay cutoff")
                pending.append((f"{current_path}.{key}", child))
        elif isinstance(current, (list, tuple)):
            pending.extend((f"{current_path}[{index}]", child) for index, child in enumerate(current))


def _unique_texts(values: tuple[str, ...], name: str, *, maximum: int = 256) -> tuple[str, ...]:
    normalized = tuple(_text(value, name, maximum=maximum) for value in values)
    if len(set(normalized)) != len(normalized):
        raise ValueError(f"{name} must be unique")
    return normalized


class ChartAIRequest(BaseModel):
    """Immutable, bounded chart context presented to an advisory adapter."""

    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    schema_version: Literal["chart-ai-request-v1"] = REQUEST_SCHEMA
    mode: Literal["advisory"] = ADVISORY_MODE
    request_id: str = Field(min_length=1, max_length=128)
    workspace_id_server_bound: str = Field(min_length=1, max_length=128)
    job: str = Field(min_length=1, max_length=64)
    context_version: str = Field(min_length=1, max_length=128)
    context_hash: str = Field(min_length=64, max_length=71)
    instrument_id: str | None = Field(default=None, min_length=1, max_length=64)
    # ``symbol`` is accepted as a compatibility spelling and normalized by the
    # post-validator; canonical packets always expose instrument_id.
    symbol: str | None = Field(default=None, min_length=1, max_length=64)
    timeframe_seconds: int = Field(gt=0, strict=True)
    cursor_or_cutoff: int = Field(gt=0, strict=True)
    visible_slice: dict[str, Any] | list[Any]
    source_revisions: tuple[Any, ...]
    method_versions: dict[str, str]
    quality_warnings: tuple[str, ...]
    evidence_event_ids: tuple[str, ...] = ()
    evidence_bar_ids: tuple[str, ...] = ()
    evidence_events: tuple[dict[str, Any], ...] = ()
    evidence_bars: tuple[dict[str, Any], ...] = ()
    question: str = Field(default="", max_length=4_000)
    notes: tuple[str, ...] = ()

    @model_validator(mode="before")
    @classmethod
    def accept_causal_aliases(cls, value: Any) -> Any:
        if not isinstance(value, Mapping):
            return value
        payload = dict(value)
        if payload.get("instrument_id") is None and payload.get("symbol") is not None:
            payload["instrument_id"] = payload["symbol"]
        if "cursor_or_cutoff" not in payload:
            for alias in ("replay_cutoff", "cutoff_timestamp", "cursor"):
                if alias in payload:
                    payload["cursor_or_cutoff"] = payload[alias]
                    break
        for alias in ("replay_cutoff", "cutoff_timestamp", "cursor"):
            payload.pop(alias, None)
        if "visible_slice" not in payload:
            if "visible_bars" in payload:
                payload["visible_slice"] = {"bars": payload["visible_bars"]}
            elif "bars" in payload:
                payload["visible_slice"] = {"bars": payload["bars"]}
        payload.pop("visible_bars", None)
        if "evidence_events" not in payload and "events" in payload:
            payload["evidence_events"] = payload["events"]
        if "evidence_bars" not in payload and "bars" in payload:
            payload["evidence_bars"] = payload["bars"]
        payload.pop("events", None)
        payload.pop("bars", None)
        return payload

    @field_validator("job")
    @classmethod
    def validate_job(cls, value: str) -> str:
        value = value.strip()
        if value not in _ALLOWED_JOBS:
            raise ValueError("job is unsupported")
        return value

    @field_validator("context_hash")
    @classmethod
    def validate_hash_shape(cls, value: str) -> str:
        return _normalize_hash(value)

    @field_validator("instrument_id", "symbol")
    @classmethod
    def normalize_instrument(cls, value: str | None) -> str | None:
        return None if value is None else value.strip().upper()

    @field_validator("source_revisions", "quality_warnings", "evidence_event_ids", "evidence_bar_ids", "notes")
    @classmethod
    def validate_tuple_values(cls, value: tuple[Any, ...], info) -> tuple[Any, ...]:
        name = str(info.field_name)
        if name in {"quality_warnings", "evidence_event_ids", "evidence_bar_ids", "notes"}:
            return _unique_texts(value, name, maximum=4_000 if name in {"quality_warnings", "notes"} else 256)
        return value

    @model_validator(mode="after")
    def validate_context(self) -> "ChartAIRequest":
        if self.instrument_id is None:
            raise ValueError("instrument_id or symbol is required")
        if self.symbol is not None and self.symbol != self.instrument_id:
            raise ValueError("symbol and instrument_id must match")
        _walk_json(self.model_dump(mode="json", exclude={"context_hash"}), reject_prompt_injection=True)
        _walk_causal_timestamps(self.visible_slice, self.cursor_or_cutoff)
        _walk_causal_timestamps(self.evidence_events, self.cursor_or_cutoff, path="evidence_events")
        _walk_causal_timestamps(self.evidence_bars, self.cursor_or_cutoff, path="evidence_bars")
        for revision in self.source_revisions:
            if isinstance(revision, Mapping):
                source_workspace = revision.get("workspace_id")
                if source_workspace is not None and source_workspace != self.workspace_id_server_bound:
                    raise ValueError("cross_workspace_source")
        if not self.visible_slice:
            raise ValueError("visible_slice must not be empty")
        if not self.source_revisions:
            raise ValueError("source_revisions must not be empty")
        if not self.method_versions:
            raise ValueError("method_versions must not be empty")
        evidence_count = len(self.evidence_events) + len(self.evidence_bars)
        if evidence_count > MAX_EVIDENCE_ITEMS:
            raise ValueError("evidence exceeds MAX_EVIDENCE_ITEMS")
        if len(_canonical(self.context_payload())) > MAX_CONTEXT_BYTES:
            raise ValueError("context exceeds MAX_CONTEXT_BYTES")
        return self

    def context_payload(self) -> dict[str, Any]:
        """Return application-owned fields used to compute context identity."""

        payload = self.model_dump(mode="json", exclude={"request_id", "context_hash"})
        # Keep the compatibility spelling out of the canonical identity.
        payload.pop("symbol", None)
        return payload


class ChartAIResult(BaseModel):
    """Typed semantic result; it contains no permission or execution fields."""

    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    schema_version: Literal["chart-ai-result-v1"] = RESULT_SCHEMA
    claim: str = Field(min_length=1, max_length=96)
    summary: str = Field(min_length=1, max_length=4_000)
    uncertainty: ChartAIUncertainty
    action: ChartAIAction
    invalid_if: tuple[str, ...] = ()

    @field_validator("claim")
    @classmethod
    def validate_claim(cls, value: str) -> str:
        value = value.strip().lower()
        if not _CLAIM_RE.fullmatch(value):
            raise ValueError("claim must be a safe identifier")
        return value

    @field_validator("invalid_if")
    @classmethod
    def validate_invalid_conditions(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        return _unique_texts(value, "invalid_if", maximum=512)


class ChartAIUsage(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    input_tokens: int | None = Field(default=None, ge=0, strict=True)
    output_tokens: int | None = Field(default=None, ge=0, strict=True)


class ChartAIResponse(BaseModel):
    """Provider-neutral normalized advisory response."""

    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)

    schema_version: Literal["chart-ai-response-v1"] = RESPONSE_SCHEMA
    mode: Literal["advisory"] = ADVISORY_MODE
    request_id: str = Field(min_length=1, max_length=128)
    status: ChartAIStatus
    provider: str = Field(min_length=1, max_length=128)
    model: str = Field(min_length=1, max_length=128)
    context_hash: str = Field(min_length=64, max_length=71)
    result: ChartAIResult
    evidence_event_ids: tuple[str, ...] = ()
    evidence_bar_ids: tuple[str, ...] = ()
    usage: ChartAIUsage | None = None
    latency_ms: float | None = Field(default=None, ge=0)
    reason_code: str | None = Field(default=None, min_length=1, max_length=128)
    execution_capability: Literal[False] = False
    write_authority: Literal[False] = False

    @field_validator("context_hash")
    @classmethod
    def normalize_response_hash(cls, value: str) -> str:
        return _normalize_hash(value)

    @field_validator("evidence_event_ids", "evidence_bar_ids")
    @classmethod
    def normalize_response_refs(cls, value: tuple[str, ...], info) -> tuple[str, ...]:
        return _unique_texts(value, str(info.field_name), maximum=256)

    @model_validator(mode="after")
    def validate_safety(self) -> "ChartAIResponse":
        # A response is still untrusted data until this walk is complete.
        _walk_json(self.model_dump(mode="json"), reject_prompt_injection=True)
        if self.status in {"unavailable", "stale", "invalid_context"} and self.result.uncertainty != "unknown":
            raise ValueError("non-success response must remain unknown")
        return self


def compute_context_hash(request_or_payload: ChartAIRequest | Mapping[str, Any]) -> str:
    """Compute the stable SHA-256 identity of application-owned context."""

    if isinstance(request_or_payload, ChartAIRequest):
        payload = request_or_payload.context_payload()
    elif isinstance(request_or_payload, Mapping):
        try:
            request = ChartAIRequest.model_validate(request_or_payload)
        except ValidationError as exc:
            raise ChartAIContractError(str(exc)) from exc
        payload = request.context_payload()
    else:
        raise ChartAIContractError("request must be an object")
    return f"sha256:{hashlib.sha256(_canonical(payload)).hexdigest()}"


def validate_chart_ai_request(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Validate and normalize one request, including its causal hash."""

    try:
        request = ChartAIRequest.model_validate(payload)
    except (ValidationError, TypeError, ValueError) as exc:
        raise ChartAIContractError(str(exc)) from exc
    actual_hash = compute_context_hash(request)
    if request.context_hash != actual_hash:
        raise ChartAIContractError("context_hash_mismatch")
    return request.model_dump(mode="json")


def validate_chart_ai_response(
    payload: Mapping[str, Any],
    request: ChartAIRequest | Mapping[str, Any],
) -> dict[str, Any]:
    """Validate a response and bind it to the exact request context."""

    try:
        normalized_request = request if isinstance(request, ChartAIRequest) else ChartAIRequest.model_validate(request)
        response = ChartAIResponse.model_validate(payload)
    except (ValidationError, TypeError, ValueError) as exc:
        raise ChartAIContractError(str(exc)) from exc
    _walk_json(payload, reject_prompt_injection=True)
    if normalized_request.context_hash != compute_context_hash(normalized_request):
        raise ChartAIContractError("stale_context")
    if response.request_id != normalized_request.request_id:
        raise ChartAIContractError("request_id_mismatch")
    if response.context_hash != normalized_request.context_hash:
        raise ChartAIContractError("stale_context")
    event_ids = set(normalized_request.evidence_event_ids)
    bar_ids = set(normalized_request.evidence_bar_ids)
    if any(item not in event_ids for item in response.evidence_event_ids):
        raise ChartAIContractError("response references an event outside the request")
    if any(item not in bar_ids for item in response.evidence_bar_ids):
        raise ChartAIContractError("response references a bar outside the request")
    if response.status == "ok" and not response.evidence_event_ids and not response.evidence_bar_ids:
        raise ChartAIContractError("evidence_required")
    return response.model_dump(mode="json")


def fail_closed_chart_ai_response(
    request: ChartAIRequest | Mapping[str, Any],
    reason: str,
    *,
    detail: str | None = None,
) -> dict[str, Any]:
    """Build a safe response for unknown, timeout, stale or unsafe inputs."""

    reason = str(reason).strip().lower().replace(" ", "_") or "unknown"
    status: ChartAIStatus
    if reason in {"timeout", "provider_unavailable", "offline", "service_unavailable"}:
        status = "unavailable"
    elif reason in {"stale", "stale_context"}:
        status = "stale"
    elif reason in {"unknown", "insufficient_evidence"}:
        status = "uncertain"
    else:
        status = "invalid_context"
    try:
        normalized = request if isinstance(request, ChartAIRequest) else ChartAIRequest.model_validate(request)
        request_id = normalized.request_id
        context_hash = normalized.context_hash
    except (ValidationError, TypeError, ValueError):
        # Invalid input cannot be assigned a trusted identity.  The response is
        # still useful to the caller, but it must not be accepted or persisted.
        request_id = "invalid-request"
        context_hash = "sha256:" + ("0" * 64)
    summary = detail.strip() if isinstance(detail, str) and detail.strip() else f"Advisory unavailable: {reason}."
    if any(pattern.search(summary) for pattern in _PROMPT_INJECTION_PATTERNS):
        summary = "Advisory unavailable: unsafe_input."
    result = ChartAIResult(
        claim="unknown",
        summary=summary[:4_000],
        uncertainty="unknown",
        action="review",
        invalid_if=(reason,),
    )
    response = ChartAIResponse(
        request_id=request_id,
        status=status,
        provider=OFFLINE_PROVIDER,
        model=OFFLINE_MODEL,
        context_hash=context_hash,
        result=result,
        reason_code=reason,
        execution_capability=False,
        write_authority=False,
    )
    return response.model_dump(mode="json")


class OfflineChartAIAdvisor:
    """Deterministic offline fallback; it never invokes a provider."""

    provider_id = OFFLINE_PROVIDER
    model_id = OFFLINE_MODEL

    def request(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        try:
            normalized = validate_chart_ai_request(payload)
        except ChartAIContractError as exc:
            message = str(exc)
            known_reasons = (
                "prompt_injection_blocked",
                "cross_workspace_source",
                "context_hash_mismatch",
                "stale_context",
                "provider_unavailable",
            )
            reason = next((candidate for candidate in known_reasons if candidate in message), "invalid_context")
            return fail_closed_chart_ai_response(payload, reason)
        return fail_closed_chart_ai_response(normalized, "provider_unavailable")


__all__ = [
    "ADVISORY_MODE",
    "ChartAIRequest",
    "ChartAIResponse",
    "ChartAIResult",
    "ChartAIUsage",
    "ChartAIContractError",
    "OfflineChartAIAdvisor",
    "compute_context_hash",
    "fail_closed_chart_ai_response",
    "validate_chart_ai_request",
    "validate_chart_ai_response",
]
