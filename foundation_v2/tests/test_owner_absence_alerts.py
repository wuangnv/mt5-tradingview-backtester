from __future__ import annotations

import pytest

from trading_workspace_v2.owner_absence_alerts import (
    OwnerAbsenceAlertContractError,
    WatchdogAlertLedger,
    WatchdogEvent,
    evaluate_alert_events,
    evaluate_heartbeat,
)


def event(
    event_id: str = "evt-stop",
    *,
    event_type: str = "stop",
    severity: str = "P1",
    occurred_at_seconds: int = 0,
) -> WatchdogEvent:
    return WatchdogEvent(
        run_id="run-1",
        fence_token="fence-1",
        event_type=event_type,
        event_id=event_id,
        severity=severity,  # type: ignore[arg-type]
        occurred_at_seconds=occurred_at_seconds,
    )


def test_heartbeat_threshold_is_strict_and_clock_skew_pauses() -> None:
    assert evaluate_heartbeat(now_seconds=100, last_heartbeat_seconds=40).state == "healthy"
    stale = evaluate_heartbeat(now_seconds=101, last_heartbeat_seconds=40)
    assert stale.state == "paused"
    assert stale.alerts == ("watchdog.stale_heartbeat",)
    skew = evaluate_heartbeat(now_seconds=100, last_heartbeat_seconds=101)
    assert skew.state == "paused"
    assert skew.alerts == ("watchdog.clock_invalid",)
    assert skew.execution_capability is False


def test_quarantine_is_fail_closed_and_p0_escalates() -> None:
    result = evaluate_alert_events(
        [event(event_id="evt-quarantine", event_type="quarantine", severity="P0")],
        now_seconds=0,
    )
    assert result.state == "quarantined"
    assert result.alerts == ("supervisor.quarantine",)
    assert result.escalation == "owner_and_delegate"
    assert result.attempt_count == 1
    assert result.delivered_count == 0
    assert result.execution_capability is False
    assert result.provider_access is False
    assert result.broker_access is False


def test_duplicate_is_suppressed_until_the_next_retry_deadline() -> None:
    first = evaluate_alert_events([event()], now_seconds=0)
    duplicate = evaluate_alert_events(
        [event()], now_seconds=10, previous_ledger=first.next_ledger
    )
    retry = evaluate_alert_events(
        [event()], now_seconds=60, previous_ledger=duplicate.next_ledger
    )
    assert first.initial_alert_count == 1
    assert first.attempt_count == 1
    assert duplicate.initial_alert_count == 0
    assert duplicate.suppressed_duplicate_count == 1
    assert duplicate.attempt_count == 0
    assert retry.attempt_count == 1
    assert retry.next_ledger.records[0].attempts == 2


def test_unavailable_sink_exhausts_bounded_retries_and_requires_ack() -> None:
    first = evaluate_alert_events([event()], now_seconds=0)
    second = evaluate_alert_events([event()], now_seconds=60, previous_ledger=first.next_ledger)
    third = evaluate_alert_events([event()], now_seconds=300, previous_ledger=second.next_ledger)
    assert third.attempt_count == 1
    assert third.delivered_count == 0
    assert third.acknowledgement_required is True
    assert third.escalation == "manual_ack"
    exhausted = evaluate_alert_events([event()], now_seconds=301, previous_ledger=third.next_ledger)
    assert exhausted.attempt_count == 0
    assert exhausted.acknowledgement_required is True
    assert exhausted.suppressed_duplicate_count == 1


def test_delivery_requires_an_explicit_sink_receipt() -> None:
    first = evaluate_alert_events([event()], now_seconds=0)
    key = event().dedupe_key
    delivered = evaluate_alert_events(
        [event()], now_seconds=1, previous_ledger=first.next_ledger, sink_receipts=[key]
    )
    assert delivered.delivered_count == 1
    assert delivered.next_ledger.records[0].delivered is True
    replay = evaluate_alert_events([event()], now_seconds=300, previous_ledger=delivered.next_ledger)
    assert replay.delivered_count == 0
    assert replay.attempt_count == 0


def test_event_and_ledger_validation_fail_closed() -> None:
    with pytest.raises(OwnerAbsenceAlertContractError):
        WatchdogEvent("run", "fence", "stop", "evt", "P1", -1)  # type: ignore[arg-type]
    with pytest.raises(OwnerAbsenceAlertContractError):
        evaluate_alert_events([event(occurred_at_seconds=10)], now_seconds=9)
    record = evaluate_alert_events([event()], now_seconds=0).next_ledger.records[0]
    with pytest.raises(OwnerAbsenceAlertContractError):
        WatchdogAlertLedger(records=(record, record))

