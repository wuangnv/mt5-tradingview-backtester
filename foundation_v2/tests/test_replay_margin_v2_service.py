from __future__ import annotations

from copy import deepcopy
from decimal import Decimal

import pytest

from foundation_v2.tests import test_ps02_replay_prop_connection as prop
from foundation_v2.tests.test_replay_margin_v2 import MARGIN
from trading_workspace_v2.replay import ReplayService
from trading_workspace_v2.replay_analytics import build_replay_analytics_view
from trading_workspace_v2.replay_execution import parse_replay_execution_snapshot


def service_fixture():
    rows = [
        {
            "timestamp": prop.BASE_TIME + index * 60,
            "open": 1.1,
            "high": 1.103,
            "low": 1.099,
            "close": 1.102,
            "volume": 10,
        }
        for index in range(4)
    ]
    store = prop.FakeStore(rows)
    session, attempt, phase, resume = store.prop
    profile = session.profile.model_copy(
        update={"phases": [prop.phase_spec(initial_capital="1")]}
    )
    store.prop = (
        session.model_copy(update={"profile": profile}),
        attempt.model_copy(update={"engine_version": "replay-v2"}),
        phase.model_copy(
            update={
                "initial_balance": Decimal("1"),
                "balance": Decimal("1"),
                "equity": Decimal("1"),
                "high_water_mark": Decimal("1"),
                "daily_anchor": Decimal("1"),
            }
        ),
        resume,
    )
    service = ReplayService(store, prop.FakeArtifacts(rows))
    created = service.create("tenant-a", "dataset-1")
    return store, service, created


def initialize(service, created, **kwargs):
    return service.initialize_execution(
        "tenant-a",
        created["record_id"],
        created["revision"],
        instrument_spec=prop.instrument_mapping(),
        cost_model=prop.cost_mapping(),
        spread_price="0.0002",
        timeframe_seconds=60,
        starting_balance="1",
        research_margin=MARGIN,
        **kwargs,
    )


def queue(service, record, operation_id):
    return service.queue_market_order(
        "tenant-a",
        record["record_id"],
        record["revision"],
        operation_id=operation_id,
        side="BUY",
        quantity="0.10",
        stop_loss="1.09",
        take_profit="1.12",
    )


def test_persisted_rejection_revision_conflict_history_and_branch(monkeypatch):
    store, service, created = service_fixture()
    pending = queue(service, initialize(service, created), "first-order")
    before = deepcopy(store.records)
    update = store.update_record
    monkeypatch.setattr(
        store,
        "update_record",
        lambda *_: (_ for _ in ()).throw(RuntimeError("injected write failure")),
    )
    with pytest.raises(RuntimeError, match="injected write failure"):
        service.step("tenant-a", created["record_id"], pending["revision"], 1)
    assert store.records == before
    monkeypatch.setattr(store, "update_record", update)
    rejected = service.step("tenant-a", created["record_id"], pending["revision"], 1)
    assert [event["kind"] for event in rejected["execution_events"]] == [
        "order_rejected",
        "price_mark",
    ]
    snapshot = parse_replay_execution_snapshot(rejected["payload"]["execution"])
    assert snapshot.event_sequence == 2
    with pytest.raises(RuntimeError, match="revision conflict"):
        service.step("tenant-a", created["record_id"], pending["revision"], 1)
    with pytest.raises(ValueError, match="already consumed"):
        queue(service, rejected, "first-order")
    advanced = service.step("tenant-a", created["record_id"], rejected["revision"], 1)
    parent_before = deepcopy(
        store.get_record("tenant-a", "replay", created["record_id"])
    )
    history = service.analytics_record("tenant-a", created["record_id"], cursor_index=1)
    analytics = build_replay_analytics_view(history)
    assert analytics["ledger"] == []
    assert analytics["rejected_order_count"] == 1
    assert analytics["order_rejections"][0]["reason"] == "insufficient_research_margin"
    assert analytics["metrics"]["net_pnl"] == 0
    child = service.branch("tenant-a", created["record_id"], advanced["revision"], 1)
    child_snapshot = parse_replay_execution_snapshot(child["payload"]["execution"])
    assert child_snapshot.research_margin == snapshot.research_margin
    assert child_snapshot.position is child_snapshot.pending_market_order is None
    assert child_snapshot.ledger[0]["kind"] == "order_rejected"
    assert store.get_record("tenant-a", "replay", created["record_id"]) == parent_before


def test_prop_branch_pins_version_and_margin_assumption():
    from trading_workspace_v2.prop_replay import validate_replay_prop_branch_checkpoint

    store, service, created = service_fixture()
    pending = queue(service, initialize(service, created), "first-order")
    rejected = service.step("tenant-a", created["record_id"], pending["revision"], 1)
    service.feed_prop_lifecycle(
        "tenant-a",
        created["record_id"],
        prop_session_id="prop-session",
        prop_attempt_id="attempt-1",
        replay_event_sequence=2,
        expected_prop_revision=1,
        prop_event_sequence=1,
    )
    advanced = service.step("tenant-a", created["record_id"], rejected["revision"], 1)
    child = service.branch("tenant-a", created["record_id"], advanced["revision"], 1)
    child_snapshot = parse_replay_execution_snapshot(child["payload"]["execution"])
    parent_snapshot = parse_replay_execution_snapshot(advanced["payload"]["execution"])
    _, attempt, phase, resume = store.prop

    def validate(candidate):
        validate_replay_prop_branch_checkpoint(
            candidate,
            child_payload=child["payload"],
            parent_snapshot=parent_snapshot,
            historical_attempt=attempt,
            phase=phase,
            resume_state=resume,
        )

    validate(child_snapshot)
    changed_margin = child_snapshot.research_margin.model_copy(
        update={"leverage": Decimal("60")}
    )
    with pytest.raises(ValueError, match="immutable execution pins"):
        validate(child_snapshot.model_copy(update={"research_margin": changed_margin}))
    with pytest.raises(ValueError, match="replay-v1|immutable execution pins"):
        validate(
            child_snapshot.model_copy(update={"schema_version": "replay-execution-v1"})
        )


def test_prop_feeds_only_versioned_marks_in_order_across_rejection_sequence_gaps():
    store, service, created = service_fixture()
    pending = queue(service, initialize(service, created), "first-order")
    first = service.step("tenant-a", created["record_id"], pending["revision"], 1)
    pending_second = queue(service, first, "second-order")
    second = service.step(
        "tenant-a", created["record_id"], pending_second["revision"], 1
    )
    assert [
        event["sequence"]
        for event in second["payload"]["execution"]["ledger"]
        if event["kind"] == "price_mark"
    ] == [2, 4]

    def feed(mark, revision, prop_sequence):
        return service.feed_prop_lifecycle(
            "tenant-a",
            created["record_id"],
            prop_session_id="prop-session",
            prop_attempt_id="attempt-1",
            replay_event_sequence=mark,
            expected_prop_revision=revision,
            prop_event_sequence=prop_sequence,
        )

    with pytest.raises(LookupError, match="price_mark event not found"):
        feed(1, 1, 1)
    with pytest.raises(ValueError, match="in order"):
        feed(4, 1, 1)
    old_attempt = store.prop[1]
    store.prop = (
        store.prop[0],
        old_attempt.model_copy(update={"engine_version": "replay-v1"}),
        store.prop[2],
        store.prop[3],
    )
    with pytest.raises(ValueError, match="engine_version must be replay-v2"):
        feed(2, 1, 1)
    store.prop = (store.prop[0], old_attempt, store.prop[2], store.prop[3])
    first_feed = feed(2, 1, 1)
    second_feed = feed(4, 2, 2)
    assert (
        first_feed["prop_event"]["balance_before_separate_costs"]
        == second_feed["prop_event"]["balance_before_separate_costs"]
        == "1"
    )
    assert first_feed["prop_event"]["evaluation_quality"] == "full_for_declared_model"
    delayed = feed(2, 1, 1)
    assert delayed["duplicate"] is True
    assert delayed["attempt"]["revision"] == first_feed["attempt"]["revision"]


def test_asgi_initialization_forwards_opt_in_and_rejects_invalid_contract_without_writes(
    monkeypatch, tmp_path
):
    from fastapi.testclient import TestClient
    from trading_workspace_v2 import api
    from trading_workspace_v2.auth import LocalWorkspaceAuthorization

    store, service, created = service_fixture()
    monkeypatch.setattr(store, "initialize", lambda: None, raising=False)
    monkeypatch.setattr(api, "PostgresStore", lambda _: store)
    app = api.create_app(
        dsn="synthetic-unused",
        artifact_root=tmp_path,
        learn_roots={},
        authorization=LocalWorkspaceAuthorization.for_local_owner(["tenant-a"]),
    )
    app.state.replay.artifacts = service.artifacts
    request = dict(
        expected_revision=created["revision"],
        instrument_spec=prop.instrument_mapping(),
        cost_model=prop.cost_mapping(),
        spread_price="0.0002",
        timeframe_seconds=60,
        starting_balance="1",
        research_margin=MARGIN,
    )
    before = deepcopy(store.records)
    with TestClient(
        app, base_url="http://127.0.0.1:8039", client=("127.0.0.1", 50000)
    ) as browser:
        url = f"/api/v2/replay/sessions/{created['record_id']}/execution"
        invalid = browser.post(
            url,
            headers={"X-Workspace-Id": "tenant-a"},
            json={**request, "research_margin": {**MARGIN, "leverage": True}},
        )
        assert invalid.status_code == 422
        assert store.records == before
        accepted = browser.post(
            url, headers={"X-Workspace-Id": "tenant-a"}, json=request
        )
        assert accepted.status_code == 200
        assert (
            accepted.json()["payload"]["execution"]["schema_version"]
            == "replay-execution-v2"
        )
        assert accepted.json()["payload"]["execution"]["research_margin"] == MARGIN
