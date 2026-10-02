from __future__ import annotations

import sys
import time
from copy import deepcopy
from decimal import Decimal
from pathlib import Path

import pytest

V2 = Path(__file__).resolve().parents[1]
for path in (V2.parent, V2):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from trading_workspace_v2.execution_semantics import IntrabarAmbiguityError
from trading_workspace_v2.nautilus_worker import (
    execute_native_process,
    normalize_native_result,
    runtime_ready,
)
from trading_workspace_v2.replay_execution import (
    advance_replay_execution,
    initialize_replay_execution,
    queue_market_order,
)
from trading_workspace_v2.research_engine import (
    ResearchEngineValidationError,
    execute_breakout,
)
from trading_workspace_v2.research_validation import (
    ResearchReconciliationError,
    compare_replay_engine_execution,
)

from foundation_v2.tests import test_u5_engine_oracle as oracle
from foundation_v2.tests.test_u5b_protective_margin import (
    native_protocol,
    protective_protocol,
    validation_payload,
)

LONG_PREFIX = [
    oracle.bar(0, 9.80, 9.95, 9.70, 9.90),
    oracle.bar(3600, 9.90, 10.10, 9.85, 10.00),
    oracle.bar(7200, 10.00, 10.25, 9.95, 10.20),
]
SHORT_PREFIX = [
    oracle.bar(0, 10.20, 10.30, 10.00, 10.10),
    oracle.bar(3600, 10.10, 10.20, 9.90, 10.00),
    oracle.bar(7200, 10.00, 10.05, 9.70, 9.80),
]
CASES = [
    (
        "long-stop",
        "long",
        LONG_PREFIX + [oracle.bar(10800, 10.03, 10.20, 9.80, 10.00)],
        1,
        "9.85",
        "10.35",
        "stop_loss",
    ),
    (
        "long-tp",
        "long",
        LONG_PREFIX + [oracle.bar(10800, 10.03, 10.50, 9.95, 10.40)],
        1,
        "9.85",
        "10.35",
        "take_profit",
    ),
    (
        "short-stop",
        "short",
        SHORT_PREFIX + [oracle.bar(10800, 10.17, 10.40, 9.95, 10.20)],
        1,
        "10.35",
        "9.85",
        "stop_loss",
    ),
    (
        "short-tp",
        "short",
        SHORT_PREFIX + [oracle.bar(10800, 10.17, 10.20, 9.70, 9.80)],
        1,
        "10.35",
        "9.85",
        "take_profit",
    ),
    (
        "long-gap-stop",
        "long",
        LONG_PREFIX
        + [
            oracle.bar(10800, 10.03, 10.20, 9.95, 10.10),
            oracle.bar(14400, 9.70, 9.90, 9.60, 9.80),
        ],
        2,
        "9.85",
        "10.35",
        "stop_loss_gap",
    ),
    (
        "long-gap-tp",
        "long",
        LONG_PREFIX
        + [
            oracle.bar(10800, 10.03, 10.20, 9.95, 10.10),
            oracle.bar(14400, 10.60, 10.70, 10.50, 10.65),
        ],
        2,
        "9.85",
        "10.35",
        "take_profit_gap",
    ),
    (
        "short-gap-stop",
        "short",
        SHORT_PREFIX
        + [
            oracle.bar(10800, 10.17, 10.20, 9.95, 10.10),
            oracle.bar(14400, 10.60, 10.70, 10.50, 10.65),
        ],
        2,
        "10.35",
        "9.85",
        "stop_loss_gap",
    ),
    (
        "short-gap-tp",
        "short",
        SHORT_PREFIX
        + [
            oracle.bar(10800, 10.17, 10.20, 9.95, 10.10),
            oracle.bar(14400, 9.70, 9.90, 9.60, 9.80),
        ],
        2,
        "10.35",
        "9.85",
        "take_profit_gap",
    ),
]


def manual_view(rows, protocol, *, side, stop, take):
    # The manual decision and absolute brackets are predeclared fixture inputs.
    # Only the visible three-bar prefix is inspected before queuing the order;
    # no engine trade/fill is copied into the manual execution path.
    visible = rows[:3]
    assert (
        (visible[-1]["close"] > max(row["high"] for row in visible[:-1]))
        if side == "BUY"
        else (visible[-1]["close"] < min(row["low"] for row in visible[:-1]))
    )
    snapshot = initialize_replay_execution(
        replay_session_id="manual-parity",
        branch_id="manual-parity-branch",
        dataset_id=protocol["dataset"]["dataset_id"],
        dataset_sha256=protocol["dataset"]["artifact_sha256"],
        instrument_spec=protocol["dataset"]["instrument_spec"],
        cost_model=protocol["parameters"]["cost_model"],
        spread_price=protocol["parameters"]["spread_price"],
        timeframe_seconds=protocol["dataset"]["timeframe_seconds"],
        starting_balance=protocol["starting_balance"],
        cursor_index=2,
    )
    snapshot = queue_market_order(
        snapshot,
        operation_id="closed-bar-decision-2",
        side=side,
        quantity="0.03",
        stop_loss=stop,
        take_profit=take,
    )
    for index in range(3, len(rows)):
        snapshot = advance_replay_execution(
            snapshot, bar=rows[index], cursor_index=index
        ).snapshot
    return {
        "record_id": snapshot.replay_session_id,
        "workspace_id": "u5b-fixture",
        "revision": 1,
        "payload": {
            "dataset_id": snapshot.dataset_id,
            "branch_id": snapshot.branch_id,
            "cursor_index": snapshot.cursor_index,
            "execution": snapshot.model_dump(mode="json"),
        },
        "visible_rows": deepcopy(rows),
        "cutoff_timestamp": rows[-1]["timestamp"],
        "has_future_rows": False,
        "dataset_sha256": snapshot.dataset_sha256,
    }


def reference_pair():
    _, direction, rows, hold, stop, take, _ = CASES[1]
    protocol = protective_protocol(rows, direction=direction, hold_bars=hold)
    manual = manual_view(rows, protocol, side="BUY", stop=stop, take=take)
    result = validation_payload(execute_breakout(rows, protocol), protocol)
    return manual, result, rows


@pytest.mark.parametrize(
    ("name", "direction", "rows", "hold", "stop", "take", "reason"),
    CASES,
    ids=[case[0] for case in CASES],
)
def test_manual_protective_execution_matches_reference(
    name, direction, rows, hold, stop, take, reason
):
    protocol = protective_protocol(rows, direction=direction, hold_bars=hold)
    manual = manual_view(
        rows,
        protocol,
        side="BUY" if direction == "long" else "SELL",
        stop=stop,
        take=take,
    )
    result = validation_payload(execute_breakout(rows, protocol), protocol)
    compared = compare_replay_engine_execution(
        replay_view=manual, research_result=result, rows=rows
    )

    assert compared["reconciled"] is True
    assert compared["trade_count"] == 1
    assert compared["execution_capability"] is False
    assert result["ledger"][0]["exit_reason"] == reason
    assert (
        result["ledger"][0]["fees"] > 0
    )  # Commission, conversion, slippage and rounding are active.
    assert Decimal(manual["payload"]["execution"]["balance"]) == Decimal(
        str(result["metrics"]["ending_closed_trade_balance"])
    )


@pytest.mark.skipif(not runtime_ready(), reason="isolated Nautilus runtime required")
@pytest.mark.parametrize(
    ("name", "direction", "rows", "hold", "stop", "take", "reason"),
    CASES,
    ids=[case[0] for case in CASES],
)
def test_manual_protective_execution_matches_primary_nautilus(
    name, direction, rows, hold, stop, take, reason
):
    protocol = native_protocol(rows, direction=direction, hold_bars=hold)
    manual = manual_view(
        rows,
        protocol,
        side="BUY" if direction == "long" else "SELL",
        stop=stop,
        take=take,
    )
    native = execute_native_process(
        rows, protocol, continue_check=lambda: True, deadline=time.perf_counter() + 10
    )
    result = validation_payload(normalize_native_result(native, protocol), protocol)
    compared = compare_replay_engine_execution(
        replay_view=manual, research_result=result, rows=rows
    )

    assert compared["engine_backend"] == "nautilus"
    assert compared["reconciled"] is True
    assert result["ledger"][0]["exit_reason"] == reason
    assert native["fills"][0]["timestamp_ns"] == 10800 * 10**9 + 1
    # Engine uses nanoseconds to order a synthetic open after the prior close;
    # manual replay records the same bar boundary as integer UTC seconds.
    close_time = result["ledger"][0]["close_time_utc"] * 10**9
    assert native["fills"][1]["timestamp_ns"] == close_time + (
        1 if reason.endswith("_gap") else -1
    )
    if name == "long-stop":
        tampered = deepcopy(result)
        tampered["execution"]["runtime_identity"]["nautilus_trader"] = "unsupported"
        with pytest.raises(ResearchReconciliationError, match="runtime environment"):
            compare_replay_engine_execution(
                replay_view=manual, research_result=tampered, rows=rows
            )


@pytest.mark.parametrize(
    "mismatch",
    [
        "workspace",
        "dataset",
        "dataset_hash",
        "cost",
        "instrument",
        "cursor",
        "cutoff",
        "prefix",
        "fill",
        "quantity",
        "exit_reason",
        "future_event",
        "protocol_hash",
    ],
)
def test_parity_rejects_mismatched_lineage_boundaries_and_execution(mismatch):
    manual, result, rows = reference_pair()
    snapshot = manual["payload"]["execution"]
    if mismatch == "workspace":
        manual["workspace_id"] = "foreign"
    elif mismatch == "dataset":
        snapshot["dataset_id"] = "foreign"
    elif mismatch == "dataset_hash":
        manual["dataset_sha256"] = "different-source"
    elif mismatch == "cost":
        snapshot["cost_model"]["commission_per_side_account"] = "99"
    elif mismatch == "instrument":
        snapshot["instrument_spec"]["tick_size"] = "0.01"
    elif mismatch == "cursor":
        snapshot["cursor_index"] = 2
        manual["payload"]["cursor_index"] = 2
    elif mismatch == "cutoff":
        manual["cutoff_timestamp"] -= 3600
    elif mismatch == "prefix":
        manual["visible_rows"][-1]["close"] = 99
    elif mismatch == "fill":
        event = next(
            event for event in snapshot["ledger"] if event["kind"] == "market_fill"
        )
        event["details"]["fill_price"] = "9.99"
    elif mismatch == "quantity":
        event = next(
            event for event in snapshot["ledger"] if event["kind"] == "market_fill"
        )
        event["details"]["quantity"] = "0.04"
    elif mismatch == "exit_reason":
        event = next(
            event for event in snapshot["ledger"] if event["kind"] == "protective_fill"
        )
        event["details"]["reason"] = "stop_loss"
    elif mismatch == "future_event":
        snapshot["ledger"][-1]["virtual_time_utc"] = (
            result["protocol"]["range"]["to_utc"] + 3600
        )
    else:
        result["protocol"]["engine"]["backend"] = "nautilus"
    with pytest.raises(ResearchReconciliationError):
        compare_replay_engine_execution(
            replay_view=manual, research_result=result, rows=rows
        )


def test_unresolved_manual_horizon_and_dual_hit_remain_fail_closed():
    rows = LONG_PREFIX + [oracle.bar(10800, 10.03, 10.20, 9.95, 10.10)]
    protocol = protective_protocol(rows)
    manual = manual_view(rows, protocol, side="BUY", stop="9.85", take="10.35")
    result = validation_payload(execute_breakout(rows, protocol), protocol)
    assert result["ledger"][0]["exit_reason"] == "horizon"
    with pytest.raises(ResearchReconciliationError, match="flat"):
        compare_replay_engine_execution(
            replay_view=manual, research_result=result, rows=rows
        )

    ambiguous = LONG_PREFIX + [oracle.bar(10800, 10.03, 10.50, 9.70, 10.10)]
    with pytest.raises(IntrabarAmbiguityError):
        manual_view(
            ambiguous,
            protective_protocol(ambiguous),
            side="BUY",
            stop="9.85",
            take="10.35",
        )
    with pytest.raises(ResearchEngineValidationError, match="ambiguous"):
        execute_breakout(ambiguous, protective_protocol(ambiguous))
