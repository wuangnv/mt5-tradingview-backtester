from __future__ import annotations

from copy import deepcopy
from decimal import Decimal

import pytest

from foundation_v2.tests import test_u5b_manual_sequence_parity as sequences
from foundation_v2.tests.test_u5b_manual_execution_parity import (
    LONG_PREFIX,
    SHORT_PREFIX,
)
from trading_workspace_v2.replay_execution import (
    advance_replay_execution,
    initialize_replay_execution,
    queue_market_order,
)
from trading_workspace_v2.research_validation import (
    ResearchReconciliationError,
    compare_replay_engine_execution,
)

engine_pair = sequences.engine_pair
oracle = sequences.oracle


def margin_view(rows, protocol, side, stop, take):
    snapshot = initialize_replay_execution(
        replay_session_id="margin-parity",
        branch_id="margin-parity-branch",
        dataset_id=protocol["dataset"]["dataset_id"],
        dataset_sha256=protocol["dataset"]["artifact_sha256"],
        instrument_spec=protocol["dataset"]["instrument_spec"],
        cost_model=protocol["parameters"]["cost_model"],
        spread_price=protocol["parameters"]["spread_price"],
        timeframe_seconds=3600,
        starting_balance=protocol["starting_balance"],
        cursor_index=2,
        research_margin=protocol["parameters"]["research_margin"],
    )
    pending = queue_market_order(
        snapshot,
        operation_id="decision-2",
        side=side,
        quantity="0.03",
        stop_loss=stop,
        take_profit=take,
    )
    advanced = advance_replay_execution(pending, bar=rows[3], cursor_index=3).snapshot
    return {
        "record_id": advanced.replay_session_id,
        "workspace_id": "u5b-fixture",
        "revision": 1,
        "payload": {
            "dataset_id": advanced.dataset_id,
            "branch_id": advanced.branch_id,
            "cursor_index": 3,
            "execution": advanced.model_dump(mode="json"),
        },
        "visible_rows": deepcopy(rows),
        "cutoff_timestamp": rows[-1]["timestamp"],
        "has_future_rows": False,
        "dataset_sha256": advanced.dataset_sha256,
    }


@pytest.mark.parametrize(
    "side,prefix,bar,stop,take,required",
    [
        (
            "BUY",
            LONG_PREFIX,
            oracle.bar(10800, 10.03, 10.50, 9.95, 10.40),
            "9.85",
            "10.35",
            "12.406725",
        ),
        (
            "SELL",
            SHORT_PREFIX,
            oracle.bar(10800, 10.17, 10.20, 9.70, 9.80),
            "10.35",
            "9.85",
            "12.530175",
        ),
    ],
)
@pytest.mark.parametrize("balance", ["1", "boundary", "below", "10000"])
def test_margin_parity_and_reason_time_tampering(
    engine_pair, side, prefix, bar, stop, take, required, balance
):
    start = (
        Decimal(required)
        if balance == "boundary"
        else Decimal(required) - Decimal("0.000001")
        if balance == "below"
        else Decimal(balance)
    )
    rows = prefix + [bar]
    protocol, result = engine_pair(
        rows,
        direction="long" if side == "BUY" else "short",
        starting_balance=float(start),
    )
    view = margin_view(rows, protocol, side, stop, take)
    compared = compare_replay_engine_execution(
        replay_view=view, research_result=result, rows=rows
    )
    rejected = start < Decimal(required)
    assert compared["schema"] == "replay-engine-parity-v2"
    assert compared["margin_admission"]["outcome_count"] == 1
    assert compared["margin_admission"]["rejected_count"] == int(rejected)
    assert result["signals"]["skipped_margin"] == int(rejected)
    assert compared["trade_count"] == int(not rejected)
    assert compared["execution_capability"] is False
    assert "undeclared_manual_margin_decisions" in compared["not_compared"]
    event = view["payload"]["execution"]["ledger"][0]
    assert Decimal(event["details"]["margin_admission"]["required_account"]) == Decimal(
        required
    )
    assert event["cursor_index"] == 3 and event["virtual_time_utc"] == 10800
    if rejected:
        assert event["details"]["reason"] == "insufficient_research_margin"
        for tamper in [
            "time",
            "side",
            "cursor",
            "quantity",
            "reason",
            "assumption",
            "missing",
        ]:
            changed = deepcopy(view)
            snapshot = changed["payload"]["execution"]
            outcome = snapshot["ledger"][0]
            if tamper == "time":
                outcome["virtual_time_utc"] += 1
            elif tamper == "side":
                outcome["details"]["side"] = "SELL" if side == "BUY" else "BUY"
            elif tamper == "cursor":
                outcome["cursor_index"] = 2
                outcome["details"]["margin_admission"]["submitted_cursor_index"] = 1
            elif tamper == "quantity":
                outcome["details"]["quantity"] = "0.06"
                outcome["details"]["margin_admission"]["required_account"] = str(
                    Decimal(required) * 2
                )
            elif tamper == "reason":
                outcome["details"]["reason"] = "broker_rejected"
            elif tamper == "assumption":
                snapshot["research_margin"]["leverage"] = "60"
                outcome["details"]["margin_admission"]["leverage"] = "60"
                outcome["details"]["margin_admission"]["required_account"] = str(
                    Decimal(required) / 2
                )
            else:
                snapshot["ledger"].pop(0)
                snapshot["ledger"][0]["sequence"] = snapshot["event_sequence"] = 1
            with pytest.raises(ResearchReconciliationError):
                compare_replay_engine_execution(
                    replay_view=changed, research_result=result, rows=rows
                )
