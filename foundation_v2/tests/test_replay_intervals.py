import pytest
from pydantic import ValidationError

from foundation_v2.tests.test_ps02_replay_prop_connection import (
    BASE_TIME, FakeArtifacts, FakeStore, instrument_mapping, cost_mapping,
)
from trading_workspace_v2.contracts import ReplayStep
from trading_workspace_v2.replay import ReplayService
from trading_workspace_v2.replay_interval import next_interval_cursor


def bars(timestamps):
    return [{"timestamp": stamp, "open": 1.102, "high": 1.103, "low": 1.101,
             "close": 1.102, "volume": 1} for stamp in timestamps]


def fixture(rows, cursor=0):
    store = FakeStore(rows)
    service = ReplayService(store, FakeArtifacts(rows))
    record = service.create("tenant-a", "dataset-1", cursor)
    return store, service, record["record_id"]


def test_partial_hour_moves_to_next_boundary_without_adding_sixty_minutes():
    rows = bars([BASE_TIME + n * 60 for n in range(121)])
    assert next_interval_cursor(rows, 7, 120, 3600, 60) == 60
    assert next_interval_cursor(rows, 60, 120, 3600, 60) == 120
    store, service, sid = fixture(rows, 7)
    result = service.step("tenant-a", sid, 1, replay_interval_seconds=3600)
    assert result["view_cursor_index"] == 60
    assert result["payload"]["timing"]["historical_time_replayed_seconds"] == 53 * 60
    assert len(result["visible_rows"]) == 61


def test_weekend_gap_selects_first_available_next_bucket_without_inventing_bars():
    rows = bars([BASE_TIME + 59 * 60, BASE_TIME + 3 * 86400, BASE_TIME + 3 * 86400 + 60])
    _, service, sid = fixture(rows)
    result = service.step("tenant-a", sid, 1, replay_interval_seconds=3600)
    assert result["view_cursor_index"] == 1
    assert result["has_future_rows"] is True
    assert len(result["visible_rows"]) == 2


def test_historical_interval_forward_is_read_only_and_clamps_to_canonical():
    rows = bars([BASE_TIME + n * 60 for n in range(121)])
    store, service, sid = fixture(rows, 75)
    first = service.view("tenant-a", sid, cursor_index=7, advance_interval_seconds=3600)
    assert first["view_cursor_index"] == 60
    assert first["historical_view"] is True
    second = service.view("tenant-a", sid, cursor_index=60, advance_interval_seconds=3600)
    assert second["view_cursor_index"] == 75
    assert second["historical_view"] is False
    assert second["visible_rows"][-1]["timestamp"] == rows[75]["timestamp"]
    assert store.get_record("tenant-a", "replay", sid)["revision"] == 1
    assert len(store.record_revisions[("tenant-a", "replay", sid)]) == 1


@pytest.mark.parametrize("interval", [5, 90, 0, -60, True, "3600", 86401])
def test_invalid_interval_cannot_mutate_or_read_unavailable_resolution(interval):
    rows = bars([BASE_TIME + n * 60 for n in range(70)])
    store, service, sid = fixture(rows)
    with pytest.raises(ValueError):
        service.step("tenant-a", sid, 1, replay_interval_seconds=interval)
    with pytest.raises(ValueError):
        service.view("tenant-a", sid, cursor_index=0, advance_interval_seconds=interval)
    assert store.get_record("tenant-a", "replay", sid)["revision"] == 1


def test_interval_preserves_revision_tenant_and_unknown_timeframe_guards():
    rows = bars([BASE_TIME + n * 60 for n in range(70)])
    store, service, sid = fixture(rows)
    with pytest.raises(LookupError):
        service.step("other", sid, 1, replay_interval_seconds=3600)
    service.step("tenant-a", sid, 1, replay_interval_seconds=3600)
    with pytest.raises(RuntimeError):
        service.step("tenant-a", sid, 1, replay_interval_seconds=3600)
    get_dataset = store.get_dataset
    def missing_timeframe(workspace, dataset):
        manifest = get_dataset(workspace, dataset)
        manifest.timeframe_seconds = None
        return manifest
    store.get_dataset = missing_timeframe
    with pytest.raises(ValueError, match="timeframe is required"):
        service.step("tenant-a", sid, 2, replay_interval_seconds=3600)
    assert store.get_record("tenant-a", "replay", sid)["revision"] == 2


def test_interval_bound_retains_batch_cost_and_rejects_ambiguous_count():
    rows = bars([BASE_TIME + n for n in range(2002)])
    with pytest.raises(ValueError, match="1000-bar"):
        next_interval_cursor(rows, 0, 2001, 3600, 1)
    with pytest.raises(ValidationError):
        ReplayStep(expected_revision=1, steps=60, replay_interval_seconds=3600)
    for interval in [True, "3600", 0, 86401]:
        with pytest.raises(ValidationError):
            ReplayStep(expected_revision=1, replay_interval_seconds=interval)
    assert ReplayStep(expected_revision=1, steps=10).replay_interval_seconds is None


def test_interval_executes_every_underlying_bar_including_intermediate_protective_fill():
    rows = bars([BASE_TIME + n * 60 for n in range(121)])
    rows[9]["high"] = 1.13
    _, service, sid = fixture(rows, 7)
    initialized = service.initialize_execution("tenant-a", sid, 1, instrument_spec=instrument_mapping(),
        cost_model=cost_mapping(), spread_price=".0002", timeframe_seconds=60, starting_balance="100000")
    queued = service.queue_market_order("tenant-a", sid, initialized["revision"], operation_id="interval-open",
        side="BUY", quantity=".1", stop_loss="1.09", take_profit="1.12")
    result = service.step("tenant-a", sid, queued["revision"], replay_interval_seconds=3600)
    events = result["execution_events"]
    assert result["view_cursor_index"] == 60
    assert [event["cursor_index"] for event in events if event["kind"] == "price_mark"] == list(range(8, 61))
    assert [(event["kind"], event["cursor_index"]) for event in events if event["kind"] != "price_mark"] == [
        ("market_fill", 8), ("protective_fill", 9)]
    assert result["payload"]["execution"]["position"] is None


def test_existing_bar_count_behavior_remains_unchanged():
    rows = bars([BASE_TIME + n * 60 for n in range(121)])
    _, service, sid = fixture(rows, 7)
    result = service.step("tenant-a", sid, 1, 60)
    assert result["view_cursor_index"] == 67
