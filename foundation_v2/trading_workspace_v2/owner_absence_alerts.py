"""Offline watchdog and alert semantics for owner-absence supervision.

This module is deliberately a contract, not a notification client.  It turns
verified heartbeat/event evidence into a deterministic state and a bounded
retry plan.  A caller may later connect a local outbox or an owner/delegate
adapter, but an event is considered delivered only when that adapter returns
an explicit receipt key.  No provider, broker, OAuth, process, or execution
capability is reachable from this boundary.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal


OWNER_ABSENCE_ALERT_SCHEMA = "owner-absence-alert-contract-v1"
PREP_ONLY_MODE = "PREP_ONLY_OFFLINE"
RETRY_DELAYS_SECONDS: tuple[int, ...] = (0, 60, 300)
HEARTBEAT_STALE_SECONDS = 60

AlertSeverity = Literal["P0", "P1"]
WatchdogState = Literal["healthy", "paused", "quarantined"]
Escalation = Literal["owner", "owner_and_delegate", "manual_ack"]


class OwnerAbsenceAlertContractError(ValueError):
    """Raised when watchdog evidence or ledger state is ambiguous."""


def _text(value: object, name: str, *, maximum: int = 128) -> str:
    if not isinstance(value, str) or not value.strip():
        raise OwnerAbsenceAlertContractError(f"{name} must be a non-empty string")
    result = value.strip()
    if len(result) > maximum:
        raise OwnerAbsenceAlertContractError(f"{name} exceeds {maximum} characters")
    return result


def _seconds(value: object, name: str) -> int:
    if type(value) is not int or value < 0:
        raise OwnerAbsenceAlertContractError(f"{name} must be an integer >= 0")
    return value


@dataclass(frozen=True, slots=True)
class WatchdogEvent:
    """One immutable supervisor event identified by a fenced dedupe key."""

    run_id: str
    fence_token: str
    event_type: str
    event_id: str
    severity: AlertSeverity
    occurred_at_seconds: int

    def __post_init__(self) -> None:
        for value, name in (
            (self.run_id, "run_id"),
            (self.fence_token, "fence_token"),
            (self.event_type, "event_type"),
            (self.event_id, "event_id"),
        ):
            _text(value, name)
        if self.severity not in {"P0", "P1"}:
            raise OwnerAbsenceAlertContractError("severity must be P0 or P1")
        _seconds(self.occurred_at_seconds, "occurred_at_seconds")

    @property
    def dedupe_key(self) -> tuple[str, str, str, str]:
        return (self.run_id, self.fence_token, self.event_type, self.event_id)


@dataclass(frozen=True, slots=True)
class WatchdogAlertRecord:
    """Durable-friendly retry state for one event key.

    ``delivered`` is true only after the caller supplies ``sink_receipts``
    containing this exact key.  Merely constructing an attempt never claims
    delivery.
    """

    key: tuple[str, str, str, str]
    first_seen_at_seconds: int
    attempts: int = 0
    delivered: bool = False

    def __post_init__(self) -> None:
        if not isinstance(self.key, tuple):
            raise OwnerAbsenceAlertContractError("alert key must be a tuple")
        if len(self.key) != 4 or any(not isinstance(item, str) or not item for item in self.key):
            raise OwnerAbsenceAlertContractError("alert key must contain four non-empty strings")
        _seconds(self.first_seen_at_seconds, "first_seen_at_seconds")
        if type(self.attempts) is not int or not 0 <= self.attempts <= len(RETRY_DELAYS_SECONDS):
            raise OwnerAbsenceAlertContractError("attempts exceeds the bounded retry budget")
        if type(self.delivered) is not bool:
            raise OwnerAbsenceAlertContractError("delivered must be boolean")


@dataclass(frozen=True, slots=True)
class WatchdogAlertLedger:
    """Immutable caller-owned checkpoint for dedupe and retry continuity."""

    records: tuple[WatchdogAlertRecord, ...] = ()

    def __post_init__(self) -> None:
        if not isinstance(self.records, tuple) or any(not isinstance(record, WatchdogAlertRecord) for record in self.records):
            raise OwnerAbsenceAlertContractError("ledger records must be WatchdogAlertRecord values")
        keys = [record.key for record in self.records]
        if len(keys) != len(set(keys)):
            raise OwnerAbsenceAlertContractError("ledger contains duplicate alert keys")

    def record_for(self, key: tuple[str, str, str, str]) -> WatchdogAlertRecord | None:
        return next((record for record in self.records if record.key == key), None)


@dataclass(frozen=True, slots=True)
class HeartbeatEvaluation:
    state: WatchdogState
    alerts: tuple[str, ...]
    escalation: Escalation | None
    age_seconds: int
    execution_capability: Literal[False] = False


@dataclass(frozen=True, slots=True)
class WatchdogAlertEvaluation:
    state: WatchdogState
    escalation: Escalation | None
    alerts: tuple[str, ...]
    initial_alert_count: int
    suppressed_duplicate_count: int
    attempt_count: int
    delivered_count: int
    acknowledgement_required: bool
    next_ledger: WatchdogAlertLedger
    execution_capability: Literal[False] = False
    provider_access: Literal[False] = False
    broker_access: Literal[False] = False


def evaluate_heartbeat(
    *,
    now_seconds: int,
    last_heartbeat_seconds: int,
    stale_after_seconds: int = HEARTBEAT_STALE_SECONDS,
) -> HeartbeatEvaluation:
    """Classify one heartbeat without touching a process or alert sink."""

    now = _seconds(now_seconds, "now_seconds")
    heartbeat = _seconds(last_heartbeat_seconds, "last_heartbeat_seconds")
    threshold = _seconds(stale_after_seconds, "stale_after_seconds")
    if threshold == 0:
        raise OwnerAbsenceAlertContractError("stale_after_seconds must be positive")
    if heartbeat > now:
        return HeartbeatEvaluation(
            state="paused",
            alerts=("watchdog.clock_invalid",),
            escalation="owner",
            age_seconds=0,
        )
    age = now - heartbeat
    stale = age > threshold
    return HeartbeatEvaluation(
        state="paused" if stale else "healthy",
        alerts=("watchdog.stale_heartbeat",) if stale else (),
        escalation="owner" if stale else None,
        age_seconds=age,
    )


def evaluate_alert_events(
    events: Iterable[WatchdogEvent],
    *,
    now_seconds: int,
    previous_ledger: WatchdogAlertLedger | None = None,
    sink_receipts: Iterable[tuple[str, str, str, str]] = (),
) -> WatchdogAlertEvaluation:
    """Evaluate alert events with deterministic dedupe and bounded retries.

    ``sink_receipts`` is the only way to mark an event delivered.  It is an
    explicit receipt set supplied by a caller-owned adapter; this function
    never sends anything and never treats a configured-but-unavailable sink as
    a successful delivery.
    """

    now = _seconds(now_seconds, "now_seconds")
    if previous_ledger is not None and not isinstance(previous_ledger, WatchdogAlertLedger):
        raise OwnerAbsenceAlertContractError("previous_ledger must be a WatchdogAlertLedger")
    ledger = previous_ledger or WatchdogAlertLedger()
    try:
        receipt_keys = set(sink_receipts)
    except (TypeError, ValueError) as exc:
        raise OwnerAbsenceAlertContractError("sink_receipts must contain hashable tuple keys") from exc
    if any(len(key) != 4 or any(not isinstance(item, str) or not item for item in key) for key in receipt_keys):
        raise OwnerAbsenceAlertContractError("sink_receipts contain an invalid dedupe key")
    normalized_events = tuple(events)
    seen_input: set[tuple[str, str, str, str]] = set()
    records = {record.key: record for record in ledger.records}
    initial = suppressed = attempts = delivered = 0
    alerts: list[str] = []
    state: WatchdogState = "paused"
    escalation: Escalation | None = "owner"
    acknowledgement_required = False

    for event in normalized_events:
        if not isinstance(event, WatchdogEvent):
            raise OwnerAbsenceAlertContractError("events must contain WatchdogEvent values")
        key = event.dedupe_key
        if key in seen_input:
            suppressed += 1
            continue
        seen_input.add(key)
        record = records.get(key)
        if record is None:
            record = WatchdogAlertRecord(key=key, first_seen_at_seconds=event.occurred_at_seconds)
            records[key] = record
            initial += 1
        if key in receipt_keys:
            if not record.delivered:
                delivered += 1
            records[key] = WatchdogAlertRecord(
                key=key,
                first_seen_at_seconds=record.first_seen_at_seconds,
                attempts=record.attempts,
                delivered=True,
            )
            continue
        if record.delivered:
            suppressed += 1
            continue
        elapsed = now - record.first_seen_at_seconds
        if elapsed < 0:
            # Future-dated evidence cannot be scheduled or retried.
            raise OwnerAbsenceAlertContractError("event occurred after now_seconds")
        next_attempt = record.attempts
        if next_attempt >= len(RETRY_DELAYS_SECONDS) or elapsed < RETRY_DELAYS_SECONDS[next_attempt]:
            suppressed += 1
            if next_attempt >= len(RETRY_DELAYS_SECONDS):
                acknowledgement_required = True
            continue
        records[key] = WatchdogAlertRecord(
            key=key,
            first_seen_at_seconds=record.first_seen_at_seconds,
            attempts=record.attempts + 1,
            delivered=False,
        )
        attempts += 1
        alert_name = f"supervisor.{event.event_type}"
        if alert_name not in alerts:
            alerts.append(alert_name)
        if event.severity == "P0":
            escalation = "owner_and_delegate"
        if record.attempts + 1 >= len(RETRY_DELAYS_SECONDS):
            acknowledgement_required = True
            escalation = "manual_ack"

    if any(event.event_type == "quarantine" for event in normalized_events):
        state = "quarantined"
    if acknowledgement_required:
        escalation = "manual_ack"
    elif any(event.severity == "P0" for event in normalized_events):
        escalation = "owner_and_delegate"

    next_ledger = WatchdogAlertLedger(records=tuple(records[key] for key in sorted(records)))
    return WatchdogAlertEvaluation(
        state=state,
        escalation=escalation,
        alerts=tuple(alerts),
        initial_alert_count=initial,
        suppressed_duplicate_count=suppressed,
        attempt_count=attempts,
        delivered_count=delivered,
        acknowledgement_required=acknowledgement_required,
        next_ledger=next_ledger,
    )


__all__ = [
    "OWNER_ABSENCE_ALERT_SCHEMA",
    "PREP_ONLY_MODE",
    "RETRY_DELAYS_SECONDS",
    "HEARTBEAT_STALE_SECONDS",
    "OwnerAbsenceAlertContractError",
    "WatchdogEvent",
    "WatchdogAlertRecord",
    "WatchdogAlertLedger",
    "HeartbeatEvaluation",
    "WatchdogAlertEvaluation",
    "evaluate_heartbeat",
    "evaluate_alert_events",
]
