"""Deterministic local/advisory alert contracts for chart events.

This module is the C6 boundary between the causal chart engine and a future
local notification adapter.  It deliberately stops at an immutable alert
receipt: there is no network delivery, provider, broker, fill, order, or
execution capability here.

The important identity rule is ``(rule_sha256, event_id)``.  A reconnect or a
replay may present the same confirmed event again, but it cannot create a
second receipt when the caller carries the returned :class:`AlertLedger`.
Input and rule snapshots remain attached to each receipt so a future adapter
can explain exactly why the advisory was emitted without consulting mutable
state.
"""

from __future__ import annotations

from dataclasses import dataclass
import copy
import hashlib
import json
import math
from typing import Any, Iterable, Mapping


ALERT_RULE_SCHEMA = "chart-alert-rule-v1"
ALERT_INPUT_SCHEMA = "chart-alert-input-snapshot-v1"
ALERT_RECEIPT_SCHEMA = "chart-alert-receipt-v1"
ALERT_LEDGER_SCHEMA = "chart-alert-ledger-v1"
ALERT_EVALUATION_SCHEMA = "chart-alert-evaluation-v1"
PREP_ONLY_MODE = "PREP_ONLY"
ALERT_ENGINE = "offline-advisory"

_EVENT_SCHEMA = "chart-event-v1"
_CONFIRMED = "confirmed"
_DELIVERY = "local_advisory"
_REPLAY_POLICY = "dedupe_event_id"
_ALLOWED_KINDS = frozenset(
    {
        "FVG",
        "SWING",
        "BOS",
        "CHOCH",
        "MSS",
        "LIQUIDITY",
        "SWEEP",
        "ORDER_BLOCK",
        "OTE",
        "SESSION",
    }
)
_ALLOWED_DIRECTIONS = frozenset({"bullish", "bearish", "neutral", "any"})
_FORBIDDEN_KEYS = frozenset(
    {
        "api_key",
        "access_token",
        "authorization",
        "broker_credentials",
        "broker_action",
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
_MAX_RULE_BYTES = 16_384
_MAX_INPUT_BYTES = 131_072
_MAX_EVENTS = 4_096
_MAX_LEDGER_IDS = 16_384
_MAX_TTL_SECONDS = 31_536_000  # one year; avoids an unbounded local ledger


class ChartAlertContractError(ValueError):
    """Raised when an advisory alert would be ambiguous or unsafe."""


def _text(value: Any, name: str, *, maximum: int = 256) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ChartAlertContractError(f"{name} is required")
    result = value.strip()
    if len(result) > maximum:
        raise ChartAlertContractError(f"{name} is too long")
    return result


def _strict_int(value: Any, name: str, *, minimum: int = 0, maximum: int | None = None) -> int:
    if type(value) is not int or value < minimum or (maximum is not None and value > maximum):
        suffix = f" and <= {maximum}" if maximum is not None else ""
        raise ChartAlertContractError(f"{name} must be an integer >= {minimum}{suffix}")
    return value


def _finite(value: Any, name: str, *, positive: bool = False) -> float:
    if isinstance(value, bool):
        raise ChartAlertContractError(f"{name} must be a finite number")
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ChartAlertContractError(f"{name} must be a finite number") from exc
    if not math.isfinite(result) or (positive and result <= 0):
        raise ChartAlertContractError(f"{name} must be a finite number")
    return result


def _canonical(value: Any, *, maximum: int | None = None) -> bytes:
    try:
        result = json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError, RecursionError) as exc:
        raise ChartAlertContractError("value must be finite JSON") from exc
    if maximum is not None and len(result) > maximum:
        raise ChartAlertContractError(f"canonical JSON exceeds {maximum} bytes")
    return result


def _sha256(value: Any, *, maximum: int | None = None) -> str:
    return hashlib.sha256(_canonical(value, maximum=maximum)).hexdigest()


def _walk_forbidden(value: Any, path: str = "payload") -> None:
    """Reject execution-looking keys in rules, events, and snapshots."""

    pending: list[tuple[str, Any]] = [(path, value)]
    while pending:
        current_path, current = pending.pop()
        if isinstance(current, dict):
            for key, child in current.items():
                normalized = str(key).strip().lower().replace("-", "_")
                if normalized in _FORBIDDEN_KEYS:
                    raise ChartAlertContractError(f"{current_path}.{key} is forbidden")
                pending.append((f"{current_path}.{key}", child))
        elif isinstance(current, (list, tuple)):
            for index, child in enumerate(current):
                pending.append((f"{current_path}[{index}]", child))
        elif isinstance(current, float) and not math.isfinite(current):
            raise ChartAlertContractError(f"{current_path} must be finite")
        elif isinstance(current, bytes):
            raise ChartAlertContractError(f"{current_path} must be JSON text")


def _unique_texts(value: Any, name: str, *, maximum_item: int = 256, maximum_items: int = 128) -> tuple[str, ...]:
    if not isinstance(value, (list, tuple)):
        raise ChartAlertContractError(f"{name} must be an array")
    if len(value) > maximum_items:
        raise ChartAlertContractError(f"{name} has too many items")
    result = tuple(_text(item, f"{name}[{index}]", maximum=maximum_item) for index, item in enumerate(value))
    if len(set(result)) != len(result):
        raise ChartAlertContractError(f"{name} must contain unique values")
    return result


def _positive_ints(value: Any, name: str) -> tuple[int, ...]:
    if not isinstance(value, (list, tuple)):
        raise ChartAlertContractError(f"{name} must be an array")
    if len(value) > 64:
        raise ChartAlertContractError(f"{name} has too many items")
    result = tuple(_strict_int(item, f"{name}[{index}]", minimum=1) for index, item in enumerate(value))
    if len(set(result)) != len(result):
        raise ChartAlertContractError(f"{name} must contain unique values")
    return result


def validate_alert_rule(rule: Mapping[str, Any]) -> dict[str, Any]:
    """Return a canonical, local-only alert rule.

    ``confirmed_only`` and the no-execution fields are intentionally mandatory
    even though they have fixed values.  A future caller cannot accidentally
    make an advisory rule provisional or turn it into a trade route by
    omitting a safety field.
    """

    if not isinstance(rule, Mapping):
        raise ChartAlertContractError("rule must be an object")
    raw = dict(rule)
    _walk_forbidden(raw, "rule")
    required = {
        "schema",
        "mode",
        "engine",
        "rule_id",
        "version",
        "enabled",
        "event_kinds",
        "directions",
        "instruments",
        "timeframes_seconds",
        "ttl_seconds",
        "delivery",
        "confirmed_only",
        "replay_policy",
        "execution_capability",
        "order_effect",
        "fill_effect",
    }
    missing = required - set(raw)
    if missing:
        raise ChartAlertContractError(f"rule missing fields: {sorted(missing)}")
    unknown = set(raw) - required
    if unknown:
        raise ChartAlertContractError(f"rule has unsupported fields: {sorted(unknown)}")
    if raw["schema"] != ALERT_RULE_SCHEMA or raw["mode"] != PREP_ONLY_MODE or raw["engine"] != ALERT_ENGINE:
        raise ChartAlertContractError("rule must remain PREP_ONLY and use offline-advisory")
    rule_id = _text(raw["rule_id"], "rule.rule_id", maximum=128)
    version = _text(raw["version"], "rule.version", maximum=64)
    if type(raw["enabled"]) is not bool:
        raise ChartAlertContractError("rule.enabled must be boolean")
    kinds = _unique_texts(raw["event_kinds"], "rule.event_kinds", maximum_item=32, maximum_items=32)
    if not kinds:
        raise ChartAlertContractError("rule.event_kinds must not be empty")
    if any(kind not in _ALLOWED_KINDS for kind in kinds):
        raise ChartAlertContractError("rule.event_kinds contains an unsupported event kind")
    directions = _unique_texts(raw["directions"], "rule.directions", maximum_item=16, maximum_items=8)
    if not directions:
        raise ChartAlertContractError("rule.directions must not be empty")
    if any(direction not in _ALLOWED_DIRECTIONS for direction in directions):
        raise ChartAlertContractError("rule.directions contains an unsupported direction")
    if "any" in directions and len(directions) != 1:
        raise ChartAlertContractError("rule.directions any cannot be combined with a concrete direction")
    instruments = _unique_texts(raw["instruments"], "rule.instruments", maximum_item=64, maximum_items=64)
    timeframes = _positive_ints(raw["timeframes_seconds"], "rule.timeframes_seconds")
    ttl = _strict_int(raw["ttl_seconds"], "rule.ttl_seconds", minimum=1, maximum=_MAX_TTL_SECONDS)
    if raw["delivery"] != _DELIVERY:
        raise ChartAlertContractError("rule.delivery must be local_advisory")
    if raw["confirmed_only"] is not True:
        raise ChartAlertContractError("rule.confirmed_only must be true")
    if raw["replay_policy"] != _REPLAY_POLICY:
        raise ChartAlertContractError("rule.replay_policy must be dedupe_event_id")
    if raw["execution_capability"] is not False or raw["order_effect"] != "none" or raw["fill_effect"] != "none":
        raise ChartAlertContractError("alert rule cannot have execution, order, or fill effects")
    normalized = {
        "schema": ALERT_RULE_SCHEMA,
        "mode": PREP_ONLY_MODE,
        "engine": ALERT_ENGINE,
        "rule_id": rule_id,
        "version": version,
        "enabled": raw["enabled"],
        "event_kinds": list(kinds),
        "directions": list(directions),
        "instruments": list(instruments),
        "timeframes_seconds": list(timeframes),
        "ttl_seconds": ttl,
        "delivery": _DELIVERY,
        "confirmed_only": True,
        "replay_policy": _REPLAY_POLICY,
        "execution_capability": False,
        "order_effect": "none",
        "fill_effect": "none",
    }
    _canonical(normalized, maximum=_MAX_RULE_BYTES)
    return normalized


def rule_sha256(rule: Mapping[str, Any]) -> str:
    """Hash the canonical normalized rule snapshot."""

    normalized = validate_alert_rule(rule)
    return _sha256(normalized, maximum=_MAX_RULE_BYTES)


def _normalize_event(event: Any, *, index: int) -> dict[str, Any]:
    if hasattr(event, "as_dict") and callable(event.as_dict):
        event = event.as_dict()
    if not isinstance(event, Mapping):
        raise ChartAlertContractError(f"events[{index}] must be an object")
    raw = dict(event)
    _walk_forbidden(raw, f"events[{index}]")
    required = {
        "schema",
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
    missing = required - set(raw)
    if missing:
        raise ChartAlertContractError(f"events[{index}] missing fields: {sorted(missing)}")
    unknown = set(raw) - required
    if unknown:
        raise ChartAlertContractError(f"events[{index}] has unsupported fields: {sorted(unknown)}")
    if raw["schema"] != _EVENT_SCHEMA:
        raise ChartAlertContractError(f"events[{index}].schema is unsupported")
    event_id = _text(raw["event_id"], f"events[{index}].event_id", maximum=256)
    kind = _text(raw["kind"], f"events[{index}].kind", maximum=32).upper()
    if kind not in _ALLOWED_KINDS:
        raise ChartAlertContractError(f"events[{index}].kind is unsupported")
    direction = _text(raw["direction"], f"events[{index}].direction", maximum=16).lower()
    if direction not in _ALLOWED_DIRECTIONS - {"any"}:
        raise ChartAlertContractError(f"events[{index}].direction is unsupported")
    instrument = _text(raw["instrument_id"], f"events[{index}].instrument_id", maximum=64)
    timeframe = _strict_int(raw["timeframe_seconds"], f"events[{index}].timeframe_seconds", minimum=1)
    anchor = _strict_int(raw["anchor_timestamp"], f"events[{index}].anchor_timestamp", minimum=1)
    known_at = _strict_int(raw["known_at"], f"events[{index}].known_at", minimum=1)
    if known_at < anchor:
        raise ChartAlertContractError(f"events[{index}].known_at precedes anchor_timestamp")
    source_ids = _unique_texts(raw["source_bar_ids"], f"events[{index}].source_bar_ids", maximum_item=128, maximum_items=256)
    if not source_ids:
        raise ChartAlertContractError(f"events[{index}].source_bar_ids must not be empty")
    low = _finite(raw["price_low"], f"events[{index}].price_low", positive=True)
    high = _finite(raw["price_high"], f"events[{index}].price_high", positive=True)
    if high < low:
        raise ChartAlertContractError(f"events[{index}].price_high must be >= price_low")
    state = _text(raw["state"], f"events[{index}].state", maximum=32).lower()
    if state not in {"confirmed", "provisional", "invalidated"}:
        raise ChartAlertContractError(f"events[{index}].state is unsupported")
    lag = _strict_int(raw["confirmation_lag_bars"], f"events[{index}].confirmation_lag_bars", minimum=0)
    rule_version = _text(raw["rule_version"], f"events[{index}].rule_version", maximum=128)
    if not isinstance(raw["parameters"], Mapping) or not isinstance(raw["identity"], Mapping):
        raise ChartAlertContractError(f"events[{index}].parameters and identity must be objects")
    normalized = {
        "schema": _EVENT_SCHEMA,
        "event_id": event_id,
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
        "rule_version": rule_version,
        "parameters": copy.deepcopy(dict(raw["parameters"])),
        "identity": copy.deepcopy(dict(raw["identity"])),
    }
    _canonical(normalized)
    return normalized


def _normalize_events(events: Iterable[Any]) -> tuple[dict[str, Any], ...]:
    if isinstance(events, (str, bytes, Mapping)):
        raise ChartAlertContractError("events must be an iterable of event objects")
    try:
        raw_events = list(events)
    except TypeError as exc:
        raise ChartAlertContractError("events must be an iterable of event objects") from exc
    if len(raw_events) > _MAX_EVENTS:
        raise ChartAlertContractError(f"events cannot exceed {_MAX_EVENTS} items")
    normalized = tuple(_normalize_event(event, index=index) for index, event in enumerate(raw_events))
    ids = [event["event_id"] for event in normalized]
    if len(ids) != len(set(ids)):
        raise ChartAlertContractError("events contain duplicate event_id values")
    return tuple(sorted(normalized, key=lambda item: (item["known_at"], item["event_id"])))


def build_input_snapshot(events: Iterable[Any], cutoff_timestamp: int) -> dict[str, Any]:
    """Build the bounded hashable input identity used by each receipt."""

    cutoff = _strict_int(cutoff_timestamp, "cutoff_timestamp", minimum=1)
    normalized = _normalize_events(events)
    if any(event["known_at"] > cutoff for event in normalized):
        raise ChartAlertContractError("events beyond cutoff_timestamp are forbidden")
    fingerprints = [
        {
            "event_id": event["event_id"],
            "event_sha256": _sha256(event),
            "known_at": event["known_at"],
        }
        for event in normalized
    ]
    snapshot = {
        "schema": ALERT_INPUT_SCHEMA,
        "cutoff_timestamp": cutoff,
        "event_count": len(normalized),
        "events": fingerprints,
    }
    _canonical(snapshot, maximum=_MAX_INPUT_BYTES)
    return snapshot


def input_snapshot_sha256(snapshot: Mapping[str, Any]) -> str:
    normalized = _validate_input_snapshot(snapshot)
    return _sha256(normalized, maximum=_MAX_INPUT_BYTES)


def _validate_input_snapshot(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(snapshot, Mapping):
        raise ChartAlertContractError("input snapshot must be an object")
    raw = dict(snapshot)
    _walk_forbidden(raw, "input_snapshot")
    required = {"schema", "cutoff_timestamp", "event_count", "events"}
    missing = required - set(raw)
    if missing:
        raise ChartAlertContractError(f"input snapshot missing fields: {sorted(missing)}")
    unknown = set(raw) - required
    if unknown:
        raise ChartAlertContractError(f"input snapshot has unsupported fields: {sorted(unknown)}")
    if raw["schema"] != ALERT_INPUT_SCHEMA:
        raise ChartAlertContractError("input snapshot schema is unsupported")
    cutoff = _strict_int(raw["cutoff_timestamp"], "input_snapshot.cutoff_timestamp", minimum=1)
    count = _strict_int(raw["event_count"], "input_snapshot.event_count", minimum=0, maximum=_MAX_EVENTS)
    fingerprints = raw["events"]
    if not isinstance(fingerprints, list) or len(fingerprints) != count:
        raise ChartAlertContractError("input snapshot event_count does not match events")
    normalized_events: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for index, item in enumerate(fingerprints):
        if not isinstance(item, Mapping):
            raise ChartAlertContractError(f"input_snapshot.events[{index}] must be an object")
        if set(item) != {"event_id", "event_sha256", "known_at"}:
            raise ChartAlertContractError(f"input_snapshot.events[{index}] has unsupported fields")
        event_id = _text(item.get("event_id"), f"input_snapshot.events[{index}].event_id", maximum=256)
        if event_id in seen_ids:
            raise ChartAlertContractError("input snapshot contains duplicate event IDs")
        seen_ids.add(event_id)
        digest = _validate_digest(item.get("event_sha256"), f"input_snapshot.events[{index}].event_sha256")
        known_at = _strict_int(item.get("known_at"), f"input_snapshot.events[{index}].known_at", minimum=1)
        if known_at > cutoff:
            raise ChartAlertContractError("input snapshot contains an event beyond cutoff")
        normalized_events.append({"event_id": event_id, "event_sha256": digest, "known_at": known_at})
    expected_order = sorted(normalized_events, key=lambda item: (item["known_at"], item["event_id"]))
    if normalized_events != expected_order:
        raise ChartAlertContractError("input snapshot events must be sorted causally")
    return {
        "schema": ALERT_INPUT_SCHEMA,
        "cutoff_timestamp": cutoff,
        "event_count": count,
        "events": normalized_events,
    }


def _alert_id(rule_digest: str, event_id: str) -> str:
    return _sha256({"rule_sha256": rule_digest, "event_id": event_id})


def _validate_digest(value: Any, name: str) -> str:
    candidate = _text(value, name, maximum=64).lower()
    if len(candidate) != 64 or any(character not in "0123456789abcdef" for character in candidate):
        raise ChartAlertContractError(f"{name} must be a SHA-256 hex digest")
    return candidate


@dataclass(frozen=True, slots=True)
class AlertLedger:
    """Local dedupe state carried across reconnects and replay passes."""

    rule_sha256: str
    delivered_alert_ids: tuple[str, ...] = ()
    expired_alert_ids: tuple[str, ...] = ()
    generation: int = 0
    last_cutoff_timestamp: int | None = None

    def __post_init__(self) -> None:
        _validate_digest(self.rule_sha256, "ledger.rule_sha256")
        if len(self.delivered_alert_ids) > _MAX_LEDGER_IDS or len(self.expired_alert_ids) > _MAX_LEDGER_IDS:
            raise ChartAlertContractError("ledger exceeds bounded alert ID capacity")
        for name, values in (("delivered_alert_ids", self.delivered_alert_ids), ("expired_alert_ids", self.expired_alert_ids)):
            if not isinstance(values, tuple) or any(not isinstance(value, str) or not value for value in values):
                raise ChartAlertContractError(f"ledger.{name} must contain non-empty IDs")
            if len(set(values)) != len(values):
                raise ChartAlertContractError(f"ledger.{name} must be unique")
        if set(self.delivered_alert_ids) & set(self.expired_alert_ids):
            raise ChartAlertContractError("an alert cannot be both delivered and expired")
        _strict_int(self.generation, "ledger.generation", minimum=0)
        if self.last_cutoff_timestamp is not None:
            _strict_int(self.last_cutoff_timestamp, "ledger.last_cutoff_timestamp", minimum=1)

    @classmethod
    def empty(cls, rule: Mapping[str, Any]) -> "AlertLedger":
        return cls(rule_sha256=rule_sha256(rule))

    @classmethod
    def from_mapping(cls, payload: Mapping[str, Any]) -> "AlertLedger":
        if not isinstance(payload, Mapping):
            raise ChartAlertContractError("ledger must be an object")
        allowed = {
            "schema",
            "mode",
            "engine",
            "rule_sha256",
            "delivered_alert_ids",
            "expired_alert_ids",
            "generation",
            "last_cutoff_timestamp",
        }
        unknown = set(payload) - allowed
        if unknown:
            raise ChartAlertContractError(f"ledger has unsupported fields: {sorted(unknown)}")
        if payload.get("schema") != ALERT_LEDGER_SCHEMA or payload.get("mode") != PREP_ONLY_MODE or payload.get("engine") != ALERT_ENGINE:
            raise ChartAlertContractError("ledger schema or mode is unsupported")
        return cls(
            rule_sha256=_validate_digest(payload.get("rule_sha256"), "ledger.rule_sha256"),
            delivered_alert_ids=tuple(payload.get("delivered_alert_ids", ())),
            expired_alert_ids=tuple(payload.get("expired_alert_ids", ())),
            generation=_strict_int(payload.get("generation"), "ledger.generation", minimum=0),
            last_cutoff_timestamp=payload.get("last_cutoff_timestamp"),
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema": ALERT_LEDGER_SCHEMA,
            "mode": PREP_ONLY_MODE,
            "engine": ALERT_ENGINE,
            "rule_sha256": self.rule_sha256,
            "delivered_alert_ids": list(self.delivered_alert_ids),
            "expired_alert_ids": list(self.expired_alert_ids),
            "generation": self.generation,
            "last_cutoff_timestamp": self.last_cutoff_timestamp,
        }


@dataclass(frozen=True, slots=True)
class AlertEvaluation:
    """Immutable offline evaluation result and the next dedupe ledger."""

    rule_snapshot: dict[str, Any]
    rule_sha256: str
    input_snapshot: dict[str, Any]
    input_snapshot_sha256: str
    cutoff_timestamp: int
    as_of_timestamp: int
    emitted: tuple[dict[str, Any], ...]
    suppressed: tuple[dict[str, Any], ...]
    next_ledger: AlertLedger

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema": ALERT_EVALUATION_SCHEMA,
            "mode": PREP_ONLY_MODE,
            "engine": ALERT_ENGINE,
            "rule_snapshot": copy.deepcopy(self.rule_snapshot),
            "rule_sha256": self.rule_sha256,
            "input_snapshot": copy.deepcopy(self.input_snapshot),
            "input_snapshot_sha256": self.input_snapshot_sha256,
            "cutoff_timestamp": self.cutoff_timestamp,
            "as_of_timestamp": self.as_of_timestamp,
            "emitted": copy.deepcopy(list(self.emitted)),
            "suppressed": copy.deepcopy(list(self.suppressed)),
            "next_ledger": self.next_ledger.as_dict(),
        }


def _matches(rule: Mapping[str, Any], event: Mapping[str, Any]) -> bool:
    if event["kind"] not in rule["event_kinds"]:
        return False
    if "any" not in rule["directions"] and event["direction"] not in rule["directions"]:
        return False
    if rule["instruments"] and event["instrument_id"] not in rule["instruments"]:
        return False
    if rule["timeframes_seconds"] and event["timeframe_seconds"] not in rule["timeframes_seconds"]:
        return False
    return True


def _build_receipt(
    *,
    rule: Mapping[str, Any],
    rule_digest: str,
    event: Mapping[str, Any],
    input_snapshot: Mapping[str, Any],
    input_digest: str,
    cutoff: int,
    expires_at: int,
) -> dict[str, Any]:
    alert_id = _alert_id(rule_digest, event["event_id"])
    receipt = {
        "schema": ALERT_RECEIPT_SCHEMA,
        "mode": PREP_ONLY_MODE,
        "engine": ALERT_ENGINE,
        "status": "emitted",
        "alert_id": alert_id,
        "dedupe_key": f"{rule_digest}:{event['event_id']}",
        "rule_id": rule["rule_id"],
        "rule_version": rule["version"],
        "rule_sha256": rule_digest,
        "rule_snapshot": copy.deepcopy(dict(rule)),
        "event_id": event["event_id"],
        "event_snapshot": copy.deepcopy(dict(event)),
        "input_snapshot": copy.deepcopy(dict(input_snapshot)),
        "input_snapshot_sha256": input_digest,
        "event_known_at": event["known_at"],
        "evaluation_cutoff_timestamp": cutoff,
        "emitted_at_timestamp": event["known_at"],
        "expires_at_timestamp": expires_at,
        "delivery": _DELIVERY,
        "execution_capability": False,
        "order_effect": "none",
        "fill_effect": "none",
        "replay_safe": True,
    }
    return validate_alert_receipt(receipt)


def validate_alert_receipt(receipt: Mapping[str, Any]) -> dict[str, Any]:
    """Validate an immutable receipt before a local adapter can display it."""

    if not isinstance(receipt, Mapping):
        raise ChartAlertContractError("receipt must be an object")
    raw = copy.deepcopy(dict(receipt))
    _walk_forbidden(raw, "receipt")
    required = {
        "schema",
        "mode",
        "engine",
        "status",
        "alert_id",
        "dedupe_key",
        "rule_id",
        "rule_version",
        "rule_sha256",
        "rule_snapshot",
        "event_id",
        "event_snapshot",
        "input_snapshot",
        "input_snapshot_sha256",
        "event_known_at",
        "evaluation_cutoff_timestamp",
        "emitted_at_timestamp",
        "expires_at_timestamp",
        "delivery",
        "execution_capability",
        "order_effect",
        "fill_effect",
        "replay_safe",
    }
    missing = required - set(raw)
    if missing:
        raise ChartAlertContractError(f"receipt missing fields: {sorted(missing)}")
    unknown = set(raw) - required
    if unknown:
        raise ChartAlertContractError(f"receipt has unsupported fields: {sorted(unknown)}")
    if raw["schema"] != ALERT_RECEIPT_SCHEMA or raw["mode"] != PREP_ONLY_MODE or raw["engine"] != ALERT_ENGINE:
        raise ChartAlertContractError("receipt schema or mode is unsupported")
    if raw["status"] != "emitted" or raw["delivery"] != _DELIVERY:
        raise ChartAlertContractError("receipt status or delivery is unsupported")
    if raw["execution_capability"] is not False or raw["order_effect"] != "none" or raw["fill_effect"] != "none":
        raise ChartAlertContractError("receipt cannot contain execution, order, or fill effects")
    if raw["replay_safe"] is not True:
        raise ChartAlertContractError("receipt.replay_safe must be true")
    alert_id = _text(raw["alert_id"], "receipt.alert_id", maximum=64).lower()
    if len(alert_id) != 64 or any(character not in "0123456789abcdef" for character in alert_id):
        raise ChartAlertContractError("receipt.alert_id must be a SHA-256 hex digest")
    event_id = _text(raw["event_id"], "receipt.event_id", maximum=256)
    rule_digest = _validate_digest(raw["rule_sha256"], "receipt.rule_sha256")
    if raw["dedupe_key"] != f"{rule_digest}:{event_id}":
        raise ChartAlertContractError("receipt.dedupe_key does not match rule/event identity")
    if not isinstance(raw["rule_snapshot"], Mapping):
        raise ChartAlertContractError("receipt.rule_snapshot must be an object")
    normalized_rule = validate_alert_rule(raw["rule_snapshot"])
    if rule_sha256(normalized_rule) != rule_digest:
        raise ChartAlertContractError("receipt.rule_snapshot hash mismatch")
    if raw["rule_id"] != normalized_rule["rule_id"] or raw["rule_version"] != normalized_rule["version"]:
        raise ChartAlertContractError("receipt rule identity mismatch")
    if not isinstance(raw["event_snapshot"], Mapping):
        raise ChartAlertContractError("receipt.event_snapshot must be an object")
    event = _normalize_event(raw["event_snapshot"], index=0)
    if event["event_id"] != event_id or event["state"] != _CONFIRMED:
        raise ChartAlertContractError("receipt event must be the confirmed referenced event")
    if not isinstance(raw["input_snapshot"], Mapping):
        raise ChartAlertContractError("receipt.input_snapshot must be an object")
    snapshot = dict(raw["input_snapshot"])
    if input_snapshot_sha256(snapshot) != _validate_digest(raw["input_snapshot_sha256"], "receipt.input_snapshot_sha256"):
        raise ChartAlertContractError("receipt input snapshot hash mismatch")
    event_known_at = _strict_int(raw["event_known_at"], "receipt.event_known_at", minimum=1)
    cutoff = _strict_int(raw["evaluation_cutoff_timestamp"], "receipt.evaluation_cutoff_timestamp", minimum=1)
    emitted = _strict_int(raw["emitted_at_timestamp"], "receipt.emitted_at_timestamp", minimum=1)
    expires = _strict_int(raw["expires_at_timestamp"], "receipt.expires_at_timestamp", minimum=1)
    if event_known_at != event["known_at"] or emitted != event_known_at or event_known_at > cutoff or expires <= event_known_at:
        raise ChartAlertContractError("receipt timestamps violate causal or expiry ordering")
    if snapshot.get("cutoff_timestamp") != cutoff:
        raise ChartAlertContractError("receipt input snapshot cutoff mismatch")
    fingerprints = snapshot.get("events")
    if not isinstance(fingerprints, list):
        raise ChartAlertContractError("receipt input snapshot events must be an array")
    matching_fingerprints = [item for item in fingerprints if isinstance(item, Mapping) and item.get("event_id") == event_id]
    if len(matching_fingerprints) != 1 or matching_fingerprints[0].get("event_sha256") != _sha256(event):
        raise ChartAlertContractError("receipt input snapshot does not bind the event snapshot")
    if snapshot.get("event_count") != len(fingerprints):
        raise ChartAlertContractError("receipt input snapshot event_count mismatch")
    if expires != event_known_at + normalized_rule["ttl_seconds"]:
        raise ChartAlertContractError("receipt expiry does not match rule TTL")
    expected_alert_id = _alert_id(rule_digest, event_id)
    if alert_id != expected_alert_id:
        raise ChartAlertContractError("receipt.alert_id does not match rule/event identity")
    _canonical(raw, maximum=_MAX_INPUT_BYTES + _MAX_RULE_BYTES)
    return raw


def evaluate_chart_alerts(
    rule: Mapping[str, Any],
    events: Iterable[Any],
    cutoff_timestamp: int,
    *,
    as_of_timestamp: int | None = None,
    previous_ledger: AlertLedger | Mapping[str, Any] | None = None,
) -> AlertEvaluation:
    """Evaluate confirmed events into deduplicated local advisory receipts.

    The function is deterministic: ``emitted_at_timestamp`` is the event's
    causal ``known_at`` rather than wall-clock time.  ``previous_ledger`` is
    the caller-owned reconnect/replay checkpoint.  No checkpoint means a new
    local stream; callers that replay a stream must carry the ledger returned
    by the prior evaluation.
    """

    normalized_rule = validate_alert_rule(rule)
    digest = rule_sha256(normalized_rule)
    cutoff = _strict_int(cutoff_timestamp, "cutoff_timestamp", minimum=1)
    as_of = cutoff if as_of_timestamp is None else _strict_int(as_of_timestamp, "as_of_timestamp", minimum=1)
    if as_of < cutoff:
        raise ChartAlertContractError("as_of_timestamp cannot precede cutoff_timestamp")
    normalized_events = _normalize_events(events)
    if any(event["known_at"] > cutoff for event in normalized_events):
        raise ChartAlertContractError("events beyond cutoff_timestamp are forbidden")
    input_snapshot = build_input_snapshot(normalized_events, cutoff)
    input_digest = input_snapshot_sha256(input_snapshot)
    if previous_ledger is None:
        ledger = AlertLedger.empty(normalized_rule)
    elif isinstance(previous_ledger, AlertLedger):
        ledger = previous_ledger
    else:
        ledger = AlertLedger.from_mapping(previous_ledger)
    if ledger.rule_sha256 != digest:
        raise ChartAlertContractError("previous ledger belongs to a different alert rule")

    delivered = set(ledger.delivered_alert_ids)
    expired = set(ledger.expired_alert_ids)
    emitted: list[dict[str, Any]] = []
    suppressed: list[dict[str, Any]] = []
    for event in normalized_events:
        if event["state"] != _CONFIRMED:
            suppressed.append({"event_id": event["event_id"], "reason": "not_confirmed"})
            continue
        if not normalized_rule["enabled"]:
            suppressed.append({"event_id": event["event_id"], "reason": "rule_disabled"})
            continue
        if not _matches(normalized_rule, event):
            suppressed.append({"event_id": event["event_id"], "reason": "rule_filter"})
            continue
        alert_id = _alert_id(digest, event["event_id"])
        if alert_id in delivered or alert_id in expired:
            suppressed.append({"event_id": event["event_id"], "alert_id": alert_id, "reason": "duplicate"})
            continue
        expires_at = event["known_at"] + normalized_rule["ttl_seconds"]
        if as_of >= expires_at:
            expired.add(alert_id)
            suppressed.append({"event_id": event["event_id"], "alert_id": alert_id, "reason": "expired"})
            continue
        if len(emitted) >= 256:
            suppressed.append({"event_id": event["event_id"], "alert_id": alert_id, "reason": "batch_cap"})
            continue
        receipt = _build_receipt(
            rule=normalized_rule,
            rule_digest=digest,
            event=event,
            input_snapshot=input_snapshot,
            input_digest=input_digest,
            cutoff=cutoff,
            expires_at=expires_at,
        )
        emitted.append(receipt)
        delivered.add(alert_id)
    next_ledger = AlertLedger(
        rule_sha256=digest,
        delivered_alert_ids=tuple(sorted(delivered)),
        expired_alert_ids=tuple(sorted(expired)),
        generation=ledger.generation + 1,
        last_cutoff_timestamp=max(cutoff, ledger.last_cutoff_timestamp or cutoff),
    )
    return AlertEvaluation(
        rule_snapshot=copy.deepcopy(normalized_rule),
        rule_sha256=digest,
        input_snapshot=copy.deepcopy(input_snapshot),
        input_snapshot_sha256=input_digest,
        cutoff_timestamp=cutoff,
        as_of_timestamp=as_of,
        emitted=tuple(emitted),
        suppressed=tuple(suppressed),
        next_ledger=next_ledger,
    )


__all__ = [
    "ALERT_ENGINE",
    "ALERT_EVALUATION_SCHEMA",
    "ALERT_INPUT_SCHEMA",
    "ALERT_LEDGER_SCHEMA",
    "ALERT_RECEIPT_SCHEMA",
    "ALERT_RULE_SCHEMA",
    "AlertEvaluation",
    "AlertLedger",
    "ChartAlertContractError",
    "build_input_snapshot",
    "evaluate_chart_alerts",
    "input_snapshot_sha256",
    "rule_sha256",
    "validate_alert_receipt",
    "validate_alert_rule",
]
