from copy import deepcopy
from pathlib import Path
from unittest.mock import patch
import sys

import pytest
from pydantic import ValidationError

V2 = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(V2), str(V2.parent)]

from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.contracts import ReplayCreate
from trading_workspace_v2.replay import ReplayService
from foundation_v2.tests.test_replay_portfolio import PortfolioStore, BASE_TIME, initialize, queue


def fixture(tmp_path):
    store, artifacts = PortfolioStore(), ArtifactStore(tmp_path)
    for key, manifest in store.manifests.items():
        manifest.artifact_path, manifest.artifact_sha256 = artifacts.write_dataset_iter('tenant-a', key, store.bars[key], batch_size=2)
    return store, artifacts, ReplayService(store, artifacts)


@pytest.mark.parametrize('changes', [{'start_timestamp': True}, {'end_timestamp': '123'}, {'start_timestamp': 1.2},
    {'start_timestamp': -1}, {'end_timestamp': False}, {'start_timestamp': 10, 'end_timestamp': 10},
    {'start_timestamp': 20, 'end_timestamp': 10}, {'start_timestamp': 10, 'start_index': 2}])
def test_period_contract_is_strict_and_unambiguous(changes):
    with pytest.raises(ValidationError):
        ReplayCreate(dataset_id='a', **changes)
    assert ReplayCreate(dataset_id='a', start_timestamp=0).start_timestamp == 0


def test_single_period_snaps_start_forward_end_backward_keeps_context_and_bounds_step(tmp_path):
    store, artifacts, service = fixture(tmp_path)
    with patch.object(artifacts, 'read_dataset', side_effect=AssertionError('full history forbidden')):
        record = service.create('tenant-a', 'a', start_timestamp=BASE_TIME + 61, end_timestamp=BASE_TIME + 299)
        assert record['view_cursor_index'] == 2
        assert record['visible_rows'] == store.bars['a'][:3]
        period = record['session_period']
        assert period['start_timestamp'] == BASE_TIME + 120
        assert period['end_timestamp'] == BASE_TIME + 240
        assert period['requested_start_timestamp'] == BASE_TIME + 61
        assert period['end_cursor_index'] == 4
        result = service.step('tenant-a', record['record_id'], record['revision'], 1000)
        assert result['view_cursor_index'] == 4 and result['payload']['status'] == 'completed'
        assert result['cutoff_timestamp'] == BASE_TIME + 240 and not result['has_future_rows']
        assert service.view('tenant-a', record['record_id']) == {key: value for key, value in result.items() if key != 'execution_events'}
        with pytest.raises(ValueError, match='completed'):
            service.step('tenant-a', record['record_id'], result['revision'])
        historical = service.view('tenant-a', record['record_id'], cursor_index=0)
        assert historical['visible_rows'] == store.bars['a'][:1]
        with pytest.raises(ValueError, match='before the selected'):
            service.branch('tenant-a', record['record_id'], result['revision'], 1)
        child = service.branch('tenant-a', record['record_id'], result['revision'], 3)
        assert child['payload']['session_period'] == result['payload']['session_period']
        assert child['has_future_rows']
        done = service.step('tenant-a', child['record_id'], child['revision'], replay_interval_seconds=300)
        assert done['view_cursor_index'] == 4 and not done['has_future_rows']


@pytest.mark.parametrize('changes', [dict(start_timestamp=BASE_TIME + 10000), dict(end_timestamp=BASE_TIME - 1),
    dict(start_timestamp=BASE_TIME + 61, end_timestamp=BASE_TIME + 121), dict(start_timestamp=BASE_TIME + 360)])
def test_invalid_single_period_does_not_persist(tmp_path, changes):
    store, _, service = fixture(tmp_path)
    before = deepcopy(store.records)
    with pytest.raises(ValueError):
        service.create('tenant-a', 'a', **changes)
    assert store.records == before


def test_start_auto_end_and_end_only_index_preserve_reload_and_future(tmp_path):
    store, artifacts, service = fixture(tmp_path)
    with patch.object(artifacts, 'read_dataset', side_effect=AssertionError('full history forbidden')):
        auto = service.create('tenant-a', 'a', start_timestamp=BASE_TIME + 120)
        assert auto['session_period']['requested_end_timestamp'] is None
        assert auto['session_period']['end_cursor_index'] == 6
        indexed = service.create('tenant-a', 'a', start_index=1, end_timestamp=BASE_TIME + 180)
        assert indexed['session_period']['start_cursor_index'] == 1
        assert indexed['session_period']['end_cursor_index'] == 3
        assert service.view('tenant-a', auto['record_id'])['session_period'] == auto['session_period']


def test_multi_period_common_native_range_asset_switch_and_no_future_execution(tmp_path):
    store, artifacts, service = fixture(tmp_path)
    with patch.object(artifacts, 'read_dataset', side_effect=AssertionError('full history forbidden')):
        record = service.create('tenant-a', 'a', dataset_ids=['a', 'b'], start_timestamp=BASE_TIME + 120,
            end_timestamp=BASE_TIME + 240, starting_balance='10000')
        assert record['session_period']['start_timestamp'] == BASE_TIME + 120
        assert record['payload']['replay_clock_utc'] == BASE_TIME + 180
        assert record['payload']['replay_end_utc'] == BASE_TIME + 300
        assert record['payload']['session_period']['asset_bounds']['b']['end_cursor_index'] == 2
        record = initialize(service, record)
        record = queue(service, record, 'a')
        result = service.step('tenant-a', record['record_id'], record['revision'], 1000)
        assert result['payload']['cursor_index'] == 4 and not result['has_future_rows']
        assert result['payload']['status'] == 'completed'
        assert max(event['cursor_index'] for event in result['payload']['execution']['ledger']) <= 4
        assert result['payload']['asset_states']['b']['cursor_index'] == 2
        switched = service.select_asset('tenant-a', result['record_id'], result['revision'], 'b')
        assert switched['session_period']['end_cursor_index'] == 2
        assert switched['cutoff_timestamp'] == BASE_TIME + 240 and not switched['has_future_rows']
        with pytest.raises(ValueError, match='completed'):
            service.step('tenant-a', switched['record_id'], switched['revision'])
        switched = service.select_asset('tenant-a', switched['record_id'], switched['revision'], 'a')
        with pytest.raises(ValueError, match='future replay bar'):
            service.queue_market_order('tenant-a', result['record_id'], switched['revision'], operation_id='future',
                side='BUY', quantity='.1', stop_loss='1.0', take_profit='1.3')
        with pytest.raises(ValueError, match='before the selected'):
            service.branch('tenant-a', switched['record_id'], switched['revision'], 0)


def test_multi_period_without_shared_future_does_not_persist(tmp_path):
    store, _, service = fixture(tmp_path)
    before = deepcopy(store.records)
    with pytest.raises(ValueError, match='future|after'):
        service.create('tenant-a', 'a', dataset_ids=['a', 'b'], start_timestamp=BASE_TIME + 120,
            end_timestamp=BASE_TIME + 120)
    assert store.records == before


def test_period_bounds_fail_closed_when_corrupt(tmp_path):
    store, _, service = fixture(tmp_path)
    record = service.create('tenant-a', 'a', start_timestamp=BASE_TIME, end_timestamp=BASE_TIME + 180)
    stored = store.records[('tenant-a', 'replay', record['record_id'])]
    stored['payload']['session_period']['asset_bounds']['a']['end_cursor_index'] = True
    with pytest.raises(RuntimeError, match='period is invalid'):
        service.view('tenant-a', record['record_id'])


def test_weekend_start_and_end_snap_without_inventing_future_bars(tmp_path):
    store = PortfolioStore()
    start = BASE_TIME
    timestamps = [start, start + 60, start + 3 * 86400, start + 3 * 86400 + 60]
    store.bars['a'] = [{**store.bars['a'][0], 'timestamp': timestamp} for timestamp in timestamps]
    store.manifests['a'].row_count = len(timestamps)
    artifacts = ArtifactStore(tmp_path)
    manifest = store.manifests['a']
    manifest.artifact_path, manifest.artifact_sha256 = artifacts.write_dataset('tenant-a', 'a', store.bars['a'])
    service = ReplayService(store, artifacts)
    record = service.create('tenant-a', 'a', start_timestamp=start + 86400)
    assert record['cutoff_timestamp'] == timestamps[2]
    assert record['session_period']['requested_start_timestamp'] == start + 86400
    with pytest.raises(ValueError, match='future bars'):
        service.create('tenant-a', 'a', start_timestamp=start + 86400, end_timestamp=start + 2 * 86400)


@pytest.mark.parametrize('interval', [None, 900])
def test_mixed_timeframes_use_closed_bar_clock_and_never_execute_past_native_end(tmp_path, interval):
    store = PortfolioStore()
    store.bars['a'] = [{**store.bars['a'][0], 'timestamp': BASE_TIME + n * 60} for n in range(20)]
    store.bars['b'] = [{**store.bars['b'][0], 'timestamp': BASE_TIME + n * 300} for n in range(5)]
    store.manifests['a'].row_count = 20
    store.manifests['b'].row_count = 5
    store.manifests['b'].timeframe_seconds = 300
    artifacts = ArtifactStore(tmp_path)
    for key, manifest in store.manifests.items():
        manifest.artifact_path, manifest.artifact_sha256 = artifacts.write_dataset_iter('tenant-a', key, store.bars[key], batch_size=2)
    service = ReplayService(store, artifacts)
    with patch.object(artifacts, 'read_dataset', side_effect=AssertionError('full history forbidden')):
        record = service.create('tenant-a', 'a', dataset_ids=['a', 'b'], start_timestamp=BASE_TIME + 60,
            end_timestamp=BASE_TIME + 780)
        assert record['payload']['replay_clock_utc'] == BASE_TIME + 300
        assert record['payload']['replay_end_utc'] == BASE_TIME + 840
        assert record['payload']['asset_states']['a']['cursor_index'] == 4
        assert record['payload']['asset_states']['b']['cursor_index'] == 0
        record = service.select_asset('tenant-a', record['record_id'], record['revision'], 'b')
        first = service.step('tenant-a', record['record_id'], record['revision'], replay_interval_seconds=interval)
        if interval is None:
            assert first['payload']['replay_clock_utc'] == BASE_TIME + 600
            assert first['has_future_rows']
            final = service.step('tenant-a', first['record_id'], first['revision'])
        else:
            final = first
        assert final['payload']['replay_clock_utc'] == BASE_TIME + 840
        assert final['payload']['asset_states']['b']['cursor_index'] == 1
        assert final['payload']['asset_states']['a']['cursor_index'] == 13
        assert not final['has_future_rows'] and final['payload']['status'] == 'completed'
        assert final['cutoff_timestamp'] + 300 <= final['payload']['replay_end_utc']


@pytest.mark.parametrize('multiple', [False, True])
def test_requested_period_outside_common_range_rejects_without_silent_clamp(tmp_path, multiple):
    store, _, service = fixture(tmp_path)
    first = BASE_TIME + 120 if multiple else BASE_TIME
    last = BASE_TIME + 360
    for changes in [dict(start_timestamp=first - 1), dict(start_timestamp=last + 1),
                    dict(start_timestamp=first, end_timestamp=last + 1), dict(end_timestamp=first - 1)]:
        before = deepcopy(store.records)
        with pytest.raises(ValueError, match='outside.*range'):
            service.create('tenant-a', 'a', dataset_ids=['a', 'b'] if multiple else None, **changes)
        assert store.records == before


def test_terminal_closed_bar_processes_inactive_protection_and_branch_keeps_period(tmp_path):
    store = PortfolioStore()
    store.bars['a'][4]['high'] = 1.12
    store.bars['b'][2]['high'] = 1.22
    artifacts = ArtifactStore(tmp_path)
    for key, manifest in store.manifests.items():
        manifest.artifact_path, manifest.artifact_sha256 = artifacts.write_dataset_iter('tenant-a', key, store.bars[key], batch_size=2)
    service = ReplayService(store, artifacts)
    with patch.object(artifacts, 'read_dataset', side_effect=AssertionError('full history forbidden')):
        record = service.create('tenant-a', 'a', dataset_ids=['a', 'b'], start_timestamp=BASE_TIME + 120,
            end_timestamp=BASE_TIME + 240, starting_balance='10000')
        record = queue(service, initialize(service, record), 'a')
        record = service.select_asset('tenant-a', record['record_id'], record['revision'], 'b')
        record = queue(service, initialize(service, record), 'b')
        final = service.step('tenant-a', record['record_id'], record['revision'], 1000)
        for key, expected_last in [('a', 4), ('b', 2)]:
            execution = final['payload']['asset_states'][key]['execution']
            assert execution['cursor_index'] == expected_last
            fills = [event for event in execution['ledger'] if event['kind'] == 'protective_fill']
            assert len(fills) == 1 and fills[0]['cursor_index'] == expected_last
        child = service.branch('tenant-a', final['record_id'], final['revision'], final['view_cursor_index'])
        assert child['payload']['session_period'] == final['payload']['session_period']
        assert child['payload']['status'] == 'completed' and not child['has_future_rows']


def test_period_no_fields_preserves_legacy_payload_and_last_index_creation(tmp_path):
    _, artifacts, service = fixture(tmp_path)
    with patch.object(artifacts, 'read_dataset', side_effect=AssertionError('full history forbidden')):
        record = service.create('tenant-a', 'a', start_index=6)
        assert 'session_period' not in record['payload'] and 'session_period' not in record
        assert record['payload']['status'] == 'paused' and not record['has_future_rows']


def test_api_create_forwards_period_and_invalid_inputs_do_not_write(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from trading_workspace_v2 import api
    from trading_workspace_v2.auth import LocalWorkspaceAuthorization
    store, artifacts, _ = fixture(tmp_path)
    monkeypatch.setattr(store, 'initialize', lambda: None, raising=False)
    monkeypatch.setattr(api, 'PostgresStore', lambda _: store)
    app = api.create_app(dsn='synthetic-unused', artifact_root=tmp_path, learn_roots={},
        authorization=LocalWorkspaceAuthorization.for_local_owner(['tenant-a']))
    headers = {'X-Workspace-Id': 'tenant-a'}
    with TestClient(app, base_url='http://127.0.0.1:8039', client=('127.0.0.1', 50000)) as client:
        result = client.post('/api/v2/replay/sessions', headers=headers, json={
            'dataset_id': 'a', 'start_timestamp': BASE_TIME + 60, 'end_timestamp': BASE_TIME + 180})
        assert result.status_code == 201
        assert result.json()['session_period']['requested_start_timestamp'] == BASE_TIME + 60
        assert result.json()['session_period']['end_cursor_index'] == 3
        before = deepcopy(store.records)
        for period in [{'start_timestamp': True}, {'start_timestamp': BASE_TIME + 60, 'end_timestamp': BASE_TIME + 60},
                       {'start_timestamp': BASE_TIME + 10000}, {'start_timestamp': BASE_TIME + 360}]:
            invalid = client.post('/api/v2/replay/sessions', headers=headers, json={'dataset_id': 'a', **period})
            assert invalid.status_code == 422
        assert store.records == before
