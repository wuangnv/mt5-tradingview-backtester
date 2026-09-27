"""C4 deterministic chart-event explainability packets.

The chart engine is the authority for event semantics.  This module exposes a
small, immutable inspector packet for one event so a renderer or future UI can
answer *why this annotation exists* without asking a provider to reconstruct
history.  It only accepts source bars that are already present and closed at
the inclusive replay cutoff.  Missing, unknown, or future references fail
closed; they are never represented as zero-valued prices.

This is a PREP_ONLY/offline contract.  It has no provider, network, broker,
execution, persistence, or chart-SDK dependency.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
from dataclasses import dataclass
from typing import Any, Iterable, Literal, Mapping

from .chart_intelligence import ChartBar, ChartEvent, ChartIntelligenceError


EXPLANATION_SCHEMA = "chart-explanation-v1"
EXPLANATION_MODE = "PREP_ONLY"
EXPLANATION_ENGINE = "deterministic-offline"
MAX_SOURCE_BARS = 512
MAX_PAYLOAD_BYTES = 65_536

_INVALIDATION_STATES = {"active", "invalidated", "unknown", "not_applicable"}
_RECOMPUTE_STATES = {"available", "unknown"}
_FORBIDDEN_KEYS = frozenset(
    {
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
)


class ChartExplainabilityError(ValueError):
    """Raised when an inspector packet is missing causal evidence."""


def _strict_int(value: Any, name: str, *, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise ChartExplainabilityError(f"{name} must be an integer >= {minimum}")
    return value


def _text(value: Any, name: str, *, maximum: int = 256) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ChartExplainabilityError(f"{name} is required")
    value = value.strip()
    if len(value) > maximum:
        raise ChartExplainabilityError(f"{name} is too long")
    return value


def _finite(value: Any, name: str, *, positive: bool = False) -> float:
    if isinstance(value, bool):
        raise ChartExplainabilityError(f"{name} must be finite")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ChartExplainabilityError(f"{name} must be finite") from exc
    if not math.isfinite(number) or (positive and number <= 0):
        raise ChartExplainabilityError(f"{name} must be finite")
    return number


def _canonical(value: Any) -> bytes:
    try:
        return json.dumps(
            value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    except (TypeError, ValueError, RecursionError) as exc:
        raise ChartExplainabilityError("explanation must be finite JSON") from exc


def _walk_safe(value: Any, *, path: str = "payload") -> None:
    """Reject unsafe keys and non-finite/nested values before serialization."""

    if isinstance(value, Mapping):
        for key, child in value.items():
            normalized = str(key).strip().lower().replace("-", "_")
            if normalized in _FORBIDDEN_KEYS:
                raise ChartExplainabilityError(f"{path}.{key} is forbidden")
            _walk_safe(child, path=f"{path}.{key}")
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            _walk_safe(child, path=f"{path}[{index}]")
    elif isinstance(value, float) and not math.isfinite(value):
        raise ChartExplainabilityError(f"{path} must be finite")
    elif isinstance(value, bytes):
        raise ChartExplainabilityError(f"{path} must be JSON text")


def _bar_id(timestamp: int) -> str:
    return f"bar:{timestamp}"


def _event_payload(event: ChartEvent | Mapping[str, Any]) -> dict[str, Any]:
    if isinstance(event, ChartEvent):
        payload = event.as_dict()
    elif isinstance(event, Mapping):
        payload = copy.deepcopy(dict(event))
    else:
        raise ChartExplainabilityError("event must be ChartEvent or an object")
    required = {
        "event_id",
        "kind",
        "direction",
        "instrument_id",
        "timeframe_seconds",
        "anchor_timestamp",
        "known_at",
        "source_bar_ids",
        "price_low",
        "price_high",
        "state",
        "confirmation_lag_bars",
        "rule_version",
        "parameters",
        "identity",
    }
    unknown = sorted(set(payload) - (required | {"schema"}))
    if unknown:
        raise ChartExplainabilityError(f"event has unsupported fields: {unknown}")
    missing = sorted(required - set(payload))
    if missing:
        raise ChartExplainabilityError(f"event is missing fields: {missing}")
    _walk_safe(payload, path="event")
    raw_source_ids = payload["source_bar_ids"]
    if not isinstance(raw_source_ids, (list, tuple)):
        raise ChartExplainabilityError("event.source_bar_ids must be a non-empty list")
    normalized = {
        "schema": payload.get("schema", "chart-event-v1"),
        "event_id": _text(payload["event_id"], "event.event_id", maximum=256),
        "kind": _text(payload["kind"], "event.kind", maximum=64),
        "direction": _text(payload["direction"], "event.direction", maximum=32),
        "instrument_id": _text(payload["instrument_id"], "event.instrument_id", maximum=64).upper(),
        "timeframe_seconds": _strict_int(payload["timeframe_seconds"], "event.timeframe_seconds", minimum=1),
        "anchor_timestamp": _strict_int(payload["anchor_timestamp"], "event.anchor_timestamp", minimum=1),
        "known_at": _strict_int(payload["known_at"], "event.known_at", minimum=1),
        "source_bar_ids": tuple(_text(item, "event.source_bar_ids[]", maximum=256) for item in raw_source_ids),
        "price_low": _finite(payload["price_low"], "event.price_low", positive=True),
        "price_high": _finite(payload["price_high"], "event.price_high", positive=True),
        "state": _text(payload["state"], "event.state", maximum=32),
        "confirmation_lag_bars": _strict_int(payload["confirmation_lag_bars"], "event.confirmation_lag_bars", minimum=0),
        "rule_version": _text(payload["rule_version"], "event.rule_version", maximum=128),
        "parameters": copy.deepcopy(payload["parameters"]),
        "identity": copy.deepcopy(payload["identity"]),
    }
    if not normalized["source_bar_ids"]:
        raise ChartExplainabilityError("event.source_bar_ids must be non-empty")
    if len(set(normalized["source_bar_ids"])) != len(normalized["source_bar_ids"]):
        raise ChartExplainabilityError("event.source_bar_ids must be unique")
    if not isinstance(payload["parameters"], Mapping) or not isinstance(payload["identity"], Mapping):
        raise ChartExplainabilityError("event.parameters and event.identity must be objects")
    if normalized["known_at"] < normalized["anchor_timestamp"]:
        raise ChartExplainabilityError("event.known_at precedes event.anchor_timestamp")
    if normalized["price_high"] < normalized["price_low"]:
        raise ChartExplainabilityError("event price range is invalid")
    return normalized


def _normalize_source_bars(
    source_bars: Mapping[str, ChartBar | Mapping[str, Any]] | Iterable[ChartBar | Mapping[str, Any]],
) -> dict[str, ChartBar]:
    """Normalize a bar map/list and reject duplicate IDs or malformed bars."""

    if isinstance(source_bars, Mapping):
        values = []
        for key, raw in source_bars.items():
            key_text = _text(key, "source_bars key", maximum=256)
            values.append((key_text, raw))
    else:
        try:
            values = [(None, raw) for raw in source_bars]
        except TypeError as exc:
            raise ChartExplainabilityError("source_bars must be an object or iterable") from exc
    if len(values) > MAX_SOURCE_BARS:
        raise ChartExplainabilityError("source_bars exceeds MAX_SOURCE_BARS")
    normalized: dict[str, ChartBar] = {}
    for index, (provided_id, raw) in enumerate(values):
        row_id = provided_id
        if isinstance(raw, Mapping) and "bar_id" in raw:
            embedded_id = _text(raw["bar_id"], f"source_bars[{index}].bar_id", maximum=256)
            if row_id is not None and row_id != embedded_id:
                raise ChartExplainabilityError(f"source_bars[{index}] key does not match embedded bar_id")
            row_id = embedded_id
            availability = raw.get("availability", "available")
            if availability != "available":
                raise ChartExplainabilityError(
                    f"source_bars[{index}] is not available: {availability!r}"
                )
            raw = {key: value for key, value in raw.items() if key not in {"bar_id", "availability"}}
        try:
            bar = raw if isinstance(raw, ChartBar) else ChartBar.from_mapping(raw, index=index)
        except ChartIntelligenceError as exc:
            raise ChartExplainabilityError(str(exc)) from exc
        bar_id = _bar_id(bar.timestamp)
        if row_id is not None and row_id != bar_id:
            raise ChartExplainabilityError(f"source_bars[{provided_id}] ID does not match timestamp")
        if bar_id in normalized:
            raise ChartExplainabilityError(f"duplicate source bar {bar_id}")
        normalized[bar_id] = bar
    return normalized


def _bar_dict(bar_id: str, bar: ChartBar) -> dict[str, Any]:
    result: dict[str, Any] = {
        "bar_id": bar_id,
        "timestamp": bar.timestamp,
        "open": bar.open,
        "high": bar.high,
        "low": bar.low,
        "close": bar.close,
        "availability": "available",
    }
    if bar.volume is not None:
        result["volume"] = bar.volume
    return result


def _normalize_provenance(value: Mapping[str, Any] | None) -> dict[str, Any]:
    if value is None or not isinstance(value, Mapping):
        raise ChartExplainabilityError("provenance is required")
    allowed = {"source", "revision", "dataset_sha256", "indicator_sha256", "engine_commit"}
    unknown = set(value) - allowed
    if unknown:
        raise ChartExplainabilityError(f"provenance has unsupported fields: {sorted(unknown)}")
    source = value.get("source")
    if not isinstance(source, Mapping):
        raise ChartExplainabilityError("provenance.source is required")
    source_allowed = {"kind", "id", "dataset_id", "dataset_sha256"}
    if set(source) - source_allowed:
        raise ChartExplainabilityError("provenance.source has unsupported fields")
    source_result = {"kind": _text(source.get("kind"), "provenance.source.kind", maximum=64), "id": _text(source.get("id"), "provenance.source.id", maximum=256)}
    for key in ("dataset_id",):
        if key in source:
            source_result[key] = _text(source[key], f"provenance.source.{key}", maximum=256)
    for key in ("dataset_sha256",):
        if key in source:
            digest = _text(source[key], f"provenance.source.{key}", maximum=64).lower()
            if len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest):
                raise ChartExplainabilityError(f"provenance.source.{key} must be SHA-256 hex")
            source_result[key] = digest
    result: dict[str, Any] = {"source": source_result, "revision": _text(value.get("revision"), "provenance.revision", maximum=256)}
    for key in ("dataset_sha256", "indicator_sha256"):
        if key in value:
            digest = _text(value[key], f"provenance.{key}", maximum=64).lower()
            if len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest):
                raise ChartExplainabilityError(f"provenance.{key} must be SHA-256 hex")
            result[key] = digest
    if "engine_commit" in value:
        result["engine_commit"] = _text(value["engine_commit"], "provenance.engine_commit", maximum=128)
    return result


def _normalize_invalidation(value: Mapping[str, Any] | None, *, event: Mapping[str, Any], cutoff: int, source_ids: set[str]) -> dict[str, Any]:
    if value is None:
        return {"state": "unknown", "condition": "not supplied", "known_at": None, "evidence_bar_ids": [], "unknown_fields": ["state", "condition"]}
    if not isinstance(value, Mapping):
        raise ChartExplainabilityError("invalidation must be an object")
    allowed = {"state", "condition", "known_at", "evidence_bar_ids", "unknown_fields"}
    if set(value) - allowed:
        raise ChartExplainabilityError("invalidation has unsupported fields")
    state = _text(value.get("state"), "invalidation.state", maximum=32).lower()
    if state not in _INVALIDATION_STATES:
        raise ChartExplainabilityError("invalidation.state is unsupported")
    condition = _text(value.get("condition"), "invalidation.condition", maximum=512)
    known_at = value.get("known_at")
    if known_at is not None:
        known_at = _strict_int(known_at, "invalidation.known_at", minimum=1)
        if known_at > cutoff:
            raise ChartExplainabilityError("invalidation.known_at exceeds cutoff")
        if known_at < event["known_at"]:
            raise ChartExplainabilityError("invalidation.known_at precedes event.known_at")
    refs = value.get("evidence_bar_ids", [])
    if not isinstance(refs, (list, tuple)):
        raise ChartExplainabilityError("invalidation.evidence_bar_ids must be a list")
    refs = tuple(_text(item, "invalidation.evidence_bar_ids[]", maximum=256) for item in refs)
    if len(set(refs)) != len(refs):
        raise ChartExplainabilityError("invalidation.evidence_bar_ids must be unique")
    if any(item not in source_ids for item in refs):
        raise ChartExplainabilityError("invalidation references an unavailable source bar")
    unknown_fields = value.get("unknown_fields", [])
    if not isinstance(unknown_fields, (list, tuple)):
        raise ChartExplainabilityError("invalidation.unknown_fields must be a list")
    unknown_fields = tuple(_text(item, "invalidation.unknown_fields[]", maximum=128) for item in unknown_fields)
    if state == "invalidated" and (known_at is None or not refs):
        raise ChartExplainabilityError("invalidated explanation requires known_at and evidence")
    return {"state": state, "condition": condition, "known_at": known_at, "evidence_bar_ids": list(refs), "unknown_fields": list(unknown_fields)}


def _manual_recompute(event: Mapping[str, Any], bars: Mapping[str, ChartBar]) -> dict[str, Any]:
    ordered = [bars[bar_id] for bar_id in event["source_bar_ids"]]
    values = {
        "price_low": event["price_low"],
        "price_high": event["price_high"],
        "price_range": event["price_high"] - event["price_low"],
        "anchor_timestamp": event["anchor_timestamp"],
        "known_at": event["known_at"],
        "confirmation_lag_bars": event["confirmation_lag_bars"],
        "source_bar_count": len(ordered),
        "source_first_timestamp": min(bar.timestamp for bar in ordered),
        "source_last_timestamp": max(bar.timestamp for bar in ordered),
    }
    checks = {
        "source_bars_present": True,
        "source_bars_closed": True,
        "known_at_not_before_anchor": event["known_at"] >= event["anchor_timestamp"],
        "price_range_valid": event["price_high"] >= event["price_low"] > 0,
    }
    return {"status": "available", "method": "chart-event-fields-v1", "values": values, "checks": checks, "unknown_fields": []}


@dataclass(frozen=True, slots=True)
class ChartExplanationPacket:
    """Typed immutable inspector payload for one causal chart event."""

    event: dict[str, Any]
    rule: dict[str, Any]
    source_bars: tuple[dict[str, Any], ...]
    cutoff_timestamp: int
    invalidation: dict[str, Any]
    recompute: dict[str, Any]
    provenance: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema": EXPLANATION_SCHEMA,
            "mode": EXPLANATION_MODE,
            "engine": EXPLANATION_ENGINE,
            "event": copy.deepcopy(self.event),
            "rule": copy.deepcopy(self.rule),
            "source_bars": copy.deepcopy(list(self.source_bars)),
            "cutoff_timestamp": self.cutoff_timestamp,
            "invalidation": copy.deepcopy(self.invalidation),
            "recompute": copy.deepcopy(self.recompute),
            "provenance": copy.deepcopy(self.provenance),
        }


def _validate_packet(payload: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, Mapping):
        raise ChartExplainabilityError("packet must be an object")
    required = {"schema", "mode", "engine", "event", "rule", "source_bars", "cutoff_timestamp", "invalidation", "recompute", "provenance"}
    missing = sorted(required - set(payload))
    if missing:
        raise ChartExplainabilityError(f"packet is missing fields: {missing}")
    _walk_safe(payload)
    if payload["schema"] != EXPLANATION_SCHEMA or payload["mode"] != EXPLANATION_MODE or payload["engine"] != EXPLANATION_ENGINE:
        raise ChartExplainabilityError("unsupported explanation packet identity")
    event = _event_payload(payload["event"])
    cutoff = _strict_int(payload["cutoff_timestamp"], "cutoff_timestamp", minimum=1)
    if event["known_at"] > cutoff or event["anchor_timestamp"] > cutoff:
        raise ChartExplainabilityError("event exceeds replay cutoff")
    raw_bars = payload["source_bars"]
    if not isinstance(raw_bars, (list, tuple)):
        raise ChartExplainabilityError("source_bars must be a list")
    bars = _normalize_source_bars(raw_bars)
    expected = set(event["source_bar_ids"])
    if set(bars) != expected:
        missing_refs = sorted(expected - set(bars))
        extra_refs = sorted(set(bars) - expected)
        if missing_refs:
            raise ChartExplainabilityError(f"missing source bar references: {missing_refs}")
        raise ChartExplainabilityError(f"unknown source bar references: {extra_refs}")
    for bar_id, bar in bars.items():
        if bar.timestamp > cutoff or bar.timestamp > event["known_at"]:
            raise ChartExplainabilityError(f"source bar {bar_id} exceeds causal cutoff")
    rule = payload["rule"]
    if not isinstance(rule, Mapping):
        raise ChartExplainabilityError("rule must be an object")
    if set(rule) != {"version", "kind", "parameters", "definition_sha256"}:
        raise ChartExplainabilityError("rule fields are incomplete or unsupported")
    if rule["version"] != event["rule_version"] or rule["kind"] != event["kind"]:
        raise ChartExplainabilityError("rule does not match event")
    if not isinstance(rule["parameters"], Mapping):
        raise ChartExplainabilityError("rule.parameters must be an object")
    digest = hashlib.sha256(_canonical({"version": rule["version"], "kind": rule["kind"], "parameters": rule["parameters"]})).hexdigest()
    if rule["definition_sha256"] != digest:
        raise ChartExplainabilityError("rule definition hash mismatch")
    invalidation = _normalize_invalidation(payload["invalidation"], event=event, cutoff=cutoff, source_ids=set(bars))
    recompute = payload["recompute"]
    if not isinstance(recompute, Mapping):
        raise ChartExplainabilityError("recompute must be an object")
    if recompute.get("status") not in _RECOMPUTE_STATES:
        raise ChartExplainabilityError("recompute.status is unsupported")
    if recompute.get("status") == "available":
        if not isinstance(recompute.get("values"), Mapping) or not isinstance(recompute.get("checks"), Mapping):
            raise ChartExplainabilityError("available recompute requires values and checks")
        expected_recompute = _manual_recompute(event, bars)
        if _canonical(dict(recompute)) != _canonical(expected_recompute):
            raise ChartExplainabilityError("recompute values do not match deterministic event fields")
    else:
        if not recompute.get("unknown_fields"):
            raise ChartExplainabilityError("unknown recompute requires unknown_fields")
        if not isinstance(recompute["unknown_fields"], (list, tuple)):
            raise ChartExplainabilityError("recompute.unknown_fields must be a list")
    provenance = _normalize_provenance(payload["provenance"])
    normalized = {
        "schema": EXPLANATION_SCHEMA,
        "mode": EXPLANATION_MODE,
        "engine": EXPLANATION_ENGINE,
        "event": event,
        "rule": {"version": rule["version"], "kind": rule["kind"], "parameters": copy.deepcopy(dict(rule["parameters"])), "definition_sha256": digest},
        "source_bars": [_bar_dict(bar_id, bars[bar_id]) for bar_id in event["source_bar_ids"]],
        "cutoff_timestamp": cutoff,
        "invalidation": invalidation,
        "recompute": copy.deepcopy(dict(recompute)),
        "provenance": provenance,
    }
    if len(_canonical(normalized)) > MAX_PAYLOAD_BYTES:
        raise ChartExplainabilityError("explanation packet exceeds MAX_PAYLOAD_BYTES")
    return normalized


def build_chart_explanation(
    event: ChartEvent | Mapping[str, Any],
    source_bars: Mapping[str, ChartBar | Mapping[str, Any]] | Iterable[ChartBar | Mapping[str, Any]],
    *,
    cutoff_timestamp: int,
    provenance: Mapping[str, Any],
    invalidation: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build and validate one event inspector packet from closed source bars."""

    normalized_event = _event_payload(event)
    bars = _normalize_source_bars(source_bars)
    missing = sorted(set(normalized_event["source_bar_ids"]) - set(bars))
    if missing:
        raise ChartExplainabilityError(f"missing source bar references: {missing}")
    extra = sorted(set(bars) - set(normalized_event["source_bar_ids"]))
    if extra:
        raise ChartExplainabilityError(f"unknown source bar references: {extra}")
    rule = {
        "version": normalized_event["rule_version"],
        "kind": normalized_event["kind"],
        "parameters": copy.deepcopy(dict(normalized_event["parameters"])),
    }
    rule["definition_sha256"] = hashlib.sha256(_canonical(rule)).hexdigest()
    normalized_cutoff = _strict_int(cutoff_timestamp, "cutoff_timestamp", minimum=1)
    packet = ChartExplanationPacket(
        event=normalized_event,
        rule=rule,
        source_bars=tuple(_bar_dict(bar_id, bars[bar_id]) for bar_id in normalized_event["source_bar_ids"]),
        cutoff_timestamp=normalized_cutoff,
        invalidation=_normalize_invalidation(invalidation, event=normalized_event, cutoff=normalized_cutoff, source_ids=set(bars)),
        recompute=_manual_recompute(normalized_event, bars),
        provenance=_normalize_provenance(provenance),
    )
    return _validate_packet(packet.as_dict())


def validate_chart_explanation(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Normalize/revalidate an inspector packet before renderer/UI use."""

    return _validate_packet(payload)


__all__ = [
    "ChartExplainabilityError",
    "ChartExplanationPacket",
    "EXPLANATION_ENGINE",
    "EXPLANATION_MODE",
    "EXPLANATION_SCHEMA",
    "build_chart_explanation",
    "validate_chart_explanation",
]
