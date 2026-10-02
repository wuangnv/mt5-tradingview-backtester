from __future__ import annotations

import json
import sys
from copy import deepcopy
from decimal import Decimal
from pathlib import Path

import pytest

V2 = Path(__file__).resolve().parents[1]
for path in (V2.parent, V2):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from trading_workspace_v2.artifacts import canonical_json_bytes
from trading_workspace_v2.replay_execution import (
    advance_replay_execution,
    fork_replay_execution_checkpoint,
    initialize_replay_execution,
    parse_replay_execution_snapshot,
    queue_market_order,
    reconstruct_replay_execution_checkpoint,
    transition_replay_phase,
)

from foundation_v2.tests import test_u5_engine_oracle as oracle

MARGIN = {"version": "fixed-starting-balance-leverage-v1", "leverage": "30"}
OPEN_BAR = oracle.bar(10800, 10.03, 10.10, 10.02, 10.07)
OMITTED = object()


def initial(*, balance="1", margin=OMITTED):
    kwargs = {} if margin is OMITTED else {"research_margin": margin}
    return initialize_replay_execution(
        replay_session_id="margin-v2",
        branch_id="margin-v2-branch",
        dataset_id="margin-v2-source",
        dataset_sha256="d" * 64,
        instrument_spec=oracle.instrument_fixture(),
        cost_model=oracle.cost_model_fixture(),
        spread_price="0.02",
        timeframe_seconds=3600,
        starting_balance=balance,
        cursor_index=2,
        **kwargs,
    )


def queued(snapshot, side="BUY", operation_id="decision-2"):
    return queue_market_order(
        snapshot,
        operation_id=operation_id,
        side=side,
        quantity="0.03",
        stop_loss="9" if side == "BUY" else "12",
        take_profit="12" if side == "BUY" else "9",
    )


@pytest.mark.parametrize("side,required", [("BUY", "12.406725"), ("SELL", "12.345")])
@pytest.mark.parametrize(
    "delta,rejected", [("-0.000001", True), ("0", False), ("0.000001", False)]
)
def test_independent_decimal_threshold(side, required, delta, rejected):
    balance = Decimal(required) + Decimal(delta)
    result = advance_replay_execution(
        queued(initial(balance=balance, margin=MARGIN), side),
        bar=OPEN_BAR,
        cursor_index=3,
    )
    event = result.events[0]
    assert event.kind == ("order_rejected" if rejected else "market_fill")
    assert event.schema_version == "replay-execution-event-v2"
    assert result.snapshot.schema_version == "replay-execution-v2"
    assert Decimal(event.details["margin_admission"]["required_account"]) == Decimal(
        required
    )
    assert Decimal(event.details["margin_admission"]["available_account"]) == balance
    assert event.virtual_time_utc == 10800
    assert event.cursor_index == 3
    assert result.events[-1].kind == "price_mark"
    assert result.snapshot.pending_market_order is None
    if rejected:
        assert event.details["reason"] == "insufficient_research_margin"
        assert result.snapshot.position is None
        assert result.snapshot.balance == result.snapshot.equity == balance
        assert result.events[-1].details["intrabar_equity_coverage"] == "complete"


def test_next_open_admission_is_causal_and_queue_has_no_future_quote():
    snapshot = initial(balance="12.43", margin=MARGIN)
    first = queued(snapshot)
    changed_future = deepcopy(OPEN_BAR)
    changed_future.update(open=10.08, high=10.15, low=10.05, close=10.12)
    assert first.model_dump(mode="json") == queued(snapshot).model_dump(mode="json")
    accepted = advance_replay_execution(first, bar=OPEN_BAR, cursor_index=3)
    rejected = advance_replay_execution(first, bar=changed_future, cursor_index=3)
    assert accepted.events[0].kind == "market_fill"
    assert rejected.events[0].kind == "order_rejected"
    assert first.pending_market_order is not None
    assert snapshot.ledger == []
    later = advance_replay_execution(
        rejected.snapshot,
        bar=oracle.bar(14400, 10, 10.2, 9.9, 10.1),
        cursor_index=4,
    )
    assert later.snapshot.ledger[:2] == rejected.snapshot.ledger


def test_legacy_omitted_serialization_and_behavior_are_exact():
    baseline = json.loads(
        (V2 / "evidence/U5B-replay-margin-v2-legacy-baseline-r1.json").read_text()
    )
    snapshot = initial()
    pending = queued(snapshot)
    result = advance_replay_execution(pending, bar=OPEN_BAR, cursor_index=3)
    for name, actual in (
        ("initial", snapshot),
        ("queued", pending),
        ("advanced", result),
    ):
        assert (
            canonical_json_bytes(actual.model_dump(mode="json")).decode()
            == baseline[name]
        )
    assert result.events[0].kind == "market_fill"
    assert "research_margin" not in result.snapshot.model_dump(mode="json")
    assert all(
        "schema_version" not in event.model_dump(mode="json") for event in result.events
    )


def test_null_margin_uses_exact_legacy_snapshot_and_request_serialization():
    from trading_workspace_v2.contracts import ReplayExecutionInitialize

    assert initial(margin=None).model_dump(mode="json") == initial().model_dump(
        mode="json"
    )
    request = dict(
        expected_revision=1,
        instrument_spec=oracle.instrument_fixture(),
        cost_model=oracle.cost_model_fixture(),
        spread_price="0.02",
        timeframe_seconds=3600,
        starting_balance="1",
    )
    omitted = ReplayExecutionInitialize.model_validate(request).model_dump(mode="json")
    explicit_null = ReplayExecutionInitialize.model_validate(
        {**request, "research_margin": None}
    ).model_dump(mode="json")
    assert omitted == explicit_null
    assert "research_margin" not in omitted


@pytest.mark.parametrize(
    "margin",
    [
        {"version": "unknown", "leverage": "30"},
        {"version": MARGIN["version"]},
        {**MARGIN, "unexpected": 1},
        *[
            {**MARGIN, "leverage": value}
            for value in [True, "0", "-1", "0.5", "1001", "NaN", "Infinity"]
        ],
    ],
)
def test_invalid_margin_contract_is_rejected(margin):
    with pytest.raises(ValueError):
        initial(margin=margin)


def test_rejection_survives_versioned_roundtrip_checkpoint_and_fork():
    pending = queued(initial(margin=MARGIN))
    rejected = advance_replay_execution(pending, bar=OPEN_BAR, cursor_index=3)
    assert (
        rejected.model_dump(mode="json")["events"][0]["schema_version"]
        == "replay-execution-event-v2"
    )
    restored = parse_replay_execution_snapshot(
        json.loads(rejected.snapshot.model_dump_json())
    )
    assert restored.model_dump(mode="json") == rejected.snapshot.model_dump(mode="json")
    assert advance_replay_execution(pending, bar=OPEN_BAR, cursor_index=3).model_dump(
        mode="json"
    ) == rejected.model_dump(mode="json")
    with pytest.raises(ValueError, match="already consumed"):
        queued(restored)
    later = advance_replay_execution(
        restored, bar=oracle.bar(14400, 10, 10.2, 9.9, 10.1), cursor_index=4
    )
    checkpoint = reconstruct_replay_execution_checkpoint(later.snapshot, cursor_index=3)
    assert checkpoint.model_dump(mode="json") == restored.model_dump(mode="json")
    child = fork_replay_execution_checkpoint(
        checkpoint, replay_session_id="child", branch_id="child-branch"
    )
    assert child.research_margin == restored.research_margin
    assert child.position is child.pending_market_order is None
    assert all(
        event["replay_session_id"] == "child" and event["branch_id"] == "child-branch"
        for event in child.ledger
    )
    parse_replay_execution_snapshot(child.model_dump(mode="json"))


@pytest.mark.parametrize(
    "tamper",
    [
        "unversioned",
        "wrong_version",
        "legacy_snapshot",
        "margin",
        "reason",
        "outcome",
        "pending",
    ],
)
def test_tampered_or_mixed_version_rejection_fails_closed(tamper):
    snapshot = advance_replay_execution(
        queued(initial(margin=MARGIN)), bar=OPEN_BAR, cursor_index=3
    ).snapshot.model_dump(mode="json")
    event = snapshot["ledger"][0]
    if tamper == "unversioned":
        snapshot["ledger"][-1].pop("schema_version")
    elif tamper == "wrong_version":
        event["schema_version"] = "unknown"
    elif tamper == "legacy_snapshot":
        snapshot["schema_version"] = "replay-execution-v1"
        snapshot.pop("research_margin")
        for raw in snapshot["ledger"]:
            raw.pop("schema_version")
    elif tamper == "margin":
        event["details"]["margin_admission"]["required_account"] = "100"
    elif tamper == "reason":
        event["details"]["reason"] = "broker_rejected"
    elif tamper == "outcome":
        event["kind"] = "market_fill"
    else:
        event["pending_orders"] = 1
    with pytest.raises(ValueError):
        parse_replay_execution_snapshot(snapshot)


def test_phase_reset_does_not_change_original_margin_budget():
    rejected = advance_replay_execution(
        queued(initial(margin=MARGIN)), bar=OPEN_BAR, cursor_index=3
    ).snapshot
    transitioned = transition_replay_phase(
        rejected,
        intent_id="phase-reset",
        intent_fingerprint="pin-reset",
        from_phase_index=1,
        to_phase_index=2,
        carry_policy="reset",
        position_policy="must_be_flat",
        next_phase_initial_balance="1000",
        virtual_time_utc=14400,
    ).snapshot
    assert transitioned.schema_version == "replay-execution-v2"
    assert transitioned.ledger[-1]["schema_version"] == "replay-execution-event-v2"
    second = advance_replay_execution(
        queued(transitioned, operation_id="decision-3"),
        bar=oracle.bar(14400, 10.03, 10.1, 10.02, 10.07),
        cursor_index=4,
    )
    assert second.events[0].kind == "order_rejected"
    assert second.events[0].details["margin_admission"]["available_account"] == "1"
    assert second.snapshot.balance == second.snapshot.equity == Decimal("1000")


def test_margin_ignores_financial_costs_but_floating_pnl_does_not():
    snapshot = initial(balance="12.406725", margin=MARGIN)
    changed_costs = {**snapshot.cost_model, "commission_per_side_account": "100"}
    changed = snapshot.model_copy(update={"cost_model": changed_costs})
    original = advance_replay_execution(queued(snapshot), bar=OPEN_BAR, cursor_index=3)
    costly = advance_replay_execution(queued(changed), bar=OPEN_BAR, cursor_index=3)
    assert original.events[0].kind == costly.events[0].kind == "market_fill"
    assert (
        original.events[0].details["margin_admission"]
        == costly.events[0].details["margin_admission"]
    )
    assert original.snapshot.floating_pl != costly.snapshot.floating_pl


def test_invalid_bracket_is_not_disguised_as_margin_rejection():
    snapshot = queue_market_order(
        initial(margin=MARGIN),
        operation_id="bad-bracket",
        side="BUY",
        quantity="0.03",
        stop_loss="11",
        take_profit="12",
    )
    with pytest.raises(ValueError, match="bracket"):
        advance_replay_execution(snapshot, bar=OPEN_BAR, cursor_index=3)
    assert snapshot.ledger == []
    assert snapshot.pending_market_order is not None


def test_quantity_contract_conversion_have_an_independent_margin_threshold():
    snapshot = initial(balance="53.60", margin=MARGIN)
    snapshot = snapshot.model_copy(
        update={
            "instrument_spec": {**snapshot.instrument_spec, "contract_size": "2000"},
            "cost_model": {**snapshot.cost_model, "quote_to_account_rate": "2"},
        }
    )
    pending = queue_market_order(
        snapshot,
        operation_id="independent-inputs",
        side="BUY",
        quantity="0.04",
        stop_loss="9",
        take_profit="12",
    )
    result = advance_replay_execution(pending, bar=OPEN_BAR, cursor_index=3)
    assert result.events[0].kind == "market_fill"
    assert Decimal(
        result.events[0].details["margin_admission"]["required_account"]
    ) == Decimal("53.60")
