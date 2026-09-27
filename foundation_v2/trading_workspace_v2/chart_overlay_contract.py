"""Offline chart-overlay contracts for deterministic SMC/ICT research.

The module is deliberately a PREP_ONLY boundary.  It validates the metadata
that a deterministic indicator engine may emit for a chart preview; it does
not calculate signals, call an LLM/provider, read holdout data, or create an
order.  Keeping this contract separate from the renderer makes a future
Lightweight Charts/TradingView adapter replaceable without moving causal
semantics into JavaScript.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


INDICATOR_SCHEMA = "indicator-definition-v1"
OVERLAY_SCHEMA = "chart-overlay-v1"
PACKET_SCHEMA = "chart-overlay-packet-v1"
PREP_ONLY_MODE = "PREP_ONLY"
DETERMINISTIC_ENGINE = "deterministic-offline"

_FAMILIES = {"ict", "smc", "price_action"}
_INDICATORS = {
    "ict": {"fvg", "liquidity_sweep", "session_range", "premium_discount", "ote"},
    "smc": {
        "market_structure",
        "bos",
        "choch",
        "order_block",
        "swing_points",
        "liquidity_sweep",
    },
    "price_action": {"break_retest"},
}
_OVERLAY_KINDS = {"horizontal_line", "zone", "trendline", "text", "arrow", "marker"}
_TWO_ANCHOR_KINDS = {"zone", "trendline"}
_STATUSES = {"preview", "committed", "undone"}
_CONFIDENCE_STATES = {"known", "uncertain", "unknown"}
_MTF_POLICIES = {"same_timeframe", "higher_closed", "lower_ordered"}
_LOOKAHEAD_POLICIES = {"closed_only", "next_bar_open"}
_FORBIDDEN_KEYS = {
    "api_key",
    "access_token",
    "authorization",
    "broker_credentials",
    "broker_action",
    "holdout_bars",
    "holdout_content",
    "live_order",
    "order_send",
    "password",
    "private_key",
    "secret",
}
_HEX64 = re.compile(r"^[0-9a-f]{64}$")


class ChartOverlayContractError(ValueError):
    """Raised when a chart feature would be ambiguous or non-causal."""


def _text(value: Any, name: str, *, maximum: int = 256) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ChartOverlayContractError(f"{name} is required")
    value = value.strip()
    if len(value) > maximum:
        raise ChartOverlayContractError(f"{name} is too long")
    return value


def _strict_int(value: Any, name: str, *, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise ChartOverlayContractError(f"{name} must be an integer >= {minimum}")
    return value


def _finite_number(value: Any, name: str, *, positive: bool = False) -> float:
    if isinstance(value, bool):
        raise ChartOverlayContractError(f"{name} must be a finite number")
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ChartOverlayContractError(f"{name} must be a finite number") from exc
    if not math.isfinite(result) or (positive and result <= 0):
        raise ChartOverlayContractError(f"{name} must be a finite number")
    return result


def _canonical(value: Any) -> bytes:
    try:
        return json.dumps(
            value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    except (TypeError, ValueError, RecursionError) as exc:
        raise ChartOverlayContractError("value must be finite JSON") from exc


def _hash(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def definition_sha256(definition: dict[str, Any]) -> str:
    """Return a stable hash for an indicator definition."""

    if not isinstance(definition, dict) or not definition:
        raise ChartOverlayContractError("indicator definition must be a non-empty object")
    return _hash(definition)


def _walk_forbidden(value: Any, path: str = "payload") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower().replace("-", "_")
            if normalized in _FORBIDDEN_KEYS:
                raise ChartOverlayContractError(f"{path}.{key} is forbidden")
            _walk_forbidden(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _walk_forbidden(child, f"{path}[{index}]")


def _source(source: Any, name: str = "source") -> dict[str, Any]:
    if not isinstance(source, dict):
        raise ChartOverlayContractError(f"{name} must be an object")
    allowed = {"kind", "id", "dataset_id", "dataset_sha256"}
    unknown = set(source) - allowed
    if unknown:
        raise ChartOverlayContractError(f"{name} has unsupported fields: {sorted(unknown)}")
    result = {"kind": _text(source.get("kind"), f"{name}.kind", maximum=64), "id": _text(source.get("id"), f"{name}.id")}
    if "dataset_id" in source:
        result["dataset_id"] = _text(source["dataset_id"], f"{name}.dataset_id", maximum=128)
    if "dataset_sha256" in source:
        digest = _text(source["dataset_sha256"], f"{name}.dataset_sha256", maximum=64).lower()
        if not _HEX64.fullmatch(digest):
            raise ChartOverlayContractError(f"{name}.dataset_sha256 must be a SHA-256 hex digest")
        result["dataset_sha256"] = digest
    return result


def _timezone(value: Any, name: str) -> str:
    zone_name = _text(value, name, maximum=128)
    try:
        ZoneInfo(zone_name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ChartOverlayContractError(f"{name} must be an IANA timezone") from exc
    return zone_name


def _session(value: Any, *, required: bool) -> dict[str, str] | None:
    if value is None:
        if required:
            raise ChartOverlayContractError("session is required for session_range")
        return None
    if not isinstance(value, dict):
        raise ChartOverlayContractError("session must be an object")
    allowed = {"name", "timezone", "start", "end"}
    unknown = set(value) - allowed
    if unknown:
        raise ChartOverlayContractError(f"session has unsupported fields: {sorted(unknown)}")
    result = {
        "name": _text(value.get("name"), "session.name", maximum=64),
        "timezone": _timezone(value.get("timezone"), "session.timezone"),
    }
    for field in ("start", "end"):
        text = _text(value.get(field), f"session.{field}", maximum=5)
        try:
            parsed = datetime.strptime(text, "%H:%M")
        except ValueError as exc:
            raise ChartOverlayContractError(f"session.{field} must be HH:MM") from exc
        result[field] = parsed.strftime("%H:%M")
    return result


def _repaint(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ChartOverlayContractError("repaint must be an object")
    allowed = {"flag", "state", "confirmation_bars"}
    unknown = set(value) - allowed
    if unknown:
        raise ChartOverlayContractError(f"repaint has unsupported fields: {sorted(unknown)}")
    if type(value.get("flag")) is not bool:
        raise ChartOverlayContractError("repaint.flag must be boolean")
    state = _text(value.get("state"), "repaint.state", maximum=16)
    if state not in {"confirmed", "provisional"}:
        raise ChartOverlayContractError("repaint.state is unsupported")
    confirmations = _strict_int(value.get("confirmation_bars"), "repaint.confirmation_bars")
    if value["flag"] != (state == "provisional"):
        raise ChartOverlayContractError("repaint.flag and repaint.state disagree")
    if state == "confirmed" and confirmations != 0:
        raise ChartOverlayContractError("confirmed repaint must have zero confirmation bars")
    if state == "provisional" and confirmations < 1:
        raise ChartOverlayContractError("provisional repaint requires confirmation bars")
    return {"flag": value["flag"], "state": state, "confirmation_bars": confirmations}


def validate_indicator_spec(spec: dict[str, Any]) -> dict[str, Any]:
    """Validate the deterministic, provider-free indicator definition."""

    if not isinstance(spec, dict):
        raise ChartOverlayContractError("indicator must be an object")
    _walk_forbidden(spec)
    required = {
        "schema",
        "mode",
        "engine",
        "family",
        "indicator_id",
        "version",
        "timezone",
        "display_timeframe_seconds",
        "source_timeframe_seconds",
        "mtf_policy",
        "lookahead",
        "causal_delay_bars",
        "repaint",
        "parameters",
    }
    missing = required - set(spec)
    if missing:
        raise ChartOverlayContractError(f"indicator missing fields: {sorted(missing)}")
    unknown = set(spec) - required - {"session"}
    if unknown:
        raise ChartOverlayContractError(f"indicator has unsupported fields: {sorted(unknown)}")
    if spec["schema"] != INDICATOR_SCHEMA or spec["mode"] != PREP_ONLY_MODE:
        raise ChartOverlayContractError("indicator must remain PREP_ONLY and use indicator-definition-v1")
    if spec["engine"] != DETERMINISTIC_ENGINE:
        raise ChartOverlayContractError("indicator engine must be deterministic-offline")
    family = _text(spec["family"], "indicator.family", maximum=32)
    if family not in _FAMILIES:
        raise ChartOverlayContractError("indicator.family is unsupported")
    indicator_id = _text(spec["indicator_id"], "indicator.indicator_id", maximum=64)
    if indicator_id not in _INDICATORS[family]:
        raise ChartOverlayContractError("indicator.indicator_id is unsupported for this family")
    version = _text(spec["version"], "indicator.version", maximum=128)
    timezone = _timezone(spec["timezone"], "indicator.timezone")
    display_tf = _strict_int(spec["display_timeframe_seconds"], "indicator.display_timeframe_seconds", minimum=1)
    source_tf = _strict_int(spec["source_timeframe_seconds"], "indicator.source_timeframe_seconds", minimum=1)
    mtf = _text(spec["mtf_policy"], "indicator.mtf_policy", maximum=32)
    if mtf not in _MTF_POLICIES:
        raise ChartOverlayContractError("indicator.mtf_policy is unsupported")
    expected_mtf = "same_timeframe" if source_tf == display_tf else "higher_closed" if source_tf > display_tf else "lower_ordered"
    if mtf != expected_mtf:
        raise ChartOverlayContractError("indicator.mtf_policy does not match source/display timeframe")
    lookahead = _text(spec["lookahead"], "indicator.lookahead", maximum=32)
    if lookahead not in _LOOKAHEAD_POLICIES:
        raise ChartOverlayContractError("indicator.lookahead must be closed_only or next_bar_open")
    delay = _strict_int(spec["causal_delay_bars"], "indicator.causal_delay_bars")
    repaint = _repaint(spec["repaint"])
    if delay < repaint["confirmation_bars"]:
        raise ChartOverlayContractError("causal_delay_bars is shorter than repaint confirmation")
    parameters = spec["parameters"]
    if not isinstance(parameters, dict):
        raise ChartOverlayContractError("indicator.parameters must be an object")
    # session_range is the only currently supported session-bound definition;
    # all other features may still carry an explicit session for filtering.
    session = _session(spec.get("session"), required=indicator_id == "session_range")
    return {
        "schema": INDICATOR_SCHEMA,
        "mode": PREP_ONLY_MODE,
        "engine": DETERMINISTIC_ENGINE,
        "family": family,
        "indicator_id": indicator_id,
        "version": version,
        "timezone": timezone,
        "display_timeframe_seconds": display_tf,
        "source_timeframe_seconds": source_tf,
        "mtf_policy": mtf,
        "lookahead": lookahead,
        "causal_delay_bars": delay,
        "repaint": repaint,
        "parameters": json.loads(_canonical(parameters)),
        **({"session": session} if session is not None else {}),
    }


def _confidence(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ChartOverlayContractError("confidence must be an object")
    unknown = set(value) - {"state", "value"}
    if unknown:
        raise ChartOverlayContractError(f"confidence has unsupported fields: {sorted(unknown)}")
    state = _text(value.get("state"), "confidence.state", maximum=16)
    if state not in _CONFIDENCE_STATES:
        raise ChartOverlayContractError("confidence.state is unsupported")
    raw = value.get("value")
    if state == "unknown":
        if raw is not None:
            raise ChartOverlayContractError("unknown confidence cannot contain a value")
        return {"state": state, "value": None}
    if raw is None:
        raise ChartOverlayContractError(f"{state} confidence requires a value")
    confidence = _finite_number(raw, "confidence.value")
    if not 0.0 <= confidence <= 1.0:
        raise ChartOverlayContractError("confidence.value must be between 0 and 1")
    return {"state": state, "value": confidence}


def _anchor(value: Any, name: str, cutoff: int) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {"timestamp", "price"}:
        raise ChartOverlayContractError(f"{name} must contain timestamp and price only")
    timestamp = _strict_int(value["timestamp"], f"{name}.timestamp")
    if timestamp > cutoff:
        raise ChartOverlayContractError("overlay anchor exceeds replay cutoff")
    return {"timestamp": timestamp, "price": _finite_number(value["price"], f"{name}.price", positive=True)}


def _source_bar_ids(value: Any, name: str = "overlay.source_bar_ids") -> list[str]:
    """Normalize the event bars retained with an overlay for causal replay."""

    if not isinstance(value, list) or not value:
        raise ChartOverlayContractError(f"{name} must be a non-empty list")
    if len(value) > 256:
        raise ChartOverlayContractError(f"{name} contains too many items")
    result = [_text(item, f"{name}[{index}]", maximum=128) for index, item in enumerate(value)]
    if len(set(result)) != len(result):
        raise ChartOverlayContractError(f"{name} must contain unique IDs")
    return result


def cache_key(*, indicator: dict[str, Any], source: dict[str, Any], instrument_id: str, display_timeframe_seconds: int, cutoff_timestamp: int) -> str:
    """Derive a cache identity from causal inputs and definition version."""

    normalized_indicator = validate_indicator_spec(indicator)
    payload = {
        "indicator": normalized_indicator,
        "source": _source(source),
        "instrument_id": _text(instrument_id, "instrument_id", maximum=64).upper(),
        "display_timeframe_seconds": _strict_int(display_timeframe_seconds, "display_timeframe_seconds", minimum=1),
        "cutoff_timestamp": _strict_int(cutoff_timestamp, "cutoff_timestamp"),
    }
    return _hash(payload)


def validate_overlay(overlay: dict[str, Any], *, indicator: dict[str, Any], packet_source: dict[str, Any], packet_cutoff: int) -> dict[str, Any]:
    """Validate one preview/commit/undo overlay against an indicator packet."""

    if not isinstance(overlay, dict):
        raise ChartOverlayContractError("overlay must be an object")
    _walk_forbidden(overlay)
    required = {
        "schema",
        "mode",
        "overlay_id",
        "kind",
        "instrument_id",
        "display_timeframe_seconds",
        "cutoff_timestamp",
        "source",
        "anchors",
        "confidence",
        "repaint",
        "status",
        "revision",
        "indicator_sha256",
        "cache_key",
    }
    missing = required - set(overlay)
    if missing:
        raise ChartOverlayContractError(f"overlay missing fields: {sorted(missing)}")
    unknown = set(overlay) - required - {
        "label",
        "undo_of_revision",
        # Optional for backwards compatibility with pre-causal overlay
        # packets; generated packets always include all three fields.
        "known_at",
        "source_bar_ids",
        "confirmation_lag_bars",
    }
    if unknown:
        raise ChartOverlayContractError(f"overlay has unsupported fields: {sorted(unknown)}")
    if overlay["schema"] != OVERLAY_SCHEMA or overlay["mode"] != PREP_ONLY_MODE:
        raise ChartOverlayContractError("overlay must remain PREP_ONLY and use chart-overlay-v1")
    overlay_id = _text(overlay["overlay_id"], "overlay.overlay_id", maximum=128)
    kind = _text(overlay["kind"], "overlay.kind", maximum=32)
    if kind not in _OVERLAY_KINDS:
        raise ChartOverlayContractError("overlay.kind is unsupported")
    instrument_id = _text(overlay["instrument_id"], "overlay.instrument_id", maximum=64).upper()
    display_tf = _strict_int(overlay["display_timeframe_seconds"], "overlay.display_timeframe_seconds", minimum=1)
    cutoff = _strict_int(overlay["cutoff_timestamp"], "overlay.cutoff_timestamp")
    if cutoff != packet_cutoff:
        raise ChartOverlayContractError("overlay cutoff does not match packet cutoff")
    source = _source(overlay["source"], "overlay.source")
    if source != _source(packet_source, "packet.source"):
        raise ChartOverlayContractError("overlay source does not match packet source")
    anchors = overlay["anchors"]
    expected = 2 if kind in _TWO_ANCHOR_KINDS else 1
    if not isinstance(anchors, list) or len(anchors) != expected:
        raise ChartOverlayContractError(f"{kind} requires exactly {expected} anchor(s)")
    normalized_anchors = [_anchor(item, f"overlay.anchors[{index}]", cutoff) for index, item in enumerate(anchors)]
    normalized_indicator = validate_indicator_spec(indicator)
    causal_fields = {"known_at", "source_bar_ids", "confirmation_lag_bars"}
    supplied_causal = causal_fields & set(overlay)
    if supplied_causal and supplied_causal != causal_fields:
        raise ChartOverlayContractError("causal metadata fields must be supplied together")
    known_at = None
    source_bar_ids = None
    confirmation_lag_bars = None
    if supplied_causal:
        known_at = _strict_int(overlay["known_at"], "overlay.known_at", minimum=1)
        if known_at > cutoff:
            raise ChartOverlayContractError("overlay known_at exceeds replay cutoff")
        max_anchor = max(anchor["timestamp"] for anchor in normalized_anchors)
        if known_at < max_anchor:
            raise ChartOverlayContractError("overlay known_at precedes an anchor")
        source_bar_ids = _source_bar_ids(overlay["source_bar_ids"])
        confirmation_lag_bars = _strict_int(
            overlay["confirmation_lag_bars"],
            "overlay.confirmation_lag_bars",
            minimum=0,
        )
        if confirmation_lag_bars == 0 and known_at != max_anchor:
            raise ChartOverlayContractError("overlay known_at does not match zero confirmation lag")
        if confirmation_lag_bars > normalized_indicator["causal_delay_bars"]:
            raise ChartOverlayContractError("overlay confirmation lag exceeds indicator delay")
        canonical_source_timestamps: set[int] = set()
        for source_bar_id in source_bar_ids:
            if not source_bar_id.startswith("bar:"):
                continue
            suffix = source_bar_id[4:]
            if not suffix.isdigit() or int(suffix) < 1:
                raise ChartOverlayContractError("overlay source bar ID has an invalid timestamp")
            source_timestamp = int(suffix)
            if source_timestamp > known_at:
                raise ChartOverlayContractError("overlay source bar exceeds known_at")
            canonical_source_timestamps.add(source_timestamp)
        if canonical_source_timestamps:
            anchor_timestamps = {anchor["timestamp"] for anchor in normalized_anchors}
            if not anchor_timestamps.issubset(canonical_source_timestamps):
                raise ChartOverlayContractError("overlay source bars do not cover anchors")
    confidence = _confidence(overlay["confidence"])
    repaint = _repaint(overlay["repaint"])
    status = _text(overlay["status"], "overlay.status", maximum=16)
    if status not in _STATUSES:
        raise ChartOverlayContractError("overlay.status is unsupported")
    if repaint["state"] == "provisional" and status != "preview":
        raise ChartOverlayContractError("provisional overlays are preview-only")
    revision = _strict_int(overlay["revision"], "overlay.revision", minimum=1)
    if status == "undone":
        undo_revision = _strict_int(overlay.get("undo_of_revision"), "overlay.undo_of_revision", minimum=1)
    else:
        undo_revision = None
        if "undo_of_revision" in overlay:
            raise ChartOverlayContractError("undo_of_revision is only valid for undone overlays")
    indicator_hash = _text(overlay["indicator_sha256"], "overlay.indicator_sha256", maximum=64).lower()
    if indicator_hash != definition_sha256(normalized_indicator):
        raise ChartOverlayContractError("overlay indicator_sha256 does not match indicator")
    expected_cache = cache_key(
        indicator=normalized_indicator,
        source=source,
        instrument_id=instrument_id,
        display_timeframe_seconds=display_tf,
        cutoff_timestamp=cutoff,
    )
    if _text(overlay["cache_key"], "overlay.cache_key", maximum=64).lower() != expected_cache:
        raise ChartOverlayContractError("overlay cache_key does not match causal inputs")
    label = overlay.get("label")
    if label is not None:
        label = _text(label, "overlay.label", maximum=256)
    return {
        "schema": OVERLAY_SCHEMA,
        "mode": PREP_ONLY_MODE,
        "overlay_id": overlay_id,
        "kind": kind,
        "instrument_id": instrument_id,
        "display_timeframe_seconds": display_tf,
        "cutoff_timestamp": cutoff,
        "source": source,
        "anchors": normalized_anchors,
        "confidence": confidence,
        "repaint": repaint,
        "status": status,
        "revision": revision,
        "indicator_sha256": indicator_hash,
        "cache_key": expected_cache,
        **({"label": label} if label is not None else {}),
        **({"undo_of_revision": undo_revision} if undo_revision is not None else {}),
        **(
            {
                "known_at": known_at,
                "source_bar_ids": source_bar_ids,
                "confirmation_lag_bars": confirmation_lag_bars,
            }
            if supplied_causal
            else {}
        ),
    }


def validate_overlay_packet(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate a bounded, local chart packet ready for renderer preview."""

    if not isinstance(payload, dict):
        raise ChartOverlayContractError("overlay packet must be an object")
    _walk_forbidden(payload)
    required = {"schema", "mode", "engine", "indicator", "indicator_sha256", "source", "cutoff_timestamp", "overlays"}
    missing = required - set(payload)
    if missing:
        raise ChartOverlayContractError(f"overlay packet missing fields: {sorted(missing)}")
    unknown = set(payload) - required
    if unknown:
        raise ChartOverlayContractError(f"overlay packet has unsupported fields: {sorted(unknown)}")
    if payload["schema"] != PACKET_SCHEMA or payload["mode"] != PREP_ONLY_MODE or payload["engine"] != DETERMINISTIC_ENGINE:
        raise ChartOverlayContractError("overlay packet must remain PREP_ONLY and deterministic-offline")
    indicator = validate_indicator_spec(payload["indicator"])
    indicator_hash = _text(payload["indicator_sha256"], "indicator_sha256", maximum=64).lower()
    if indicator_hash != definition_sha256(indicator):
        raise ChartOverlayContractError("packet indicator_sha256 does not match indicator")
    source = _source(payload["source"], "packet.source")
    cutoff = _strict_int(payload["cutoff_timestamp"], "packet.cutoff_timestamp")
    overlays = payload["overlays"]
    if not isinstance(overlays, list) or not overlays or len(overlays) > 256:
        raise ChartOverlayContractError("packet overlays must contain 1..256 items")
    normalized = [
        validate_overlay(item, indicator=indicator, packet_source=source, packet_cutoff=cutoff)
        for item in overlays
    ]
    ids = [item["overlay_id"] for item in normalized]
    if len(set(ids)) != len(ids):
        raise ChartOverlayContractError("packet overlay_id values must be unique")
    return {
        "schema": PACKET_SCHEMA,
        "mode": PREP_ONLY_MODE,
        "engine": DETERMINISTIC_ENGINE,
        "indicator": indicator,
        "indicator_sha256": indicator_hash,
        "source": source,
        "cutoff_timestamp": cutoff,
        "overlays": normalized,
    }

