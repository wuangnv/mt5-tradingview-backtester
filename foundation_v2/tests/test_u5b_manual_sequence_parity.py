from __future__ import annotations

import hashlib
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

from trading_workspace_v2.artifacts import canonical_json_bytes
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
from trading_workspace_v2.research_engine import execute_breakout
from trading_workspace_v2.research_validation import (
    ResearchReconciliationError,
    compare_replay_engine_execution,
)

from foundation_v2.tests import test_u5_engine_oracle as oracle
from foundation_v2.tests.test_u5b_manual_execution_parity import LONG_PREFIX
from foundation_v2.tests.test_u5b_protective_margin import (
    native_protocol,
    protective_protocol,
    validation_payload,
)

NO_SIGNAL_ROWS = [oracle.bar(i * 3600, 10, 10.1, 9.9, 10) for i in range(7)]
LONG_SEQUENCE_ROWS = [
    oracle.bar(0, 9.80, 9.90, 9.70, 9.80),
    oracle.bar(3600, 9.80, 10.00, 9.70, 9.90),
    oracle.bar(7200, 9.90, 10.30, 9.85, 10.20),
    oracle.bar(10800, 10.05, 10.30, 10.00, 10.15),
    oracle.bar(14400, 10.15, 10.50, 10.10, 10.45),
    oracle.bar(18000, 10.46, 10.60, 10.40, 10.50),
    oracle.bar(21600, 10.50, 10.90, 10.40, 10.55),
]
SHORT_SEQUENCE_ROWS = [
    oracle.bar(0, 10.20, 10.30, 10.10, 10.20),
    oracle.bar(3600, 10.20, 10.30, 10.00, 10.10),
    oracle.bar(7200, 10.10, 10.15, 9.70, 9.80),
    oracle.bar(10800, 9.95, 10.00, 9.70, 9.85),
    oracle.bar(14400, 9.85, 9.90, 9.50, 9.55),
    oracle.bar(18000, 9.54, 9.60, 9.40, 9.50),
    oracle.bar(21600, 9.50, 9.60, 9.10, 9.45),
]
MIXED_SEQUENCE_ROWS = LONG_PREFIX + [
    oracle.bar(10800, 10.03, 10.50, 9.95, 10.10),
    oracle.bar(14400, 10.10, 10.15, 9.65, 9.70),
    oracle.bar(18000, 10.17, 10.20, 9.70, 9.80),
]
OVERLAP_ROWS = LONG_PREFIX + [
    oracle.bar(10800, 10.03, 10.33, 9.95, 10.30),
    oracle.bar(14400, 10.30, 10.50, 10.00, 10.20),
    oracle.bar(18000, 10.20, 10.50, 10.10, 10.20),
    oracle.bar(21600, 10.20, 10.50, 10.10, 10.20),
]

# Decisions and absolute brackets are declared before either engine runs.
# Entries are never derived from the automated signal counters or fills.
SEQUENCES = [
    (
        "long-long",
        "long",
        LONG_SEQUENCE_ROWS,
        2,
        [
            (2, "BUY", "9.90", "10.40"),
            (3, "NO_SIGNAL", None, None),
            (4, "BUY", "10.30", "10.80"),
        ],
        {
            "long": 2,
            "short": 0,
            "no_signal": 1,
            "skipped_overlap": 0,
            "skipped_margin": 0,
        },
    ),
    (
        "short-short",
        "short",
        SHORT_SEQUENCE_ROWS,
        2,
        [
            (2, "SELL", "10.10", "9.60"),
            (3, "NO_SIGNAL", None, None),
            (4, "SELL", "9.70", "9.20"),
        ],
        {
            "long": 0,
            "short": 2,
            "no_signal": 1,
            "skipped_overlap": 0,
            "skipped_margin": 0,
        },
    ),
    (
        "long-short",
        "both",
        MIXED_SEQUENCE_ROWS,
        1,
        [
            (2, "BUY", "9.85", "10.35"),
            (3, "NO_SIGNAL", None, None),
            (4, "SELL", "10.35", "9.85"),
        ],
        {
            "long": 1,
            "short": 1,
            "no_signal": 1,
            "skipped_overlap": 0,
            "skipped_margin": 0,
        },
    ),
    (
        "overlap-skip",
        "long",
        OVERLAP_ROWS,
        3,
        [(2, "BUY", "9.85", "10.35"), (3, "SKIP_BUY", None, None)],
        {
            "long": 2,
            "short": 0,
            "no_signal": 0,
            "skipped_overlap": 1,
            "skipped_margin": 0,
        },
    ),
]


def manual_sequence(rows, protocol, decisions):
    snapshot = initialize_replay_execution(
        replay_session_id="manual-sequence",
        branch_id="manual-sequence-branch",
        dataset_id=protocol["dataset"]["dataset_id"],
        dataset_sha256=protocol["dataset"]["artifact_sha256"],
        instrument_spec=protocol["dataset"]["instrument_spec"],
        cost_model=protocol["parameters"]["cost_model"],
        spread_price=protocol["parameters"]["spread_price"],
        timeframe_seconds=protocol["dataset"]["timeframe_seconds"],
        starting_balance=protocol["starting_balance"],
        cursor_index=1,
    )
    declared = {
        cursor: (action, stop, take) for cursor, action, stop, take in decisions
    }
    assert len(declared) == len(decisions)
    assert set(declared) == set(
        range(2, len(rows) - protocol["playbook"]["rules"]["hold_bars"])
    )
    checkpoints = {}
    for index in range(2, len(rows)):
        snapshot = advance_replay_execution(
            snapshot, bar=rows[index], cursor_index=index
        ).snapshot
        if index in declared:
            action, stop, take = declared[index]
            visible = rows[: index + 1]
            prior = visible[-3:-1]
            close = Decimal(str(visible[-1]["close"]))
            high = max(Decimal(str(row["high"])) for row in prior)
            low = min(Decimal(str(row["low"])) for row in prior)
            if action == "NO_SIGNAL":
                assert low <= close <= high
                assert stop is None and take is None
            elif action == "SKIP_BUY":
                assert close > high
                assert snapshot.position is not None
                assert snapshot.pending_market_order is None
            else:
                assert (close > high) if action == "BUY" else (close < low)
                snapshot = queue_market_order(
                    snapshot,
                    operation_id=f"decision-{index}",
                    side=action,
                    quantity="0.03",
                    stop_loss=stop,
                    take_profit=take,
                )
        checkpoints[index] = snapshot.model_dump(mode="json")
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
    }, checkpoints


@pytest.fixture(params=["reference", "nautilus"])
def engine_pair(request):
    if request.param == "nautilus" and not runtime_ready():
        pytest.skip("isolated Nautilus runtime required")

    def run(rows, **kwargs):
        protocol = (
            native_protocol if request.param == "nautilus" else protective_protocol
        )(rows, **kwargs)
        protocol["dataset"]["artifact_sha256"] = hashlib.sha256(
            canonical_json_bytes(rows)
        ).hexdigest()
        if request.param == "nautilus":
            native = execute_native_process(
                rows,
                protocol,
                continue_check=lambda: True,
                deadline=time.perf_counter() + 10,
            )
            result = normalize_native_result(native, protocol)
        else:
            result = execute_breakout(rows, protocol)
        return protocol, validation_payload(result, protocol)

    return run


def test_no_order_segment_has_zero_trades_without_claiming_manual_decision_audit(
    engine_pair,
):
    rows = NO_SIGNAL_ROWS
    protocol, result = engine_pair(rows, direction="both")
    manual, checkpoints = manual_sequence(
        rows,
        protocol,
        [(index, "NO_SIGNAL", None, None) for index in range(2, 6)],
    )
    compared = compare_replay_engine_execution(
        replay_view=manual, research_result=result, rows=rows
    )

    assert result["signals"] == {
        "long": 0,
        "short": 0,
        "no_signal": 4,
        "skipped_overlap": 0,
        "skipped_margin": 0,
    }
    assert compared["reconciled"] is True
    assert compared["trade_count"] == 0
    assert "manual_no_signal_decisions" in compared["not_compared"]
    for checkpoint in checkpoints.values():
        assert checkpoint["position"] is None
        assert checkpoint["pending_market_order"] is None
        assert all(event["kind"] == "price_mark" for event in checkpoint["ledger"])
        assert Decimal(checkpoint["balance"]) == Decimal("10000")
        assert Decimal(checkpoint["equity"]) == Decimal("10000")


@pytest.mark.parametrize(
    ("name", "direction", "rows", "hold", "decisions", "signals"),
    SEQUENCES,
    ids=[case[0] for case in SEQUENCES],
)
def test_predeclared_manual_sequences_match_engine(
    engine_pair, name, direction, rows, hold, decisions, signals
):
    protocol, result = engine_pair(rows, direction=direction, hold_bars=hold)
    manual, checkpoints = manual_sequence(rows, protocol, decisions)
    compared = compare_replay_engine_execution(
        replay_view=manual, research_result=result, rows=rows
    )

    assert compared["reconciled"] is True
    assert compared["trade_count"] == (1 if name == "overlap-skip" else 2)
    assert result["signals"] == signals
    assert all(trade["exit_reason"] == "take_profit" for trade in result["ledger"])
    assert all(trade["fees"] > 0 for trade in result["ledger"])
    if name in {"long-long", "short-short"}:
        first, second = result["ledger"]
        assert (
            first["close_time_utc"]
            == second["signal_time_utc"]
            == second["open_time_utc"]
        )
        closing = next(
            event
            for event in checkpoints[4]["ledger"]
            if event["kind"] == "protective_fill"
        )
        opening = next(
            event
            for event in checkpoints[5]["ledger"]
            if event["kind"] == "market_fill"
            and event["details"]["operation_id"] == "decision-4"
        )
        assert closing["virtual_time_utc"] == opening["virtual_time_utc"]
        assert closing["sequence"] < opening["sequence"]
    elif name == "overlap-skip":
        assert checkpoints[3]["position"] is not None
        assert checkpoints[3]["pending_market_order"] is None
        assert (
            sum(event["kind"] == "market_fill" for event in checkpoints[6]["ledger"])
            == 1
        )


def test_future_suffix_cannot_change_prior_manual_decisions_or_completed_trade(
    engine_pair,
):
    _, direction, rows, hold, decisions, _ = SEQUENCES[2]
    changed_rows = deepcopy(rows)
    changed_rows[-1] = oracle.bar(18000, 10.17, 10.50, 9.95, 10.40)
    protocol, result = engine_pair(rows, direction=direction, hold_bars=hold)
    changed_protocol, changed_result = engine_pair(
        changed_rows, direction=direction, hold_bars=hold
    )
    manual, original_prefix = manual_sequence(rows, protocol, decisions)
    changed_manual, changed_prefix = manual_sequence(
        changed_rows, changed_protocol, decisions
    )

    assert (
        protocol["dataset"]["artifact_sha256"]
        != changed_protocol["dataset"]["artifact_sha256"]
    )
    for index in range(2, 5):
        before, after = original_prefix[index], changed_prefix[index]
        # Different immutable sources retain different lineage. Account state,
        # queued decisions and the consumed event prefix must remain identical.
        assert {
            key: value
            for key, value in before.items()
            if key not in {"dataset_sha256", "ledger"}
        } == {
            key: value
            for key, value in after.items()
            if key not in {"dataset_sha256", "ledger"}
        }
        assert [
            {key: value for key, value in event.items() if key != "dataset_sha256"}
            for event in before["ledger"]
        ] == [
            {key: value for key, value in event.items() if key != "dataset_sha256"}
            for event in after["ledger"]
        ]
    assert result["ledger"][0] == changed_result["ledger"][0]
    assert result["ledger"][1]["exit_reason"] == "take_profit"
    assert changed_result["ledger"][1]["exit_reason"] == "stop_loss"
    assert result["ledger"][1]["net_pnl"] != changed_result["ledger"][1]["net_pnl"]
    for view, output, source in (
        (manual, result, rows),
        (changed_manual, changed_result, changed_rows),
    ):
        assert compare_replay_engine_execution(
            replay_view=view, research_result=output, rows=source
        )["reconciled"]


def test_missing_replay_margin_contract_is_exposed_as_a_real_divergence(engine_pair):
    rows = LONG_PREFIX + [oracle.bar(10800, 10.03, 10.50, 9.95, 10.40)]
    protocol, result = engine_pair(rows, starting_balance=1)
    manual, _ = manual_sequence(rows, protocol, [(2, "BUY", "9.85", "10.35")])

    assert result["signals"]["skipped_margin"] == 1
    assert result["ledger"] == []
    assert (
        sum(
            event["kind"] == "market_fill"
            for event in manual["payload"]["execution"]["ledger"]
        )
        == 1
    )
    with pytest.raises(ResearchReconciliationError, match="closed trade counts differ"):
        compare_replay_engine_execution(
            replay_view=manual, research_result=result, rows=rows
        )
