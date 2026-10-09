from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path
import sys

import pyarrow.parquet as pq
import pytest

V2 = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(V2), str(V2.parent)]

from trading_workspace_v2.artifacts import ArtifactConflict, ArtifactStore
from trading_workspace_v2.replay import ReplayService
from trading_workspace_v2.replay_chart_history import chart_bucket


def rows(count):
    return [dict(timestamp=1704067200 + n * 60, open=float(n), high=float(n + 2),
                 low=float(n - 1), close=float(n + 1), volume=float(n % 7)) for n in range(count)]


class Store:
    def __init__(self, manifest, cursor):
        self.manifest = manifest
        self.record = {'record_id': 'session', 'revision': 3, 'payload': {'dataset_id': 'dataset', 'cursor_index': cursor}}

    def get_record(self, workspace, kind, key):
        return deepcopy(self.record) if workspace == 'w' and kind == 'replay' and key == 'session' else None

    def get_dataset(self, workspace, key):
        return self.manifest if workspace == 'w' and key == 'dataset' else None


def fixture(tmp_path, count=20000, cursor=17000):
    artifacts = ArtifactStore(tmp_path)
    native = rows(count)
    path, digest = artifacts.write_dataset_iter('w', 'dataset', native, batch_size=1000)
    manifest = SimpleNamespace(artifact_path=path, artifact_sha256=digest, row_count=count, timeframe_seconds=60)
    store = Store(manifest, cursor)
    return ReplayService(store, artifacts), native, manifest


def oracle(native, cursor, period, to, count):
    buckets = {}
    for row in native[:cursor + 1]:
        time = chart_bucket(row['timestamp'], period)
        if to is not None and time >= to * 1000:
            continue
        if time not in buckets:
            buckets[time] = {'time': time, **{key: row[key] for key in ('open', 'high', 'low', 'close', 'volume')}}
        else:
            bar = buckets[time]
            bar.update(high=max(bar['high'], row['high']), low=min(bar['low'], row['low']), close=row['close'], volume=bar['volume'] + row['volume'])
    return list(buckets.values())[-count:]


@pytest.mark.parametrize('resolution,period', [('1', 60), ('5', 300), ('1D', '1D'), ('1W', '1W'), ('1M', '1M')])
def test_window_matches_full_history_aggregation_without_future(tmp_path, resolution, period):
    service, native, manifest = fixture(tmp_path)
    for cursor, to in [(17000, None), (10000, native[8000]['timestamp'] + 20), (0, None)]:
        result = service.chart_window('w', 'session', dataset_id='dataset', dataset_sha256=manifest.artifact_sha256,
            cursor_index=cursor, resolution=resolution, to_utc=to, count_back=30)
        assert result['bars'] == oracle(native, cursor, period, to, 30)
        assert result['cutoff_timestamp'] == native[cursor]['timestamp']
        assert all(bar['time'] <= native[cursor]['timestamp'] * 1000 for bar in result['bars'])
        assert result['workspace_id'] == 'w' and result['revision'] == 3


def test_window_backfills_before_initial_bounded_view_and_preserves_volume(tmp_path):
    service, native, manifest = fixture(tmp_path)
    with patch.object(service.artifacts, 'read_dataset', side_effect=AssertionError('full decode forbidden')):
        view = service.view('w', 'session')
        assert view['visible_rows'] == native[15001:17001]
        assert view['visible_row_start'] == 15001 and view['total_row_count'] == len(native)
        result = service.chart_window('w', 'session', dataset_id='dataset', dataset_sha256=manifest.artifact_sha256,
            to_utc=native[100]['timestamp'], count_back=10)
        assert result['bars'] == oracle(native, 17000, 60, native[100]['timestamp'], 10)
        assert result['has_more']


def test_window_prunes_decode_and_does_not_cache_integrity(tmp_path):
    service, _, manifest = fixture(tmp_path)
    original = pq.ParquetFile.read_row_group
    decoded = []
    def observe(parquet, index, *args, **kwargs):
        decoded.append(index)
        return original(parquet, index, *args, **kwargs)
    with patch.object(pq.ParquetFile, 'read_row_group', observe):
        service.chart_window('w', 'session', dataset_id='dataset', dataset_sha256=manifest.artifact_sha256, count_back=20)
    assert decoded == [17, 16]
    decoded.clear()
    with patch.object(pq.ParquetFile, 'read_row_group', observe):
        service.chart_window('w', 'session', dataset_id='dataset', dataset_sha256=manifest.artifact_sha256,
            to_utc=1704067200 + 200 * 60, count_back=20)
    assert decoded == [17, 0], 'Backfill should skip decoding newer row groups using timestamp statistics'
    path = service.artifacts.root / manifest.artifact_path
    data = bytearray(path.read_bytes()); data[20] ^= 1; path.write_bytes(data)
    with pytest.raises(ArtifactConflict, match='checksum'):
        service.chart_window('w', 'session', dataset_id='dataset', dataset_sha256=manifest.artifact_sha256, count_back=20)


@pytest.mark.parametrize('changes', [dict(dataset_id='other'), dict(dataset_sha256='bad'), dict(cursor_index=17001),
    dict(cursor_index=-1), dict(cursor_index=True), dict(count_back=2001), dict(resolution='2S'), dict(resolution='7D'),
    dict(from_utc=100, to_utc=99)])
def test_chart_window_rejects_scope_future_and_unbounded_requests(tmp_path, changes):
    service, _, manifest = fixture(tmp_path, count=18000)
    params = dict(dataset_id='dataset', dataset_sha256=manifest.artifact_sha256)
    params.update(changes)
    with pytest.raises(ValueError):
        service.chart_window('w', 'session', **params)
    with pytest.raises(LookupError):
        service.chart_window('another-workspace', 'session', **params)


def test_unknown_volume_and_row_group_boundary_aggregate(tmp_path):
    artifacts = ArtifactStore(tmp_path)
    native = rows(10)
    native[2]['volume'] = None
    path, digest = artifacts.write_dataset_iter('w', 'dataset', native, batch_size=2)
    result = artifacts.read_dataset_chart_window(path, digest, cursor_index=8, period=300, to_utc=None, count_back=1)
    assert result['bars'][0]['open'] == native[5]['open']
    assert result['bars'][0]['close'] == native[8]['close']
    assert result['bars'][0]['volume'] == sum(row['volume'] for row in native[5:9])
    earlier = artifacts.read_dataset_chart_window(path, digest, cursor_index=4, period=300, to_utc=None, count_back=1)
    assert 'volume' not in earlier['bars'][0]


def test_date_navigation_resolves_old_native_cursor_without_full_decode_or_future(tmp_path):
    service, native, manifest = fixture(tmp_path)
    with patch.object(service.artifacts, 'read_dataset', side_effect=AssertionError('full decode forbidden')):
        old = service.view('w', 'session', cutoff_timestamp=native[13]['timestamp'] + 1)
        assert old['view_cursor_index'] == 14
        assert old['cutoff_timestamp'] == native[14]['timestamp']
        assert old['visible_rows'] == native[:15]
        start = service.view('w', 'session', cutoff_timestamp=native[0]['timestamp'] - 1)
        assert start['view_cursor_index'] == 0
        with pytest.raises(ValueError, match='cannot exceed'):
            service.view('w', 'session', cutoff_timestamp=native[17001]['timestamp'])
        with pytest.raises(ValueError, match='choose a UTC cutoff'):
            service.view('w', 'session', 100, cutoff_timestamp=native[100]['timestamp'])
    assert service.store.record['payload']['cursor_index'] == 17000


def test_portfolio_chart_window_requires_active_asset_and_shared_closed_bar_clock():
    from foundation_v2.tests.test_replay_portfolio import PortfolioStore
    store = PortfolioStore()
    service = ReplayService(store, store)
    record = service.create('tenant-a', 'a', dataset_ids=['a', 'b'], starting_balance='10000')
    for key in ('a', 'b'):
        if key == 'b':
            record = service.select_asset('tenant-a', record['record_id'], record['revision'], 'b')
        window = service.chart_window('tenant-a', record['record_id'], dataset_id=key,
            dataset_sha256=store.manifests[key].artifact_sha256)
        assert window['bars'][-1]['time'] // 1000 + 60 <= record['payload']['replay_clock_utc']
        assert window['cutoff_timestamp'] == record['cutoff_timestamp']
        other = 'b' if key == 'a' else 'a'
        with pytest.raises(ValueError, match='active replay asset'):
            service.chart_window('tenant-a', record['record_id'], dataset_id=other,
                dataset_sha256=store.manifests[other].artifact_sha256)
