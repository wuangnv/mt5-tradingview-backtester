from __future__ import annotations

import copy

import pytest

from trading_workspace_v2.chart_alert_contract import (
    ALERT_RECEIPT_SCHEMA,
    PREP_ONLY_MODE,
    ALERT_ENGINE,
    AlertLedger,
    ChartAlertContractError,
    evaluate_chart_alerts,
    input_snapshot_sha256,
    rule_sha256,
    validate_alert_receipt,
    validate_alert_rule,
)


def rule(**updates: object) -> dict:
    payload: dict[str, object] = {
        "schema": "chart-alert-rule-v1",
        "mode": PREP_ONLY_MODE,
        "engine": ALERT_ENGINE,
        "rule_id": "fvg-bos-advisory",
        "version": "1",
        "enabled": True,
        "event_kinds": ["FVG", "BOS"],
        "directions": ["any"],
        "instruments": [],
        "timeframes_seconds": [],
        "ttl_seconds": 300,
        "delivery": "local_advisory",
        "confirmed_only": True,
        "replay_policy": "dedupe_event_id",
        "execution_capability": False,
        "order_effect": "none",
        "fill_effect": "none",
    }
    payload.update(updates)
    return payload


def event(
    event_id: str = "evt:fvg-1",
    *,
    known_at: int = 1_700_000_120,
    state: str = "confirmed",
    kind: str = "FVG",
    direction: str = "bullish",
) -> dict:
    return {
        "schema": "chart-event-v1",
        "event_id": event_id,
        "kind": kind,
        "direction": direction,
        "instrument_id": "EURUSD",
        "timeframe_seconds": 300,
        "anchor_timestamp": known_at - 60,
        "known_at": known_at,
        "source_bar_ids": [f"bar:{known_at - 120}", f"bar:{known_at - 60}", f"bar:{known_at}"],
        "price_low": 1.1000,
        "price_high": 1.1010,
        "state": state,
        "confirmation_lag_bars": 0,
        "rule_version": "smc-core.v1",
        "parameters": {"fixture": True},
        "identity": {"fixture": event_id},
    }


def test_rule_is_canonical_and_hash_is_order_independent() -> None:
    normalized = validate_alert_rule(rule())
    reordered = dict(reversed(list(rule().items())))
    assert normalized["confirmed_only"] is True
    assert rule_sha256(rule()) == rule_sha256(reordered)
    assert normalized["execution_capability"] is False


def test_new_smc_event_kinds_are_supported_by_alert_contract() -> None:
    liquidity_rule = rule(event_kinds=["LIQUIDITY_SWEEP"])
    liquidity_event = event(kind="LIQUIDITY_SWEEP")
    result = evaluate_chart_alerts(liquidity_rule, [liquidity_event], 1_700_000_120)
    assert len(result.emitted) == 1

    choch_rule = rule(event_kinds=["CHOCH"])
    choch_event = event(event_id="evt:choch-1", kind="CHoCH")
    result = evaluate_chart_alerts(choch_rule, [choch_event], 1_700_000_120)
    assert len(result.emitted) == 1


def test_confirmed_event_emits_receipt_with_rule_and_input_snapshots() -> None:
    result = evaluate_chart_alerts(rule(), [event()], 1_700_000_120)
    assert len(result.emitted) == 1
    receipt = result.emitted[0]
    assert receipt["schema"] == ALERT_RECEIPT_SCHEMA
    assert receipt["event_id"] == "evt:fvg-1"
    assert receipt["event_snapshot"]["state"] == "confirmed"
    assert receipt["rule_snapshot"]["rule_id"] == "fvg-bos-advisory"
    assert receipt["input_snapshot"]["cutoff_timestamp"] == 1_700_000_120
    assert receipt["input_snapshot_sha256"] == input_snapshot_sha256(receipt["input_snapshot"])
    assert receipt["execution_capability"] is False
    assert receipt["order_effect"] == "none"
    assert receipt["fill_effect"] == "none"
    assert receipt["expires_at_timestamp"] == 1_700_000_420
    assert validate_alert_receipt(receipt) == receipt


def test_provisional_event_is_never_emitted() -> None:
    result = evaluate_chart_alerts(rule(), [event(state="provisional")], 1_700_000_120)
    assert result.emitted == ()
    assert result.suppressed == ({"event_id": "evt:fvg-1", "reason": "not_confirmed"},)
    assert result.next_ledger.delivered_alert_ids == ()


def test_reconnect_and_replay_are_deduplicated_by_rule_and_event() -> None:
    first = evaluate_chart_alerts(rule(), [event()], 1_700_000_120)
    reconnect = evaluate_chart_alerts(
        rule(),
        [event()],
        1_700_000_120,
        previous_ledger=first.next_ledger,
    )
    replay = evaluate_chart_alerts(
        rule(),
        [event(), event("evt:fvg-2", known_at=1_700_000_180)],
        1_700_000_180,
        previous_ledger=reconnect.next_ledger,
    )
    assert reconnect.emitted == ()
    assert reconnect.suppressed[0]["reason"] == "duplicate"
    assert len(replay.emitted) == 1
    assert replay.emitted[0]["event_id"] == "evt:fvg-2"
    assert len(replay.next_ledger.delivered_alert_ids) == 2
    assert replay.next_ledger.generation == 3


def test_expired_event_is_recorded_without_emission() -> None:
    result = evaluate_chart_alerts(
        rule(ttl_seconds=60),
        [event()],
        1_700_000_120,
        as_of_timestamp=1_700_000_180,
    )
    assert result.emitted == ()
    assert result.suppressed[0]["reason"] == "expired"
    assert len(result.next_ledger.expired_alert_ids) == 1


def test_rule_filters_and_disabled_rules_are_explicit() -> None:
    filtered = evaluate_chart_alerts(rule(event_kinds=["BOS"]), [event()], 1_700_000_120)
    assert filtered.emitted == ()
    assert filtered.suppressed[0]["reason"] == "rule_filter"
    disabled = evaluate_chart_alerts(rule(enabled=False), [event()], 1_700_000_120)
    assert disabled.emitted == ()
    assert disabled.suppressed[0]["reason"] == "rule_disabled"


def test_cutoff_and_rule_ledger_mismatch_fail_closed() -> None:
    with pytest.raises(ChartAlertContractError, match="beyond cutoff"):
        evaluate_chart_alerts(rule(), [event(known_at=1_700_000_180)], 1_700_000_120)
    first = evaluate_chart_alerts(rule(), [event()], 1_700_000_120)
    with pytest.raises(ChartAlertContractError, match="different alert rule"):
        evaluate_chart_alerts(rule(version="2"), [event()], 1_700_000_120, previous_ledger=first.next_ledger)


def test_duplicate_input_and_forbidden_execution_fields_fail_closed() -> None:
    with pytest.raises(ChartAlertContractError, match="duplicate event_id"):
        evaluate_chart_alerts(rule(), [event(), event()], 1_700_000_120)
    unsafe = copy.deepcopy(event())
    unsafe["parameters"] = {"place_order": "BUY"}
    with pytest.raises(ChartAlertContractError, match="forbidden"):
        evaluate_chart_alerts(rule(), [unsafe], 1_700_000_120)
    unsafe_rule = rule(order_effect="send_order")
    with pytest.raises(ChartAlertContractError, match="execution"):
        validate_alert_rule(unsafe_rule)


def test_tampered_receipt_cannot_gain_order_or_fill_effect() -> None:
    receipt = evaluate_chart_alerts(rule(), [event()], 1_700_000_120).emitted[0]
    tampered = copy.deepcopy(receipt)
    tampered["order_effect"] = "send_order"
    with pytest.raises(ChartAlertContractError):
        validate_alert_receipt(tampered)
    tampered = copy.deepcopy(receipt)
    tampered["execution_capability"] = True
    with pytest.raises(ChartAlertContractError):
        validate_alert_receipt(tampered)


def test_tampered_receipt_cannot_detach_input_event_or_expiry() -> None:
    receipt = evaluate_chart_alerts(rule(), [event()], 1_700_000_120).emitted[0]
    tampered = copy.deepcopy(receipt)
    tampered["input_snapshot"]["cutoff_timestamp"] += 1
    tampered["input_snapshot_sha256"] = input_snapshot_sha256(tampered["input_snapshot"])
    with pytest.raises(ChartAlertContractError, match="cutoff mismatch"):
        validate_alert_receipt(tampered)
    tampered = copy.deepcopy(receipt)
    tampered["expires_at_timestamp"] += 1
    with pytest.raises(ChartAlertContractError, match="expiry"):
        validate_alert_receipt(tampered)


def test_receipt_must_satisfy_the_enabled_rule() -> None:
    receipt = evaluate_chart_alerts(rule(), [event()], 1_700_000_120).emitted[0]
    tampered = copy.deepcopy(receipt)
    tampered["event_snapshot"]["kind"] = "SESSION"
    with pytest.raises(ChartAlertContractError):
        validate_alert_receipt(tampered)
    tampered = copy.deepcopy(receipt)
    tampered["rule_snapshot"]["enabled"] = False
    # The rule hash is intentionally left unchanged: either mismatch or the
    # enabled-rule check must reject this forged receipt.
    with pytest.raises(ChartAlertContractError):
        validate_alert_receipt(tampered)


def test_ledger_rejects_unknown_state_fields() -> None:
    payload = AlertLedger.empty(rule()).as_dict()
    payload["execution_capability"] = False
    with pytest.raises(ChartAlertContractError, match="unsupported fields"):
        AlertLedger.from_mapping(payload)


def test_ledger_round_trip_is_stable_and_empty_ledger_binds_rule() -> None:
    empty = AlertLedger.empty(rule())
    restored = AlertLedger.from_mapping(empty.as_dict())
    assert restored == empty
    assert restored.rule_sha256 == rule_sha256(rule())


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__]))
