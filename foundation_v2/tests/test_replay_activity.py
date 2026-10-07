from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import sys
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT), str(ROOT / 'foundation_v2')]

from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
from trading_workspace_v2.contracts import ReplayActivityRequest
from trading_workspace_v2.dashboard_read_model import build_dashboard_performance
from trading_workspace_v2.replay import ReplayService
from trading_workspace_v2.replay_activity import dashboard_timing, new_timing, validate_activity
from trading_workspace_v2.store import PostgresStore
from test_ps02_replay_prop_connection import FakeArtifacts, FakeStore


NOW = datetime.now(timezone.utc)


def interval(session_id, start, end):
    return {"session_id": session_id, "started_at_utc": NOW + timedelta(seconds=start),
            "ended_at_utc": NOW + timedelta(seconds=end)}


def body(start=-20, end=-10, event_id=None):
    return {"event_id": str(event_id or uuid4()),
            "started_at_utc": (NOW + timedelta(seconds=start)).isoformat(),
            "ended_at_utc": (NOW + timedelta(seconds=end)).isoformat()}


@pytest.mark.parametrize("start,end", [(0,0),(-31,0),(0,31),(0,6),(-86401,-86400)])
def test_activity_rejects_invalid_interval(start, end):
    with pytest.raises(ValueError):
        validate_activity(ReplayActivityRequest(**body(start,end)), now=NOW)


def test_activity_requires_timezone_uuid_and_forbids_extra_fields():
    for changes in ({"event_id": "arbitrary"}, {"started_at_utc": "2026-10-07T00:00:00"}, {"revision": 1}):
        with pytest.raises(ValueError):
            ReplayActivityRequest(**{**body(), **changes})


def test_union_scope_and_legacy_unknown_are_independent_of_trade_filters():
    fresh = {"record_id": "fresh", "revision": 1, "payload": {"timing": new_timing()}}
    legacy = {"record_id": "old", "revision": 1, "payload": {}}
    assert dashboard_timing([legacy], [])['time_invested_seconds'] is None
    assert dashboard_timing([fresh], [])['time_invested_seconds'] == 0
    items = [interval("fresh",-30,-10), interval("old",-20,0), interval("unselected",-50,0)]
    report = build_dashboard_performance([fresh,legacy], "tenant-a", side="buy",
        from_close_utc="2099-01-01T00:00:00Z", activity_intervals=items)
    assert report['time_invested_seconds'] == 30
    assert report['historical_time_replayed_seconds'] == 0
    assert report['timing_scope']['unknown_historical_session_count'] == 1
    assert report['timing_scope']['legacy_partial_session_count'] == 1
    assert report['timing_scope']['trade_filters_apply'] is False
    selected = build_dashboard_performance([fresh,legacy], "tenant-a", session_id="fresh", activity_intervals=items)
    assert selected['time_invested_seconds'] == 20


def test_step_measures_actual_timestamp_delta_and_branch_does_not_copy_time():
    rows = [{"timestamp": stamp, "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1}
            for stamp in [1000,1060,4660,4720]]
    store = FakeStore(rows)
    service = ReplayService(store, FakeArtifacts(rows))
    created = service.create("tenant-a", "dataset-1", 1)
    sid = created['record_id']
    assert created['payload']['timing']['historical_time_replayed_seconds'] == 0
    stepped = service.step("tenant-a",sid,1,1)
    assert stepped['payload']['timing']['historical_time_replayed_seconds'] == 3600
    # Reload/historical seek only reads; stale steps cannot add time.
    service.view("tenant-a",sid,cursor_index=1)
    with pytest.raises(RuntimeError):
        service.step("tenant-a",sid,1,1)
    assert store.get_record('tenant-a','replay',sid)['payload']['timing']['historical_time_replayed_seconds'] == 3600
    child = service.branch('tenant-a',sid,2,1)
    assert child['payload']['timing']['historical_time_replayed_seconds'] == 0
    service.step('tenant-a',sid,2,100)
    ended = service.step('tenant-a',sid,3,1)
    assert ended['payload']['timing']['historical_time_replayed_seconds'] == 3660


def test_legacy_first_step_starts_measuring_without_backfill():
    rows = [{"timestamp":stamp,"open":1,"high":1,"low":1,"close":1,"volume":1} for stamp in [1000,1060,1120]]
    store = FakeStore(rows)
    record = store.create_record('tenant-a','replay',{'dataset_id':'dataset-1','cursor_index':1})
    result = ReplayService(store,FakeArtifacts(rows)).step('tenant-a',record['record_id'],1)
    assert result['payload']['timing']['historical_time_replayed_seconds'] == 60
    assert result['payload']['timing']['legacy_baseline'] is True
    assert dashboard_timing([result],[])['time_invested_seconds'] is None


@pytest.fixture(scope='module')
def isolated_database():
    dsn = os.getenv('TW_V2_DATABASE_URL')
    if not dsn:
        pytest.skip('PostgreSQL not configured')
    connection = conninfo_to_dict(dsn)
    if connection.get('host') not in {'127.0.0.1','localhost','::1'}:
        pytest.skip('Only loopback PostgreSQL test databases are allowed')
    name = 'tw_activity_qa_' + uuid4().hex
    admin_dsn = make_conninfo(**{**connection,'dbname':'postgres'})
    with psycopg.connect(admin_dsn,autocommit=True) as admin:
        admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
    try:
        yield make_conninfo(**{**connection,'dbname':name})
    finally:
        assert name.startswith('tw_activity_qa_')
        with psycopg.connect(admin_dsn,autocommit=True) as admin:
            admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))


def test_real_postgres_activity_api_idempotency_persistence_tenant_and_delete(isolated_database,tmp_path):
    store = PostgresStore(isolated_database)
    store.initialize()
    created = store.create_record('tenant-a','replay',{'name':'QA','timing':new_timing()})
    sid = created['record_id']
    app = create_app(dsn=isolated_database,artifact_root=tmp_path,
        authorization=LocalWorkspaceAuthorization.for_local_owner(['tenant-a','tenant-b']))
    url = f'/api/v2/replay/sessions/{sid}/activity'
    headers = {'X-Workspace-Id':'tenant-a'}
    payload = body()
    with TestClient(app) as client:
        accepted = client.post(url,headers=headers,json=payload)
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()['accepted_seconds'] == 10
        assert accepted.json()['duplicate'] is False
        assert client.post(url,headers=headers,json=payload).json()['duplicate'] is True
        timezone_alias = {**payload, 'started_at_utc': (NOW-timedelta(seconds=20)).astimezone(
            timezone(timedelta(hours=7))).isoformat()}
        assert client.post(url,headers=headers,json=timezone_alias).json()['duplicate'] is True
        assert client.post(url,headers=headers,json={**payload,'ended_at_utc':NOW.isoformat()}).status_code == 409
        assert client.post(url,headers={'X-Workspace-Id':'tenant-b'},json=body()).status_code == 404
        assert client.post(url,headers=headers,json=body(-31,0)).status_code == 422
        # A second app/store reuses the database; heartbeat never advances revision.
        persisted = PostgresStore(isolated_database)
        assert persisted.get_record('tenant-a','replay',sid)['revision'] == 1
        assert persisted.list_replay_activity('tenant-b') == []
        assert len(persisted.list_replay_activity('tenant-a')) == 1
        with ThreadPoolExecutor(max_workers=4) as pool:
            replies = list(pool.map(lambda _: persisted.record_replay_activity('tenant-a',sid,
                ReplayActivityRequest(**payload).event_id,NOW-timedelta(seconds=20),NOW-timedelta(seconds=10)),range(4)))
        assert all(reply['duplicate'] for reply in replies)
        # Overlap and equal-start retries are unioned, including across sessions.
        for segment in [body(-25,-5),body(-25,-15),body(-15,-3)]:
            assert client.post(url,headers=headers,json=segment).status_code == 200
        other = store.create_record('tenant-a','replay',{'timing':new_timing()})
        assert client.post(f"/api/v2/replay/sessions/{other['record_id']}/activity",headers=headers,json=body(-10,0)).status_code == 200
        rows = persisted.list_replay_activity('tenant-a')
        assert len(rows) == 2
        timing = dashboard_timing(store.list_records('tenant-a','replay'),rows)
        assert timing['time_invested_seconds'] == 25
        overview = client.get('/api/v2/overview',headers=headers)
        assert overview.status_code == 200, overview.text
        assert overview.json()['performance']['time_invested_seconds'] == 25
        ledger = client.get('/api/v2/replay/trades?side=sell&from_close_utc=2099-01-01T00:00:00Z',headers=headers)
        assert ledger.status_code == 200, ledger.text
        assert ledger.json()['time_invested_seconds'] == 25
        deleted = client.post(f'/api/v2/replay/sessions/{sid}/delete',headers=headers,
            json={'expected_revision':1,'confirmation_name':'QA'})
        assert deleted.status_code == 200, deleted.text
        assert client.post(url,headers=headers,json=body()).status_code == 404
