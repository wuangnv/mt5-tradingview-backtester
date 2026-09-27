"""Causal order-block and OTE zone lifecycle contracts.

The chart intelligence module emits structure events (for example a confirmed
``BOS``), while this module turns an already-confirmed structure event or an
explicit confirmed leg into a bounded zone.  Keeping the zone lifecycle in a
separate module is intentional: a renderer may project a zone, but it must not
silently invent the origin candle, retracement leg, mitigation rule, or
invalidation rule.

This is an offline, PREP_ONLY contract.  It does not call a provider, broker,
filesystem, network, or execution route.  All timestamps are UTC close times,
and every transition records the bar at which it became knowable.  Future bars
therefore affect only later lifecycle transitions, never the already emitted
prefix.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
from typing import Any, Iterable, Literal, Mapping, Sequence

from .chart_intelligence import ChartBar


ZONE_SPEC_SCHEMA = "chart-zone-v1"
ZONE_TRANSITION_SCHEMA = "chart-zone-transition-v1"
PREP_ONLY_MODE = "PREP_ONLY"
ZONE_ENGINE = "deterministic-offline"
ZONE_RULE_VERSION = "smc-zones.v1"

ZoneKind = Literal["ORDER_BLOCK", "OTE"]
ZoneDirection = Literal["bullish", "bearish"]
ZoneState = Literal["confirmed", "mitigated", "invalidated", "expired"]

_ZONE_KINDS = frozenset({"ORDER_BLOCK", "OTE"})
_DIRECTIONS = frozenset({"bullish", "bearish"})
_STATES = frozenset({"confirmed", "mitigated", "invalidated", "expired"})
_RANGE_MODES = frozenset({"body", "wick"})
_MITIGATION_MODES = frozenset({"touch", "close_inside"})
_INVALIDATION_MODES = frozenset({"close_through", "wick_through"})
_FORBIDDEN_KEYS = frozenset(
    {
        "api_key",
        "access_token",
        "authorization",
        "broker_action",
        "broker_credentials",
        "broker_request",
        "cancel_order",
        "close_position",
        "enable_live_mode",
        "fill",
        "live_order",
        "modify_order",
        "order",
        "order_send",
        "password",
        "place_order",
        "private_key",
        "secret",
        "send_order",
    }
)


class ZoneLifecycleError(ValueError):
    """Raised when a zone contract would be ambiguous or non-causal."""


def _text(value: Any, name: str, *, maximum: int = 256) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ZoneLifecycleError(f"{name} is required")
    result = value.strip()
    if len(result) > maximum:
        raise ZoneLifecycleError(f"{name} is too long")
    return result


def _strict_int(value: Any, name: str, *, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise ZoneLifecycleError(f"{name} must be an integer >= {minimum}")
    return value


def _finite(value: Any, name: str, *, positive: bool = False) -> float:
    if isinstance(value, bool):
        raise ZoneLifecycleError(f"{name} must be finite")
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ZoneLifecycleError(f"{name} must be finite") from exc
    if not math.isfinite(result) or (positive and result <= 0):
        raise ZoneLifecycleError(f"{name} must be finite")
    return result


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
        raise ZoneLifecycleError("value must be finite JSON") from exc


def _sha256(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _walk_forbidden(value: Any, path: str = "payload") -> None:
    pending: list[tuple[str, Any]] = [(path, value)]
    while pending:
        current_path, current = pending.pop()
        if isinstance(current, Mapping):
            for key, child in current.items():
                normalized = str(key).strip().lower().replace("-", "_")
                if normalized in _FORBIDDEN_KEYS:
                    raise ZoneLifecycleError(f"{current_path}.{key} is forbidden")
                pending.append((f"{current_path}.{key}", child))
        elif isinstance(current, (list, tuple)):
            for index, child in enumerate(current):
                pending.append((f"{current_path}[{index}]", child))
        elif isinstance(current, float) and not math.isfinite(current):
            raise ZoneLifecycleError(f"{current_path} must be finite")


def _bar_id(timestamp: int) -> str:
    return f"bar:{timestamp}"


def _normalize_bars(bars: Iterable[ChartBar | Mapping[str, Any]]) -> tuple[ChartBar, ...]:
    normalized: list[ChartBar] = []
    for index, raw in enumerate(bars):
        bar = raw if isinstance(raw, ChartBar) else ChartBar.from_mapping(raw, index=index)
        if normalized and bar.timestamp <= normalized[-1].timestamp:
            reason = "duplicate" if bar.timestamp == normalized[-1].timestamp else "out of order"
            raise ZoneLifecycleError(f"bars must be strictly increasing ({reason} timestamp)")
        normalized.append(bar)
    if not normalized:
        raise ZoneLifecycleError("bars must contain at least one bar")
    return tuple(normalized)


def _source_ids(value: Any, name: str) -> tuple[str, ...]:
    if not isinstance(value, (list, tuple)) or not value:
        raise ZoneLifecycleError(f"{name} must be a non-empty array")
    if len(value) > 32:
        raise ZoneLifecycleError(f"{name} contains too many items")
    result = tuple(_text(item, f"{name}[{index}]", maximum=128) for index, item in enumerate(value))
    if len(set(result)) != len(result):
        raise ZoneLifecycleError(f"{name} must contain unique IDs")
    return result


@dataclass(frozen=True, slots=True)
class ZoneLifecycleConfig:
    """Versioned lifecycle policy shared by OB and OTE zones."""

    instrument_id: str
    timeframe_seconds: int
    range_mode: str = "wick"
    mitigation_mode: str = "touch"
    invalidation_mode: str = "close_through"
    expiry_bars: int | None = None
    rule_version: str = ZONE_RULE_VERSION

    def __post_init__(self) -> None:
        instrument = _text(self.instrument_id, "instrument_id", maximum=64).upper()
        timeframe = _strict_int(self.timeframe_seconds, "timeframe_seconds", minimum=1)
        range_mode = _text(self.range_mode, "range_mode", maximum=16).lower()
        mitigation = _text(self.mitigation_mode, "mitigation_mode", maximum=32).lower()
        invalidation = _text(self.invalidation_mode, "invalidation_mode", maximum=32).lower()
        if range_mode not in _RANGE_MODES:
            raise ZoneLifecycleError("range_mode must be body or wick")
        if mitigation not in _MITIGATION_MODES:
            raise ZoneLifecycleError("mitigation_mode must be touch or close_inside")
        if invalidation not in _INVALIDATION_MODES:
            raise ZoneLifecycleError("invalidation_mode must be close_through or wick_through")
        expiry = self.expiry_bars
        if expiry is not None:
            expiry = _strict_int(expiry, "expiry_bars", minimum=1)
        rule_version = _text(self.rule_version, "rule_version", maximum=128)
        object.__setattr__(self, "instrument_id", instrument)
        object.__setattr__(self, "timeframe_seconds", timeframe)
        object.__setattr__(self, "range_mode", range_mode)
        object.__setattr__(self, "mitigation_mode", mitigation)
        object.__setattr__(self, "invalidation_mode", invalidation)
        object.__setattr__(self, "expiry_bars", expiry)
        object.__setattr__(self, "rule_version", rule_version)

    def as_dict(self) -> dict[str, Any]:
        return {
            "instrument_id": self.instrument_id,
            "timeframe_seconds": self.timeframe_seconds,
            "range_mode": self.range_mode,
            "mitigation_mode": self.mitigation_mode,
            "invalidation_mode": self.invalidation_mode,
            "expiry_bars": self.expiry_bars,
            "rule_version": self.rule_version,
        }


@dataclass(frozen=True, slots=True)
class ZoneSpec:
    """Immutable zone definition before later lifecycle transitions."""

    zone_id: str
    kind: str
    direction: str
    instrument_id: str
    timeframe_seconds: int
    anchor_timestamp: int
    known_at: int
    source_bar_ids: tuple[str, ...]
    price_low: float
    price_high: float
    confirmation_lag_bars: int
    parameters: Mapping[str, Any]
    identity: Mapping[str, Any]
    rule_version: str = ZONE_RULE_VERSION

    def __post_init__(self) -> None:
        zone_id = _text(self.zone_id, "zone_id", maximum=128)
        kind = _text(self.kind, "kind", maximum=32).upper()
        direction = _text(self.direction, "direction", maximum=16).lower()
        instrument = _text(self.instrument_id, "instrument_id", maximum=64).upper()
        timeframe = _strict_int(self.timeframe_seconds, "timeframe_seconds", minimum=1)
        anchor = _strict_int(self.anchor_timestamp, "anchor_timestamp", minimum=1)
        known_at = _strict_int(self.known_at, "known_at", minimum=1)
        if kind not in _ZONE_KINDS:
            raise ZoneLifecycleError("kind must be ORDER_BLOCK or OTE")
        if direction not in _DIRECTIONS:
            raise ZoneLifecycleError("direction must be bullish or bearish")
        if known_at < anchor:
            raise ZoneLifecycleError("known_at precedes anchor_timestamp")
        source_ids = _source_ids(self.source_bar_ids, "source_bar_ids")
        low = _finite(self.price_low, "price_low", positive=True)
        high = _finite(self.price_high, "price_high", positive=True)
        if high < low:
            raise ZoneLifecycleError("price_high must be >= price_low")
        lag = _strict_int(self.confirmation_lag_bars, "confirmation_lag_bars", minimum=0)
        rule = _text(self.rule_version, "rule_version", maximum=128)
        if not isinstance(self.parameters, Mapping) or not isinstance(self.identity, Mapping):
            raise ZoneLifecycleError("parameters and identity must be objects")
        _walk_forbidden(self.parameters, "parameters")
        _walk_forbidden(self.identity, "identity")
        _canonical(self.parameters)
        _canonical(self.identity)
        object.__setattr__(self, "zone_id", zone_id)
        object.__setattr__(self, "kind", kind)
        object.__setattr__(self, "direction", direction)
        object.__setattr__(self, "instrument_id", instrument)
        object.__setattr__(self, "timeframe_seconds", timeframe)
        object.__setattr__(self, "anchor_timestamp", anchor)
        object.__setattr__(self, "known_at", known_at)
        object.__setattr__(self, "source_bar_ids", source_ids)
        object.__setattr__(self, "price_low", low)
        object.__setattr__(self, "price_high", high)
        object.__setattr__(self, "confirmation_lag_bars", lag)
        object.__setattr__(self, "parameters", json.loads(_canonical(dict(self.parameters))))
        object.__setattr__(self, "identity", json.loads(_canonical(dict(self.identity))))
        object.__setattr__(self, "rule_version", rule)

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema": ZONE_SPEC_SCHEMA,
            "mode": PREP_ONLY_MODE,
            "engine": ZONE_ENGINE,
            "zone_id": self.zone_id,
            "kind": self.kind,
            "direction": self.direction,
            "instrument_id": self.instrument_id,
            "timeframe_seconds": self.timeframe_seconds,
            "anchor_timestamp": self.anchor_timestamp,
            "known_at": self.known_at,
            "source_bar_ids": list(self.source_bar_ids),
            "price_low": self.price_low,
            "price_high": self.price_high,
            "confirmation_lag_bars": self.confirmation_lag_bars,
            "rule_version": self.rule_version,
            "parameters": dict(self.parameters),
            "identity": dict(self.identity),
        }


@dataclass(frozen=True, slots=True)
class ZoneTransition:
    """One immutable state transition for a zone."""

    event_id: str
    zone_id: str
    kind: str
    direction: str
    instrument_id: str
    timeframe_seconds: int
    anchor_timestamp: int
    known_at: int
    source_bar_ids: tuple[str, ...]
    price_low: float
    price_high: float
    state: str
    confirmation_lag_bars: int
    parameters: Mapping[str, Any]
    identity: Mapping[str, Any]
    rule_version: str = ZONE_RULE_VERSION

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema": ZONE_TRANSITION_SCHEMA,
            "mode": PREP_ONLY_MODE,
            "engine": ZONE_ENGINE,
            "event_id": self.event_id,
            "zone_id": self.zone_id,
            "kind": self.kind,
            "direction": self.direction,
            "instrument_id": self.instrument_id,
            "timeframe_seconds": self.timeframe_seconds,
            "anchor_timestamp": self.anchor_timestamp,
            "known_at": self.known_at,
            "source_bar_ids": list(self.source_bar_ids),
            "price_low": self.price_low,
            "price_high": self.price_high,
            "state": self.state,
            "confirmation_lag_bars": self.confirmation_lag_bars,
            "rule_version": self.rule_version,
            "parameters": dict(self.parameters),
            "identity": dict(self.identity),
        }


def _zone_id(*, config: ZoneLifecycleConfig, kind: str, direction: str, identity: Mapping[str, Any]) -> str:
    return _sha256(
        {
            "rule_version": config.rule_version,
            "instrument_id": config.instrument_id,
            "timeframe_seconds": config.timeframe_seconds,
            "kind": kind,
            "direction": direction,
            "identity": dict(identity),
        }
    )


def _transition_id(zone: ZoneSpec, state: str, known_at: int) -> str:
    return _sha256(
        {
            "rule_version": zone.rule_version,
            "zone_id": zone.zone_id,
            "state": state,
            "known_at": known_at,
        }
    )


def _transition(zone: ZoneSpec, state: str, known_at: int, source_bar_ids: Sequence[str], *, reason: str, previous_state: str | None) -> ZoneTransition:
    if state not in _STATES:
        raise ZoneLifecycleError("unsupported zone state")
    if known_at < zone.known_at:
        raise ZoneLifecycleError("zone transition precedes zone confirmation")
    source = _source_ids(source_bar_ids, "transition.source_bar_ids")
    for source_id in source:
        if source_id.startswith("bar:"):
            suffix = source_id[4:]
            if not suffix.isdigit() or int(suffix) > known_at:
                raise ZoneLifecycleError("transition source bar exceeds known_at")
    parameters = {
        **dict(zone.parameters),
        "lifecycle_state": state,
        "transition_reason": reason,
        "previous_state": previous_state,
    }
    identity = {
        **dict(zone.identity),
        "zone_id": zone.zone_id,
        "state": state,
        "transition_timestamp": known_at,
    }
    return ZoneTransition(
        event_id=_transition_id(zone, state, known_at),
        zone_id=zone.zone_id,
        kind=zone.kind,
        direction=zone.direction,
        instrument_id=zone.instrument_id,
        timeframe_seconds=zone.timeframe_seconds,
        anchor_timestamp=zone.anchor_timestamp,
        known_at=known_at,
        source_bar_ids=source,
        price_low=zone.price_low,
        price_high=zone.price_high,
        state=state,
        confirmation_lag_bars=zone.confirmation_lag_bars,
        parameters=parameters,
        identity=identity,
        rule_version=zone.rule_version,
    )


def validate_zone_transition(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Validate a serialized zone transition without adding execution power."""

    if not isinstance(raw, Mapping):
        raise ZoneLifecycleError("zone transition must be an object")
    raw = dict(raw)
    _walk_forbidden(raw)
    required = {
        "schema",
        "mode",
        "engine",
        "event_id",
        "zone_id",
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
    if set(raw) != required:
        missing = required - set(raw)
        unknown = set(raw) - required
        if missing:
            raise ZoneLifecycleError(f"zone transition missing fields: {sorted(missing)}")
        raise ZoneLifecycleError(f"zone transition has unsupported fields: {sorted(unknown)}")
    if raw["schema"] != ZONE_TRANSITION_SCHEMA or raw["mode"] != PREP_ONLY_MODE or raw["engine"] != ZONE_ENGINE:
        raise ZoneLifecycleError("zone transition schema/mode/engine is unsupported")
    kind = _text(raw["kind"], "kind", maximum=32).upper()
    direction = _text(raw["direction"], "direction", maximum=16).lower()
    state = _text(raw["state"], "state", maximum=32).lower()
    if kind not in _ZONE_KINDS:
        raise ZoneLifecycleError("kind must be ORDER_BLOCK or OTE")
    if direction not in _DIRECTIONS:
        raise ZoneLifecycleError("direction must be bullish or bearish")
    if state not in _STATES:
        raise ZoneLifecycleError("state is unsupported")
    event_id = _text(raw["event_id"], "event_id", maximum=128)
    zone_id = _text(raw["zone_id"], "zone_id", maximum=128)
    instrument = _text(raw["instrument_id"], "instrument_id", maximum=64).upper()
    timeframe = _strict_int(raw["timeframe_seconds"], "timeframe_seconds", minimum=1)
    anchor = _strict_int(raw["anchor_timestamp"], "anchor_timestamp", minimum=1)
    known_at = _strict_int(raw["known_at"], "known_at", minimum=1)
    if known_at < anchor:
        raise ZoneLifecycleError("known_at precedes anchor_timestamp")
    source_ids = _source_ids(raw["source_bar_ids"], "source_bar_ids")
    for source_id in source_ids:
        if source_id.startswith("bar:"):
            suffix = source_id[4:]
            if not suffix.isdigit() or int(suffix) > known_at:
                raise ZoneLifecycleError("source bar exceeds known_at")
    low = _finite(raw["price_low"], "price_low", positive=True)
    high = _finite(raw["price_high"], "price_high", positive=True)
    if high < low:
        raise ZoneLifecycleError("price_high must be >= price_low")
    lag = _strict_int(raw["confirmation_lag_bars"], "confirmation_lag_bars", minimum=0)
    rule = _text(raw["rule_version"], "rule_version", maximum=128)
    if not isinstance(raw["parameters"], Mapping) or not isinstance(raw["identity"], Mapping):
        raise ZoneLifecycleError("parameters and identity must be objects")
    _canonical(raw["parameters"])
    _canonical(raw["identity"])
    identity = dict(raw["identity"])
    parameters = dict(raw["parameters"])
    if identity.get("zone_id") != zone_id:
        raise ZoneLifecycleError("identity.zone_id does not match zone_id")
    if identity.get("state") != state or identity.get("transition_timestamp") != known_at:
        raise ZoneLifecycleError("transition identity does not match state/time")
    if parameters.get("lifecycle_state") != state:
        raise ZoneLifecycleError("parameters.lifecycle_state does not match state")
    expected_event_id = _sha256(
        {
            "rule_version": rule,
            "zone_id": zone_id,
            "state": state,
            "known_at": known_at,
        }
    )
    if event_id != expected_event_id:
        raise ZoneLifecycleError("event_id does not match transition identity")
    return {
        "schema": ZONE_TRANSITION_SCHEMA,
        "mode": PREP_ONLY_MODE,
        "engine": ZONE_ENGINE,
        "event_id": event_id,
        "zone_id": zone_id,
        "kind": kind,
        "direction": direction,
        "instrument_id": instrument,
        "timeframe_seconds": timeframe,
        "anchor_timestamp": anchor,
        "known_at": known_at,
        "source_bar_ids": list(source_ids),
        "price_low": low,
        "price_high": high,
        "state": state,
        "confirmation_lag_bars": lag,
        "rule_version": rule,
        "parameters": json.loads(_canonical(parameters)),
        "identity": json.loads(_canonical(identity)),
    }


def build_order_block_spec(
    bars: Iterable[ChartBar | Mapping[str, Any]],
    structure_event: Mapping[str, Any] | Any,
    config: ZoneLifecycleConfig,
) -> ZoneSpec:
    """Build one OB from a confirmed BOS and its nearest opposite candle.

    The BOS must already be confirmed by the canonical structure detector.  Its
    identity must carry the protected swing timestamp.  Searching backwards
    only between that swing and the displacement bar makes the origin rule
    deterministic and prevents a distant candle from being selected silently.
    """

    normalized = _normalize_bars(bars)
    raw_event = structure_event.as_dict() if hasattr(structure_event, "as_dict") else structure_event
    if not isinstance(raw_event, Mapping):
        raise ZoneLifecycleError("structure_event must be an object")
    event = dict(raw_event)
    _walk_forbidden(event, "structure_event")
    if event.get("schema") != "chart-event-v1":
        raise ZoneLifecycleError("structure_event must use chart-event-v1")
    if event.get("kind") != "BOS" or event.get("state") != "confirmed":
        raise ZoneLifecycleError("order block requires a confirmed BOS event")
    direction = _text(event.get("direction"), "structure_event.direction", maximum=16).lower()
    if direction not in _DIRECTIONS:
        raise ZoneLifecycleError("structure_event.direction must be bullish or bearish")
    instrument = _text(event.get("instrument_id"), "structure_event.instrument_id", maximum=64).upper()
    timeframe = _strict_int(event.get("timeframe_seconds"), "structure_event.timeframe_seconds", minimum=1)
    if instrument != config.instrument_id or timeframe != config.timeframe_seconds:
        raise ZoneLifecycleError("structure event scope does not match zone config")
    anchor = _strict_int(event.get("anchor_timestamp"), "structure_event.anchor_timestamp", minimum=1)
    known_at = _strict_int(event.get("known_at"), "structure_event.known_at", minimum=1)
    identity = event.get("identity")
    if not isinstance(identity, Mapping):
        raise ZoneLifecycleError("structure_event.identity must be an object")
    protected = identity.get("protected")
    protected_timestamp = _strict_int(protected, "structure_event.identity.protected", minimum=1)
    try:
        displacement_index = next(index for index, bar in enumerate(normalized) if bar.timestamp == anchor)
        protected_index = next(index for index, bar in enumerate(normalized) if bar.timestamp == protected_timestamp)
    except StopIteration as exc:
        raise ZoneLifecycleError("BOS anchor/protected bar is missing from input") from exc
    if known_at < anchor or known_at > normalized[-1].timestamp:
        raise ZoneLifecycleError("BOS known_at is outside bar input")
    if protected_index >= displacement_index:
        raise ZoneLifecycleError("protected swing must precede displacement bar")
    opposite = "bearish" if direction == "bullish" else "bullish"
    origin: ChartBar | None = None
    origin_index: int | None = None
    for index in range(displacement_index - 1, protected_index, -1):
        candidate = normalized[index]
        candle_direction = "bullish" if candidate.close > candidate.open else "bearish" if candidate.close < candidate.open else "neutral"
        if candle_direction == opposite:
            origin = candidate
            origin_index = index
            break
    if origin is None or origin_index is None:
        raise ZoneLifecycleError("no opposite origin candle exists before BOS")
    if config.range_mode == "body":
        price_low = min(origin.open, origin.close)
        price_high = max(origin.open, origin.close)
    else:
        price_low = origin.low
        price_high = origin.high
    event_source_ids = _source_ids(event.get("source_bar_ids"), "structure_event.source_bar_ids")
    for source_id in event_source_ids:
        if source_id.startswith("bar:"):
            suffix = source_id[4:]
            if not suffix.isdigit() or int(suffix) > known_at:
                raise ZoneLifecycleError("structure event source bar exceeds known_at")
    source_ids = tuple(dict.fromkeys((*event_source_ids, _bar_id(origin.timestamp), _bar_id(anchor))))
    zone_identity = {
        "origin_timestamp": origin.timestamp,
        "displacement_timestamp": anchor,
        "protected_timestamp": protected_timestamp,
        "source_structure_event_id": _text(event.get("event_id"), "structure_event.event_id", maximum=256),
        "range_mode": config.range_mode,
        "mitigation_mode": config.mitigation_mode,
        "invalidation_mode": config.invalidation_mode,
        "expiry_bars": config.expiry_bars,
    }
    zone_id = _zone_id(config=config, kind="ORDER_BLOCK", direction=direction, identity=zone_identity)
    parameters = {
        "origin_timestamp": origin.timestamp,
        "displacement_timestamp": anchor,
        "protected_timestamp": protected_timestamp,
        "range_mode": config.range_mode,
        "mitigation_mode": config.mitigation_mode,
        "invalidation_mode": config.invalidation_mode,
        "standalone_entry": False,
        "source_structure_event_id": zone_identity["source_structure_event_id"],
    }
    return ZoneSpec(
        zone_id=zone_id,
        kind="ORDER_BLOCK",
        direction=direction,
        instrument_id=instrument,
        timeframe_seconds=timeframe,
        anchor_timestamp=origin.timestamp,
        known_at=known_at,
        source_bar_ids=source_ids,
        price_low=price_low,
        price_high=price_high,
        confirmation_lag_bars=displacement_index - origin_index,
        parameters=parameters,
        identity=zone_identity,
        rule_version=config.rule_version,
    )


def build_ote_spec(
    bars: Iterable[ChartBar | Mapping[str, Any]],
    *,
    config: ZoneLifecycleConfig,
    direction: str,
    leg_start_timestamp: int,
    leg_end_timestamp: int,
    retracement_min: float = 0.62,
    retracement_max: float = 0.79,
    known_at: int | None = None,
) -> ZoneSpec:
    """Build an OTE zone from an explicit, already-confirmed price leg.

    OTE is a bounded retracement observation.  It intentionally carries
    ``standalone_entry=false`` and cannot become an order or broker action.
    """

    normalized = _normalize_bars(bars)
    direction = _text(direction, "direction", maximum=16).lower()
    if direction not in _DIRECTIONS:
        raise ZoneLifecycleError("direction must be bullish or bearish")
    start_timestamp = _strict_int(leg_start_timestamp, "leg_start_timestamp", minimum=1)
    end_timestamp = _strict_int(leg_end_timestamp, "leg_end_timestamp", minimum=1)
    if end_timestamp <= start_timestamp:
        raise ZoneLifecycleError("leg_end_timestamp must follow leg_start_timestamp")
    minimum = _finite(retracement_min, "retracement_min")
    maximum = _finite(retracement_max, "retracement_max")
    if not 0.0 < minimum < maximum < 1.0:
        raise ZoneLifecycleError("retracement range must satisfy 0 < min < max < 1")
    by_timestamp = {bar.timestamp: (index, bar) for index, bar in enumerate(normalized)}
    if start_timestamp not in by_timestamp or end_timestamp not in by_timestamp:
        raise ZoneLifecycleError("OTE leg endpoint is missing from input")
    start_index, start = by_timestamp[start_timestamp]
    end_index, end = by_timestamp[end_timestamp]
    if end_index <= start_index:
        raise ZoneLifecycleError("OTE leg endpoint order is invalid")
    if direction == "bullish":
        leg_low = start.low
        leg_high = end.high
        if leg_high <= leg_low:
            raise ZoneLifecycleError("bullish OTE leg must rise")
        price_low = leg_high - (leg_high - leg_low) * maximum
        price_high = leg_high - (leg_high - leg_low) * minimum
    else:
        leg_high = start.high
        leg_low = end.low
        if leg_high <= leg_low:
            raise ZoneLifecycleError("bearish OTE leg must fall")
        price_low = leg_low + (leg_high - leg_low) * minimum
        price_high = leg_low + (leg_high - leg_low) * maximum
    confirmation = end.timestamp if known_at is None else _strict_int(known_at, "known_at", minimum=1)
    if confirmation < end.timestamp:
        raise ZoneLifecycleError("OTE known_at precedes leg end")
    if confirmation > normalized[-1].timestamp:
        raise ZoneLifecycleError("OTE known_at is outside bar input")
    identity = {
        "leg_start_timestamp": start.timestamp,
        "leg_end_timestamp": end.timestamp,
        "retracement_min": minimum,
        "retracement_max": maximum,
        "mitigation_mode": config.mitigation_mode,
        "invalidation_mode": config.invalidation_mode,
        "expiry_bars": config.expiry_bars,
    }
    zone_id = _zone_id(config=config, kind="OTE", direction=direction, identity=identity)
    parameters = {
        **identity,
        "standalone_entry": False,
        "range_mode": "derived_retracement",
        "mitigation_mode": config.mitigation_mode,
        "invalidation_mode": config.invalidation_mode,
    }
    return ZoneSpec(
        zone_id=zone_id,
        kind="OTE",
        direction=direction,
        instrument_id=config.instrument_id,
        timeframe_seconds=config.timeframe_seconds,
        anchor_timestamp=end.timestamp,
        known_at=confirmation,
        source_bar_ids=(_bar_id(start.timestamp), _bar_id(end.timestamp)),
        price_low=price_low,
        price_high=price_high,
        confirmation_lag_bars=end_index - start_index,
        parameters=parameters,
        identity=identity,
        rule_version=config.rule_version,
    )


def _is_mitigated(bar: ChartBar, zone: ZoneSpec, mode: str) -> bool:
    if mode == "close_inside":
        return zone.price_low <= bar.close <= zone.price_high
    return bar.low <= zone.price_high and bar.high >= zone.price_low


def _is_invalidated(bar: ChartBar, zone: ZoneSpec, mode: str) -> bool:
    if zone.direction == "bullish":
        return bar.close < zone.price_low if mode == "close_through" else bar.low < zone.price_low
    return bar.close > zone.price_high if mode == "close_through" else bar.high > zone.price_high


def evaluate_zone_lifecycle(
    bars: Iterable[ChartBar | Mapping[str, Any]],
    zone: ZoneSpec,
    config: ZoneLifecycleConfig,
    *,
    cutoff_timestamp: int | None = None,
) -> tuple[ZoneTransition, ...]:
    """Emit a deterministic prefix of zone lifecycle transitions.

    Invalidation has precedence over mitigation on a bar that crosses the
    invalidation boundary.  An expired zone is terminal; a mitigated zone may
    still transition to invalidated if a later bar closes/wicks through it.
    """

    normalized = _normalize_bars(bars)
    if zone.instrument_id != config.instrument_id or zone.timeframe_seconds != config.timeframe_seconds:
        raise ZoneLifecycleError("zone scope does not match lifecycle config")
    cutoff = normalized[-1].timestamp if cutoff_timestamp is None else _strict_int(cutoff_timestamp, "cutoff_timestamp", minimum=1)
    if cutoff < zone.known_at:
        raise ZoneLifecycleError("cutoff precedes zone confirmation")
    if any(source_id.startswith("bar:") and source_id[4:].isdigit() and int(source_id[4:]) > zone.known_at for source_id in zone.source_bar_ids):
        raise ZoneLifecycleError("zone source bar exceeds known_at")
    events: list[ZoneTransition] = [
        _transition(zone, "confirmed", zone.known_at, zone.source_bar_ids, reason="zone_confirmed", previous_state=None)
    ]
    current_state = "confirmed"
    bars_seen = 0
    for bar in normalized:
        if bar.timestamp <= zone.known_at:
            continue
        if bar.timestamp > cutoff:
            break
        bars_seen += 1
        if _is_invalidated(bar, zone, config.invalidation_mode):
            events.append(
                _transition(
                    zone,
                    "invalidated",
                    bar.timestamp,
                    (*zone.source_bar_ids, _bar_id(bar.timestamp)),
                    reason=f"{config.invalidation_mode}",
                    previous_state=current_state,
                )
            )
            break
        if current_state == "confirmed" and _is_mitigated(bar, zone, config.mitigation_mode):
            events.append(
                _transition(
                    zone,
                    "mitigated",
                    bar.timestamp,
                    (*zone.source_bar_ids, _bar_id(bar.timestamp)),
                    reason=config.mitigation_mode,
                    previous_state=current_state,
                )
            )
            current_state = "mitigated"
            continue
        if current_state == "confirmed" and config.expiry_bars is not None and bars_seen >= config.expiry_bars:
            events.append(
                _transition(
                    zone,
                    "expired",
                    bar.timestamp,
                    (*zone.source_bar_ids, _bar_id(bar.timestamp)),
                    reason="expiry_bars",
                    previous_state=current_state,
                )
            )
            break
    return tuple(events)


def build_order_block_lifecycle(
    bars: Iterable[ChartBar | Mapping[str, Any]],
    structure_event: Mapping[str, Any] | Any,
    config: ZoneLifecycleConfig,
    *,
    cutoff_timestamp: int | None = None,
) -> tuple[ZoneTransition, ...]:
    """Build one OB and evaluate its causal lifecycle through a cutoff."""

    normalized = _normalize_bars(bars)
    zone = build_order_block_spec(normalized, structure_event, config)
    return evaluate_zone_lifecycle(normalized, zone, config, cutoff_timestamp=cutoff_timestamp)


def build_ote_lifecycle(
    bars: Iterable[ChartBar | Mapping[str, Any]],
    *,
    config: ZoneLifecycleConfig,
    direction: str,
    leg_start_timestamp: int,
    leg_end_timestamp: int,
    retracement_min: float = 0.62,
    retracement_max: float = 0.79,
    known_at: int | None = None,
    cutoff_timestamp: int | None = None,
) -> tuple[ZoneTransition, ...]:
    """Build one OTE zone and evaluate its causal lifecycle through a cutoff."""

    normalized = _normalize_bars(bars)
    zone = build_ote_spec(
        normalized,
        config=config,
        direction=direction,
        leg_start_timestamp=leg_start_timestamp,
        leg_end_timestamp=leg_end_timestamp,
        retracement_min=retracement_min,
        retracement_max=retracement_max,
        known_at=known_at,
    )
    return evaluate_zone_lifecycle(normalized, zone, config, cutoff_timestamp=cutoff_timestamp)


__all__ = [
    "PREP_ONLY_MODE",
    "ZONE_ENGINE",
    "ZONE_RULE_VERSION",
    "ZONE_SPEC_SCHEMA",
    "ZONE_TRANSITION_SCHEMA",
    "ZoneLifecycleConfig",
    "ZoneLifecycleError",
    "ZoneSpec",
    "ZoneTransition",
    "build_order_block_lifecycle",
    "build_order_block_spec",
    "build_ote_lifecycle",
    "build_ote_spec",
    "evaluate_zone_lifecycle",
    "validate_zone_transition",
]
