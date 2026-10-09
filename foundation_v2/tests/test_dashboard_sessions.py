from copy import deepcopy
from types import SimpleNamespace

import pytest

from test_replay_analytics import closed_trade_record, record
from trading_workspace_v2.dashboard_sessions import (
    DashboardRevisionConflict, DashboardSummaryCache, build_dashboard_sessions,
    build_session_summary, read_dashboard_sessions, read_replay_metadata,
)
from trading_workspace_v2.replay_analytics import build_replay_analytics_view


def manifest():
    return SimpleNamespace(dataset_id='dataset-fixture', instrument_id='EURUSD', timeframe='60s',
                           timeframe_seconds=60, row_count=10000, first_timestamp=1700000000,
                           last_timestamp=1701000000, artifact_sha256='d' * 64)


def fixture(source=None, *, key='replay-fixture', created='2026-10-01T00:00:00Z', strategy=None):
    source = deepcopy(source or record())
    source['record_id'] = key
    source['created_at_utc'] = source['updated_at_utc'] = created
    source['payload'].update(name=key, playbook_id=strategy, status='paused')
    return source


def test_default_page_only_computes_six_summaries_and_filter_facets_need_no_financial_reads(monkeypatch):
    import trading_workspace_v2.dashboard_sessions as module
    original = module.build_session_summary
    calls = []
    def measured(record, workspace):
        calls.append(record['record_id'])
        return original(record, workspace)
    monkeypatch.setattr(module, 'build_session_summary', measured)
    records = [fixture(key=f's{i:04}', strategy='swing' if i % 2 else None) for i in range(1000)]
    cache = DashboardSummaryCache()
    first = build_dashboard_sessions(records, [manifest()], 'tenant-a', cache=cache)
    assert len(first['items']) == len(calls) == 6
    assert first['total'] == first['matching_count'] == 1000
    assert first['facets'] == {'assets': ['EURUSD'], 'strategies': ['swing'], 'unassigned': True}
    # Opening the filter reads facets from the same contract; no detail endpoint.
    again = build_dashboard_sessions(records, [manifest()], 'tenant-a', cache=cache, revision=first['revision'])
    assert first['revision'] == again['revision']
    assert len(calls) == 6
    second = build_dashboard_sessions(records, [manifest()], 'tenant-a', page=2, cache=cache, revision=first['revision'])
    assert len(calls) == 12
    assert not ({i['record_id'] for i in first['items']} & {i['record_id'] for i in second['items']})


def test_financial_metrics_equal_canonical_oracle_and_payload_contains_no_events_or_bars():
    source = fixture(closed_trade_record())
    canonical = build_replay_analytics_view(source)
    result = build_session_summary(source, 'tenant-a')
    assert result['status'] == 'ready'
    assert result['pnl'] == canonical['metrics']['net_pnl']
    assert result['metrics']['starting_balance'] == canonical['metrics']['starting_balance']
    assert result['curve']['points'] == canonical['metrics']['closed_trade_balance_curve']
    assert result['provenance']['workspace_id'] == 'tenant-a'
    assert result['provenance']['revision'] == source['revision']
    assert len(result['periods']['months']) == 1
    def assert_no_events(value):
        if isinstance(value, dict):
            assert not {'ledger', 'visible_rows', 'positions', 'position'} & value.keys()
            for entry in value.values(): assert_no_events(entry)
        elif isinstance(value, list):
            for entry in value: assert_no_events(entry)
    assert_no_events(result)


def test_bounded_sampling_retains_exact_endpoints_counts_and_original_sequences(monkeypatch):
    import trading_workspace_v2.dashboard_sessions as module
    view = build_replay_analytics_view(closed_trade_record())
    points = [{'sequence': i, 'closed_trade_balance': 1000 + i} for i in range(100001)]
    view['metrics'].update(closed_trade_balance_curve=points, net_pnl=100000, starting_balance=1000, closed_trade_count=100000)
    monkeypatch.setattr(module, 'build_replay_analytics_view', lambda *args: view)
    summary = build_session_summary(fixture(), 'tenant-a')
    assert len(summary['curve']['points']) == 128
    assert summary['curve']['total_points'] == 100001
    assert summary['curve']['sampled']
    assert summary['curve']['points'][0] == points[0]
    assert summary['curve']['points'][-1] == points[-1]
    assert summary['metrics']['closed_trade_count'] == 100000
    assert 'closed_trade_balance_curve' not in summary['metrics']


def test_revision_fences_mutation_and_dataset_change_and_scope():
    records = [fixture()]
    first = build_dashboard_sessions(records, [manifest()], 'tenant-a', cache=DashboardSummaryCache())
    assert build_dashboard_sessions(records, [manifest()], 'other', cache=DashboardSummaryCache())['revision'] != first['revision']
    records[0]['revision'] += 1
    with pytest.raises(DashboardRevisionConflict):
        build_dashboard_sessions(records, [manifest()], 'tenant-a', revision=first['revision'])
    records[0]['revision'] -= 1
    dataset = manifest(); dataset.artifact_sha256 = 'e' * 64
    with pytest.raises(DashboardRevisionConflict):
        build_dashboard_sessions(records, [dataset], 'tenant-a', revision=first['revision'])


def test_cache_is_bounded_digest_sensitive_and_copies_cannot_poison_next_read():
    cache = DashboardSummaryCache(max_items=2)
    source = fixture()
    first = cache.read('tenant-a', source); first['strategy'] = 'poison'
    assert cache.read('tenant-a', source)['strategy'] is None
    source['payload']['playbook_id'] = 'changed-with-same-revision'
    assert cache.read('tenant-a', source)['strategy'] == 'changed-with-same-revision'
    cache.read('other', source)
    assert len(cache.items) == 2 and cache.bytes <= cache.max_bytes


def test_search_asset_strategy_and_page_clamp_keep_total_and_matching_distinct():
    records = [fixture(key='alpha', strategy='swing'), fixture(key='beta'), fixture(key='gamma', strategy='swing')]
    selected = build_dashboard_sessions(records, [manifest()], 'tenant-a', strategy='unassigned', page=30, cache=DashboardSummaryCache())
    assert selected['total'] == 3 and selected['matching_count'] == 1 and selected['page'] == 1
    assert selected['items'][0]['record_id'] == 'beta'
    none = build_dashboard_sessions(records, [manifest()], 'tenant-a', search='missing', cache=DashboardSummaryCache())
    assert none['items'] == [] and none['total'] == 3 and none['matching_count'] == 0
    for filters in ({'page': 0}, {'page_size': 26}, {'sort': 'bad'}, {'search': 'x' * 257}):
        with pytest.raises(ValueError): build_dashboard_sessions(records, [manifest()], 'tenant-a', **filters)


def test_store_reads_are_batched_and_metadata_never_reads_artifact():
    source = fixture(closed_trade_record())
    class Store:
        calls = []
        def list_records(self, workspace, kind):
            self.calls.append('records'); assert workspace == 'tenant-a'; return [source]
        def list_datasets(self, workspace):
            self.calls.append('datasets'); return [manifest()]
        def get_record(self, workspace, kind, key):
            self.calls.append('record'); return source if workspace == 'tenant-a' and key == source['record_id'] else None
        def get_dataset(self, *args): raise AssertionError('per-session dataset read')
    store = Store()
    read_dashboard_sessions(store, 'tenant-a', cache=DashboardSummaryCache())
    assert store.calls == ['records', 'datasets']
    metadata = read_replay_metadata(store, 'tenant-a', source['record_id'])
    assert metadata['cutoff_timestamp'] == 1700000060
    assert metadata['payload']['execution']['cost_model'] == source['payload']['execution']['cost_model']
    assert 'ledger' not in metadata['payload']['execution']
    with pytest.raises(LookupError): read_replay_metadata(store, 'other', source['record_id'])

def test_profit_currency_guard_and_stable_ids_do_not_compare_usd_to_jpy():
    records = [fixture(key='a', created='2026-10-01T00:00:00Z'), fixture(key='b', created='2026-10-02T00:00:00Z')]
    class Summaries:
        mixed = True
        def read(self, workspace, record):
            return {'revision': record['revision'], 'pnl': 100 if record['record_id'] == 'a' else 5,
                    'currency': 'JPY' if self.mixed and record['record_id'] == 'b' else 'USD'}
    cache = Summaries()
    mixed = build_dashboard_sessions(records, [manifest()], 'tenant-a', sort='profit', cache=cache)
    assert mixed['profit_comparable'] is False
    assert [item['record_id'] for item in mixed['items']] == ['b', 'a']
    cache.mixed = False
    comparable = build_dashboard_sessions(records, [manifest()], 'tenant-a', sort='profit', cache=cache)
    assert comparable['profit_comparable'] is True
    assert [item['record_id'] for item in comparable['items']] == ['a', 'b']


def test_absent_execution_does_not_fabricate_zero_and_invalid_financial_source_is_error():
    uninitialized = build_session_summary(fixture(), 'tenant-a')
    assert uninitialized['analytics_available'] is False and uninitialized['pnl'] is None
    assert uninitialized['metrics'].get('closed_trade_count') is None
    source = fixture(closed_trade_record())
    source['payload']['execution']['ledger'][1]['details']['net_pnl'] = 'NaN'
    invalid = build_session_summary(source, 'tenant-a')
    assert invalid['status'] == 'error' and invalid['unavailable'] and invalid['pnl'] is None
