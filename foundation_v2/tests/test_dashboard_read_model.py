from copy import deepcopy

import pytest

from test_replay_analytics import closed_trade_record, record
from test_replay_execution_core import initial_state
from trading_workspace_v2.analytics_read_model import AnalyticsValidationError
from trading_workspace_v2.dashboard_read_model import build_dashboard_performance
from trading_workspace_v2.replay_execution import (
    ReplayExecutionSnapshot, advance_replay_execution, fork_replay_execution_checkpoint, queue_market_order,
)


def fork(source, session_id, parent=True):
    child = deepcopy(source)
    child["record_id"] = session_id
    child["payload"].update(parent_session_id=source["record_id"] if parent else None, branch_id=f"branch-{session_id}")
    snapshot = fork_replay_execution_checkpoint(
        ReplayExecutionSnapshot.model_validate(source["payload"]["execution"]),
        replay_session_id=session_id,
        branch_id=f"branch-{session_id}",
    )
    child["payload"]["execution"] = snapshot.model_dump(mode="json")
    if parent:
        child["payload"]["parent_checkpoint_event_sequence"] = snapshot.event_sequence
    return child


def test_summary_counts_real_engine_fills_and_keeps_source_revision():
    source = closed_trade_record()
    result = build_dashboard_performance([source], "tenant-a")
    assert result["metrics"] == {"closed_trade_count": 1, "wins": 1, "losses": 0, "breakeven": 0, "win_rate_pct": 100.0}
    assert result["months"][0]["month"] == "2023-11"
    assert result["symbols"][0]["symbol"] == "EURUSD"
    assert result["sources"][0]["revision"] == source["revision"]
    assert result["sources"][0]["dataset_sha256"] == "d" * 64
    assert result["time_invested_seconds"] is None
    assert result["historical_time_replayed_seconds"] is None
    assert "net_pnl" not in result["metrics"]


def test_forks_share_history_but_unrelated_sessions_keep_identical_fills():
    source = closed_trade_record()
    child = fork(source, "child")
    independent = fork(source, "independent", parent=False)
    result = build_dashboard_performance([source, child, independent], "tenant-a")
    assert result["metrics"]["closed_trade_count"] == 2
    assert result["scope"]["duplicate_trade_count"] == 1
    assert result["scope"]["session_count"] == 3
    assert result["scope"]["readable_session_count"] == 3
    one = build_dashboard_performance([source, child, independent], "tenant-a", session_id="child")
    assert one["metrics"]["closed_trade_count"] == 1
    assert one["scope"]["duplicate_trade_count"] == 0


def test_orphan_branch_is_excluded_from_aggregate_but_can_be_inspected_alone():
    child = fork(closed_trade_record(), "child")
    result = build_dashboard_performance([child], "tenant-a")
    assert result["status"] == "partial"
    assert result["metrics"]["closed_trade_count"] is None
    assert result["excluded"] == [{"session_id": "child", "reason": "branch_ancestry_unavailable"}]
    assert build_dashboard_performance([child], "tenant-a", session_id="child")["metrics"]["closed_trade_count"] == 1


def test_post_fork_fills_are_separate_attempts_but_their_later_copies_are_deduplicated():
    queued = queue_market_order(initial_state(), operation_id="queued-before-fork", side="BUY", quantity="0.10",
                                stop_loss="1.0900", take_profit="1.1020")
    source = record(queued)
    child = fork(source, "child")
    for branch in (source, child):
        advanced = advance_replay_execution(
            ReplayExecutionSnapshot.model_validate(branch["payload"]["execution"]),
            bar={"timestamp": 1700000000, "open": 1.1000, "high": 1.1030, "low": 1.0990, "close": 1.1020},
            cursor_index=1,
        )
        branch["payload"].update(execution=advanced.snapshot.model_dump(mode="json"), cursor_index=1)
    grandchild = fork(child, "grandchild")
    result = build_dashboard_performance([grandchild, child, source], "tenant-a")
    assert result["status"] == "ready"
    assert result["metrics"]["closed_trade_count"] == 2
    assert result["scope"]["duplicate_trade_count"] == 1


def test_missing_branch_checkpoint_does_not_guess_dedup_or_leak_a_partial_source():
    source = closed_trade_record()
    child = fork(source, "child")
    del child["payload"]["parent_checkpoint_event_sequence"]
    result = build_dashboard_performance([child, source], "tenant-a")
    assert result["status"] == "partial"
    assert result["metrics"]["closed_trade_count"] == 1
    assert result["scope"]["readable_session_count"] == 1
    assert [item["session_id"] for item in result["sources"]] == [source["record_id"]]
    assert build_dashboard_performance([child, source], "tenant-a", session_id="child")["metrics"]["closed_trade_count"] == 1


def test_empty_missing_execution_and_corrupt_execution_remain_distinct():
    empty = build_dashboard_performance([], "tenant-a")
    assert empty["metrics"]["closed_trade_count"] == 0
    assert empty["metrics"]["win_rate_pct"] is None
    uninitialized = build_dashboard_performance([record()], "tenant-a")
    assert uninitialized["metrics"]["closed_trade_count"] is None
    assert uninitialized["excluded"][0]["reason"] == "replay_execution_not_initialized"
    initialized = build_dashboard_performance([record(initial_state())], "tenant-a")
    assert initialized["metrics"]["closed_trade_count"] == 0
    assert initialized["metrics"]["win_rate_pct"] is None
    corrupt = closed_trade_record()
    corrupt["payload"]["execution"]["ledger"][1]["details"]["net_pnl"] = "NaN"
    assert build_dashboard_performance([corrupt], "tenant-a")["excluded"][0]["reason"] == "replay_analytics_source_invalid"


def test_filters_are_inclusive_close_time_filters_and_never_creation_dates():
    source = closed_trade_record()
    source["created_at_utc"] = "2026-10-01T12:00:00Z"
    selected = build_dashboard_performance([source], "tenant-a", from_close_utc="2023-11-14T22:14:20Z", to_close_utc="2023-11-14T22:14:20Z")
    assert selected["metrics"]["closed_trade_count"] == 1
    outside = build_dashboard_performance([source], "tenant-a", from_close_utc="2026-10-01T00:00:00Z")
    assert outside["metrics"]["closed_trade_count"] == 0
    assert outside["metrics"]["win_rate_pct"] is None
    assert outside["scope"]["session_count"] == 1
    with pytest.raises(AnalyticsValidationError):
        build_dashboard_performance([source], "tenant-a", from_close_utc="2026-10-02T00:00:00Z", to_close_utc="2026-10-01T00:00:00Z")
    with pytest.raises(LookupError):
        build_dashboard_performance([source], "tenant-a", session_id="another-tenant-session")


def test_a_bad_session_cannot_erase_the_verified_part_or_look_complete():
    good = closed_trade_record()
    unknown = record()
    unknown["record_id"] = "not-initialized"
    result = build_dashboard_performance([good, unknown], "tenant-a")
    assert result["status"] == "partial"
    assert result["metrics"]["closed_trade_count"] == 1
    assert result["scope"]["readable_session_count"] == 1
    assert result["scope"]["session_count"] == 2
    assert len(result["excluded"]) == 1


def test_multi_session_ledger_keeps_checkpoint_currency_and_capital_per_trade():
    source = closed_trade_record()
    source["payload"]["name"] = "Original"
    child = fork(source, "child")
    independent = fork(source, "independent", parent=False)
    independent["payload"]["execution"]["instrument_spec"]["account_ccy"] = "EUR"
    result = build_dashboard_performance([source, child, independent], "tenant-a", session_ids=[source["record_id"], "child", "independent"], include_ledger=True)
    assert len(result["ledger"]) == 2
    assert result["scope"]["duplicate_trade_count"] == 1
    assert {row["account_currency"] for row in result["ledger"]} == {"USD", "EUR"}
    assert result["ledger"][0]["session_name"] == "Original"
    assert all(row["starting_balance"] > 0 for row in result["ledger"])
    assert all(row["source_provenance"]["revision"] == source["revision"] for row in result["ledger"])
    assert "net_pnl" not in result["metrics"]
    one = build_dashboard_performance([source, child], "tenant-a", session_ids=["child"], include_ledger=True)
    assert len(one["ledger"]) == 1
    assert one["ledger"][0]["session_id"] == "child"
    assert one["scope"]["duplicate_trade_count"] == 0


def test_empty_unknown_duplicate_and_filtered_trade_session_scopes():
    source = closed_trade_record()
    assert build_dashboard_performance([source], "tenant-a", session_ids=[], include_ledger=True)["ledger"] == []
    with pytest.raises(LookupError):
        build_dashboard_performance([source], "tenant-a", session_ids=["missing"], include_ledger=True)
    assert len(build_dashboard_performance([source], "tenant-a", session_ids=[source["record_id"]] * 2, include_ledger=True)["ledger"]) == 1
    assert build_dashboard_performance([source], "tenant-a", outcome="loss", include_ledger=True)["ledger"] == []
