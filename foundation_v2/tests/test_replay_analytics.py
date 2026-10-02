from copy import deepcopy
from decimal import Decimal

import pytest

from test_replay_execution_core import initial_state
from trading_workspace_v2.analytics_read_model import AnalyticsValidationError, analytics_csv
from trading_workspace_v2.contracts import ReplayMetadataUpdate
from trading_workspace_v2.replay import ReplayService
from trading_workspace_v2.replay_analytics import build_replay_analytics_view
from trading_workspace_v2.replay_execution import advance_replay_execution, queue_market_order, transition_replay_phase


def record(snapshot=None):
    payload = {"dataset_id": "dataset-fixture", "branch_id": "branch-fixture", "cursor_index": 0}
    if snapshot:
        payload.update(execution=snapshot.model_dump(mode="json"), cursor_index=snapshot.cursor_index)
    return {"record_id": "replay-fixture", "workspace_id": "tenant-a", "revision": 3, "payload": payload}


def closed_trade_record():
    queued = queue_market_order(initial_state(), operation_id="open-1", side="BUY", quantity="0.10",
                                stop_loss="1.0900", take_profit="1.1020")
    advanced = advance_replay_execution(queued,
        bar={"timestamp": 1700000000, "open": 1.1000, "high": 1.1030, "low": 1.0990, "close": 1.1020},
        cursor_index=1)
    assert advanced.snapshot.position is None
    return record(advanced.snapshot)


def two_trade_record():
    from trading_workspace_v2.replay_execution import ReplayExecutionSnapshot

    first = ReplayExecutionSnapshot.model_validate(closed_trade_record()["payload"]["execution"])
    queued = queue_market_order(first, operation_id="open-2", side="BUY", quantity="0.20",
                                stop_loss="1.0900", take_profit="1.1020")
    second = advance_replay_execution(queued,
        bar={"timestamp": 1700000060, "open": 1.1000, "high": 1.1030, "low": 1.0990, "close": 1.1020},
        cursor_index=2)
    return record(second.snapshot)


class AnalyticsStore:
    def __init__(self):
        self.current = two_trade_record()
        self.initial = {**record(initial_state()), "revision": 1}

    def get_record(self, workspace, kind, session):
        return deepcopy(self.current) if workspace == "tenant-a" and session == "replay-fixture" else None

    def list_record_revisions(self, workspace, kind, session):
        return [deepcopy(self.initial), deepcopy(self.current)]


def test_historical_analytics_and_csv_exclude_later_fills_without_changing_head():
    store = AnalyticsStore()
    service = ReplayService(store, None)
    before = deepcopy(store.current)
    historical = build_replay_analytics_view(service.analytics_record("tenant-a", "replay-fixture", 1))
    latest = build_replay_analytics_view(service.analytics_record("tenant-a", "replay-fixture"))
    assert historical["metrics"]["closed_trade_count"] == 1
    assert historical["metrics"]["net_pnl"] == 17
    assert historical["cursor_index"] == 1 and historical["canonical_cursor_index"] == 2
    assert historical["historical_view"] is True
    assert latest["metrics"]["closed_trade_count"] == 2
    assert latest["metrics"]["net_pnl"] == 53
    assert latest["historical_view"] is False
    assert "metrics,net_pnl,17" in analytics_csv(historical)
    assert latest["ledger"][1]["trade_id"] not in analytics_csv(historical)
    assert store.current == before


def test_initial_cursor_uses_immutable_revision_and_remains_empty():
    store = AnalyticsStore()
    service = ReplayService(store, None)
    view = build_replay_analytics_view(service.analytics_record("tenant-a", "replay-fixture", 0))
    assert view["scope"]["total_trade_count"] == 0
    assert view["metrics"]["net_pnl"] == 0
    assert view["ledger"] == []
    store.initial["payload"]["execution"]["dataset_sha256"] = "e" * 64
    with pytest.raises(ValueError, match="lineage"):
        service.analytics_record("tenant-a", "replay-fixture", 0)


@pytest.mark.parametrize("cursor", [-1, 3, True, "1"])
def test_invalid_historical_cursor_is_rejected(cursor):
    with pytest.raises(ValueError):
        ReplayService(AnalyticsStore(), None).analytics_record("tenant-a", "replay-fixture", cursor)


def test_cutoff_and_cursor_must_select_the_same_visible_bar(monkeypatch):
    service = ReplayService(AnalyticsStore(), None)
    monkeypatch.setattr(service, "_dataset_rows", lambda *_: (None, [
        {"timestamp": 1699999940}, {"timestamp": 1700000000}, {"timestamp": 1700000060},
    ]))
    for cursor in (None, 1):
        result = service.analytics_record("tenant-a", "replay-fixture", cursor, 1700000000)
        assert result["payload"]["cursor_index"] == 1
    for cursor, cutoff in [(2, 1700000000), (True, 1700000000), (None, True),
                           (None, 1699999939), (None, 1700000061)]:
        with pytest.raises(ValueError):
            service.analytics_record("tenant-a", "replay-fixture", cursor, cutoff)
    with pytest.raises(LookupError):
        service.analytics_record("tenant-b", "replay-fixture", 1)


def test_corrupt_ledger_is_not_hidden_by_a_historical_revision():
    store = AnalyticsStore()
    store.current["payload"]["execution"]["ledger"][0]["branch_id"] = "foreign"
    with pytest.raises(ValueError, match="lineage"):
        ReplayService(store, None).analytics_record("tenant-a", "replay-fixture", 0)


def test_uninitialized_execution_remains_unknown():
    view = build_replay_analytics_view(record())
    assert view["analytics_available"] is False
    assert view["scope"]["total_trade_count"] is None
    assert view["blocked_by_data"] == ["replay_execution_not_initialized"]


def test_real_engine_fills_become_closed_trades_with_provenance_and_unknown_cost_breakdown():
    source = closed_trade_record()
    view = build_replay_analytics_view(source)
    trade = view["ledger"][0]
    assert view["metrics"]["closed_trade_count"] == 1
    assert trade["net_pnl"] == pytest.approx(float(source["payload"]["execution"]["balance"]) - 100000)
    assert trade["side"] == "BUY"
    assert trade["price_open"] == 1.1001
    assert trade["price_close"] == 1.1020
    assert trade["gross_pnl"] is None and trade["fees"] is None and trade["realized_r"] is None
    assert view["provenance"]["session_id"] == "replay-fixture"
    assert view["provenance"]["dataset_sha256"] == "d" * 64
    assert view["provenance"]["revision"] == 3
    assert view["account_currency"] == "USD"
    assert "replay-fixture" in analytics_csv(view)
    assert "visible_rows" not in view


def test_replay_filters_use_canonical_metrics_and_time_boundaries():
    source = closed_trade_record()
    matching = build_replay_analytics_view(source, {"side": "BUY", "outcome": "win"})
    assert matching["scope"]["selected_trade_count"] == 1
    empty = build_replay_analytics_view(source, {"side": "SELL"})
    assert empty["scope"]["selected_trade_count"] == 0
    assert empty["scope"]["total_trade_count"] == 1
    with pytest.raises(AnalyticsValidationError):
        build_replay_analytics_view(source, {"side": "invalid"})


def test_open_positions_do_not_appear_as_closed_trade_performance():
    queued = queue_market_order(initial_state(), operation_id="open-1", side="BUY", quantity="0.10",
                                stop_loss="1.0900", take_profit="1.1200")
    advanced = advance_replay_execution(queued,
        bar={"timestamp": 1700000000, "open": 1.1000, "high": 1.1030, "low": 1.0990, "close": 1.1020},
        cursor_index=1)
    view = build_replay_analytics_view(record(advanced.snapshot))
    assert view["open_position_count"] == 1
    assert view["ledger"] == []
    assert view["scope"]["total_trade_count"] == 0


def phase_transition_record(*, open_position=False, carry_policy="reset"):
    queued = queue_market_order(initial_state(), operation_id="phase-entry", side="BUY", quantity="0.10",
                                stop_loss="1.0900", take_profit="1.1200" if open_position else "1.1020")
    advanced = advance_replay_execution(queued,
        bar={"timestamp": 1700000000, "open": 1.1000, "high": 1.1030, "low": 1.0990, "close": 1.1020},
        cursor_index=1)
    transitioned = transition_replay_phase(
        advanced.snapshot, intent_id="phase-2", intent_fingerprint="phase-fixture",
        from_phase_index=1, to_phase_index=2, carry_policy=carry_policy,
        position_policy="carry" if open_position else "must_be_flat",
        next_phase_initial_balance="50000", virtual_time_utc=1700000060,
    )
    return record(transitioned.snapshot)


@pytest.mark.parametrize("carry_policy", ["reset", "carry_balance", "carry_all"])
def test_phase_transitions_preserve_trade_metrics_without_counting_balance_resets(carry_policy):
    source = phase_transition_record(carry_policy=carry_policy)
    result = build_replay_analytics_view(source)
    assert result["phase_transition_count"] == 1
    assert result["metrics"]["closed_trade_count"] == 1
    assert result["ledger"][0]["net_pnl"] == pytest.approx(17.0)
    assert "phase balance resets excluded" in result["scope"]["balance_curve_scope"]


@pytest.mark.parametrize("corrupt", [None, "carry_balance", "position_policy", "phase_initial_balance", "from_equity"])
def test_phase_open_position_carry_is_validated_against_engine_policy(corrupt):
    source = phase_transition_record(open_position=True, carry_policy="carry_all")
    snapshot = source["payload"]["execution"]
    detail = snapshot["ledger"][-1]["details"]
    if corrupt == "carry_balance":
        detail["carry_policy"] = "carry_balance"
    elif corrupt == "position_policy":
        detail["position_policy"] = "must_be_flat"
    elif corrupt == "phase_initial_balance":
        snapshot["phase_initial_balance"] = "77777"
    elif corrupt == "from_equity":
        detail["from_equity"] = "1"
    if corrupt:
        with pytest.raises(AnalyticsValidationError):
            build_replay_analytics_view(source)
    else:
        result = build_replay_analytics_view(source)
        assert result["open_position_count"] == 1
        assert result["ledger"] == []


@pytest.mark.parametrize("carry_policy", ["reset", "carry_balance", "carry_all"])
def test_phase_transition_cannot_introduce_floating_pnl_without_a_price_event(carry_policy):
    source = phase_transition_record(open_position=carry_policy == "carry_all", carry_policy=carry_policy)
    snapshot = source["payload"]["execution"]
    event = snapshot["ledger"][-1]
    floating = Decimal(event["floating_pl"]) + 1000
    equity = Decimal(event["balance"]) + floating
    event.update(floating_pl=str(floating), equity=str(equity))
    event["details"].update(to_floating_pl=str(floating), to_equity=str(equity))
    snapshot.update(floating_pl=str(floating), equity=str(equity))
    with pytest.raises(AnalyticsValidationError):
        build_replay_analytics_view(source)


@pytest.mark.parametrize("corrupt", ["lineage", "future", "missing_open", "nan"])
def test_untrusted_replay_events_fail_closed(corrupt):
    source = closed_trade_record()
    events = source["payload"]["execution"]["ledger"]
    if corrupt == "lineage":
        events[0]["branch_id"] = "another-branch"
    elif corrupt == "future":
        events[-1]["cursor_index"] = 100
    elif corrupt == "missing_open":
        events[1]["details"]["position_id"] = "missing-position"
    else:
        events[1]["details"]["net_pnl"] = "NaN"
    with pytest.raises((AnalyticsValidationError, ValueError)):
        build_replay_analytics_view(source)


class MetadataStore:
    def __init__(self):
        self.current = closed_trade_record()

    def get_record(self, workspace, kind, session):
        return deepcopy(self.current) if workspace == "tenant-a" and session == self.current["record_id"] else None

    def update_record(self, workspace, kind, session, revision, payload):
        assert revision == self.current["revision"]
        self.current = {**self.current, "revision": revision + 1, "payload": payload}
        return deepcopy(self.current)


def test_metadata_update_preserves_execution_and_rejects_stale_or_cross_workspace_writes():
    store = MetadataStore()
    service = ReplayService(store, None)
    original = deepcopy(store.current["payload"]["execution"])
    updated = service.update_metadata("tenant-a", "replay-fixture", 3, {"name": "Phiên sáng", "archived": True})
    assert updated["revision"] == 4
    assert updated["payload"]["execution"] == original
    assert updated["payload"]["archived"] is True
    with pytest.raises(RuntimeError, match="revision"):
        service.update_metadata("tenant-a", "replay-fixture", 3, {"name": "stale"})
    with pytest.raises(LookupError):
        service.update_metadata("tenant-b", "replay-fixture", 4, {"name": "foreign"})
    with pytest.raises(ValueError):
        service.update_metadata("tenant-a", "replay-fixture", 4, {"cursor_index": 10})
    with pytest.raises(ValueError):
        ReplayMetadataUpdate(expected_revision=4, archived="yes")
