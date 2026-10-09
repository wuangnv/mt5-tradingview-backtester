"""Revision, lineage, page reuse and bounded-memory projection contracts."""
import copy
from concurrent.futures import ThreadPoolExecutor
import sys
from pathlib import Path
import pytest

V2 = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(V2), str(V2 / 'tests'), str(V2.parent)]
from test_replay_analytics import closed_trade_record, two_trade_record, record
from test_dashboard_read_model import fork
from trading_workspace_v2.dashboard_read_model import build_dashboard_performance
from trading_workspace_v2.trades_page import build_trades_page
from trading_workspace_v2.replay_read_projection import ReplayReadProjectionService, BoundedProjectionCache
from trading_workspace_v2.replay import ReplayService


class MemoryStore:
    def __init__(self, records=None):
        self.records = records or [two_trade_record()]
        self.journals = [{'record_id': 'journal-a', 'revision': 1, 'payload': {'source': {
            'replay_session_id': self.records[0]['record_id'], 'trade_id': 'unknown'}, 'tags': ['planned']}},
            {'record_id': 'foreign', 'revision': 1, 'payload': {'source': {'session_id': 'elsewhere'}, 'tags': ['foreign']}}]
        self.activity = []
        self.reads = []
        self.history = {}

    def list_record_heads(self, workspace, kind):
        if workspace != 'tenant-a':
            return []
        records = self.records if kind == 'replay' else self.journals
        self.history.update({(kind, item['record_id'], item['revision']): copy.deepcopy(item) for item in records})
        return [{'record_id': item['record_id'], 'revision': item['revision'],
                 'payload': {'timing': item['payload'].get('timing')} if kind == 'replay' else {}} for item in records]

    def records_at_heads(self, workspace, kind, heads, *, session_ids=None, trade_ids=None, metadata_only=False):
        if not metadata_only:
            self.reads.append((workspace, kind, session_ids))
        result = [copy.deepcopy(self.history[kind, h['record_id'], h['revision']]) for h in heads]
        if session_ids is not None:
            result = [item for item in result if any(item['payload'].get('source', {}).get(k) in session_ids for k in ('session_id', 'replay_session_id'))]
        return result

    def list_replay_activity(self, workspace):
        return self.activity


def test_exact_oracle_parity_dedup_partial_filters_facets_and_new_pages():
    parent = closed_trade_record()
    child = fork(parent, 'child')
    bad = record(); bad['record_id'] = 'unknown'
    store = MemoryStore([parent, child, bad])
    service = ReplayReadProjectionService(store)
    full = build_dashboard_performance(store.records, 'tenant-a', include_ledger=True)
    cached_full = service.trades('tenant-a')
    assert {k: v for k, v in cached_full.items() if k != 'as_of_utc'} == {k: v for k, v in full.items() if k != 'as_of_utc'}
    for extra in ('{}', '{"reportKinds":[]}', '{"outcomes":["win"]}', '{"tagExclude":["planned"]}'):
        for direction in ('asc', 'desc'):
            for selected_page in (1, 2, 999):
                options = dict(page=selected_page, page_size=1, sort_key='net_pnl', sort_direction=direction, extra_filters=extra)
                assert service.trades('tenant-a', **options) == build_trades_page(full, store.journals, **options)
    assert sum(kind == 'replay' for _, kind, _ in store.reads) == 1
    # Each independent filter/sort materializes once, not once per page.
    assert sum(kind == 'journal' for _, kind, _ in store.reads) == 8


def test_page_responses_cannot_mutate_retained_projection_and_revision_invalidates():
    store = MemoryStore(); service = ReplayReadProjectionService(store)
    first = service.trades('tenant-a', page=1, page_size=1)
    untouched = copy.deepcopy(first)
    first['ledger'][0]['net_pnl'] = -999
    first['facets']['assets'].append('INVALID')
    assert service.trades('tenant-a', page=1, page_size=1) == untouched
    second = service.trades('tenant-a', page=2, page_size=1)
    assert second['ledger'][0]['trade_id'] != untouched['ledger'][0]['trade_id']
    assert len(store.reads) == 2
    store.journals[1]['revision'] += 1
    assert service.trades('tenant-a', page=1, page_size=1)['snapshot_key'] != untouched['snapshot_key']
    store.records[0]['revision'] += 1
    assert service.trades('tenant-a', page=1, page_size=1)['sources'][0]['revision'] == store.records[0]['revision']


def test_workspace_scope_missing_deleted_and_empty_selection():
    store = MemoryStore(); service = ReplayReadProjectionService(store)
    assert service.trades('tenant-a', page=1)['pagination']['filtered_count'] == 2
    assert service.trades('tenant-b', page=1)['pagination']['filtered_count'] == 0
    assert service.trades('tenant-a', session_ids=[], page=1)['pagination']['filtered_count'] == 0
    with pytest.raises(LookupError):
        service.trades('tenant-b', session_ids=['replay-fixture'], page=1)
    store.records = []
    assert service.trades('tenant-a', page=1)['pagination']['filtered_count'] == 0


def test_activity_reconciles_without_recomputing_financial_projection():
    from datetime import datetime, timezone, timedelta
    store = MemoryStore(); service = ReplayReadProjectionService(store)
    first = service.trades('tenant-a')
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    store.activity = [{'session_id': store.records[0]['record_id'], 'started_at_utc': start, 'ended_at_utc': start + timedelta(seconds=20)}]
    second = service.trades('tenant-a')
    assert first['time_invested_seconds'] is None and second['time_invested_seconds'] == 20
    assert len(store.reads) == 1


def test_revision_fence_survives_head_advancing_before_payload_read():
    store = MemoryStore(); service = ReplayReadProjectionService(store)
    read = store.records_at_heads
    def racing(*args, **kwargs):
        if args[1] == 'replay':
            store.records[0]['revision'] += 1
            store.records[0]['payload']['name'] = 'New name'
        return read(*args, **kwargs)
    store.records_at_heads = racing
    original = store.records[0]['revision']
    first = service.trades('tenant-a', page=1)
    assert first['sources'][0]['revision'] == original
    second = service.trades('tenant-a', page=1)
    assert second['sources'][0]['revision'] == original + 1


def test_analytics_history_key_and_summary_preserve_financial_oracle():
    from test_replay_analytics import AnalyticsStore
    from trading_workspace_v2.replay_analytics import build_replay_analytics_view
    service = ReplayReadProjectionService(MemoryStore())
    replay = ReplayService(AnalyticsStore(), None)
    earlier = replay.analytics_record('tenant-a', 'replay-fixture', 1)
    latest = replay.analytics_record('tenant-a', 'replay-fixture')
    for item in (earlier, latest):
        item['workspace_id'] = 'tenant-a'
        full = build_replay_analytics_view(item)
        assert service.analytics(item) == full
        assert service.analytics(item, include_ledger=False) == {k: v for k, v in full.items() if k != 'ledger'}
    assert service.analytics(earlier)['metrics']['net_pnl'] == 17
    assert service.analytics(latest)['metrics']['net_pnl'] == 53


def test_cache_limits_oversize_bypass_eviction_and_single_flight():
    cache = BoundedProjectionCache(max_bytes=10000, max_entries=2)
    calls = []
    def build():
        calls.append(1); return {'rows': [1, 2, 3]}
    with ThreadPoolExecutor(max_workers=8) as workers:
        assert len(list(workers.map(lambda _: cache.get_or_build('same', build), range(32)))) == 32
    assert len(calls) == 1
    for key in ('a', 'b', 'c'):
        cache.get_or_build(key, build)
    assert cache.statistics()['entries'] == 2
    assert cache.statistics()['retained_bytes'] <= 10000
    cache.get_or_build('oversized', lambda: {'rows': ['x' * 10001]})
    assert cache.statistics()['entries'] == 2
    no_cache = ReplayReadProjectionService(MemoryStore(), max_bytes=0)
    assert no_cache.trades('tenant-a', page=1)['pagination']['filtered_count'] == 2
    assert no_cache.cache.statistics()['retained_bytes'] == 0


def test_oversized_full_projection_retains_only_compact_page_and_revisions_invalidate(monkeypatch):
    import trading_workspace_v2.replay_read_projection as module
    store = MemoryStore()
    service = ReplayReadProjectionService(store, max_bytes=50_000)
    oracle = build_dashboard_performance(store.records, 'tenant-a', include_ledger=True)
    original = copy.deepcopy(oracle['ledger'][0])
    oracle['ledger'] = [{**original, 'trade_id': f't-{i}'} for i in range(20_001)]
    monkeypatch.setattr(module, 'build_dashboard_performance', lambda *args, **kwargs: oracle)
    first = service.trades('tenant-a', page=1, page_size=1)
    reads = len(store.reads)
    assert service.trades('tenant-a', page=1, page_size=1) == first
    assert len(store.reads) == reads
    assert service.cache.statistics()['entries'] == 1
    assert service.cache.statistics()['retained_bytes'] < 50_000
    store.journals[0]['revision'] += 1
    assert service.trades('tenant-a', page=1, page_size=1)['snapshot_key'] != first['snapshot_key']
