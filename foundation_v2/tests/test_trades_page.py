"""Paging contract, filter parity and source-scope regression tests."""
import copy
import json
import subprocess
import sys
from pathlib import Path

import pytest

V2 = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(V2.parent), str(V2), str(V2 / 'tests')]
from trading_workspace_v2.analytics_read_model import AnalyticsValidationError
from trading_workspace_v2.dashboard_read_model import build_dashboard_performance
from trading_workspace_v2.trades_page import build_trades_page, parse_filters, timestamp
from test_replay_analytics import closed_trade_record, record
from test_dashboard_read_model import fork


def row(index, **patch):
    return {'trade_id': f'trade-{index:03}', 'session_id': 'session-a',
            'session_name': 'Session A', 'symbol': 'EURUSD', 'side': 'BUY',
            'net_pnl': index + 1, 'starting_balance': 10000,
            'close_time_utc': 1700000000 + index * 60,
            'source': {'session_id': 'session-a', 'revision': 1},
            'source_provenance': {'session_id': 'session-a', 'revision': 1,
                                  'dataset_sha256': 'a' * 64, 'cutoff_timestamp': 1700000000 + index * 60}, **patch}


def report(rows, *, count='auto', status='ready'):
    return {'schema_version': 'dashboard-replay-performance-v1', 'status': status,
            'metrics': {'closed_trade_count': len(rows) if count == 'auto' else count},
            'ledger': rows, 'scope': {'session_ids': ['session-a'],
                                     'aggregation': 'unique_closed_fills_within_root_lineage'},
            'sources': [{'session_id': 'session-a', 'revision': 1, 'cutoff_timestamp': 1700000000}],
            'excluded': [] if status == 'ready' else [{'session_id': 'bad', 'reason': 'missing'}],
            'sessions': []}


def page(rows, *, filters=None, journals=None, **patch):
    return build_trades_page(report(rows), journals or [], page=patch.pop('page', 1),
                             page_size=patch.pop('page_size', 10),
                             sort_key=patch.pop('sort_key', 'close_time_utc'),
                             sort_direction=patch.pop('sort_direction', 'desc'),
                             extra_filters=json.dumps(filters or {}), **patch)


def ids(payload):
    return [r['trade_id'] for r in payload['ledger']]


def journal(index, tags):
    return {'record_id': 'journal-a', 'revision': 1,
            'payload': {'source': {'replay_session_id': 'session-a', 'trade_id': f'trade-{index:03}'}, 'tags': tags}}


def test_large_scope_sorted_before_slice_full_count_and_clamp():
    rows = [row(i) for i in range(137)]
    first = page(rows, page_size=100)
    second = page(rows, page=2, page_size=100)
    assert first['pagination']['filtered_count'] == second['pagination']['filtered_count'] == 137
    assert first['pagination']['returned_count'] == 100 and second['pagination']['returned_count'] == 37
    assert set(ids(first)).isdisjoint(ids(second))
    assert ids(first)[0] == 'trade-136' and ids(second)[-1] == 'trade-000'
    assert page(rows, page=999, page_size=100)['pagination']['page'] == 2


def test_journal_comma_tag_filters_before_slice_and_unfiltered_facets():
    rows = [row(i) for i in range(137)]
    journals = [journal(1, ['review, later', 'planned'])]
    result = page(rows, journals=journals, filters={'tagInclude': '["planned","review, later"]'})
    assert ids(result) == ['trade-001']
    assert result['pagination']['filtered_count'] == 1
    assert result['facets']['tags'] == ['planned', 'review, later']
    assert result['ledger'][0]['tags'] == ['review, later', 'planned']
    assert not page(rows, journals=journals, filters={'tagExclude': '["planned"]'})['pagination']['filtered_count'] == 137
    result = page(rows, journals=journals, filters={'tagInclude': '["planned","absent"]', 'tagIncludeMode': 'OR'})
    assert ids(result) == ['trade-001']


def test_empty_unknown_partial_readable_are_distinct():
    empty = build_trades_page(report([]), [], page=1, page_size=10, sort_key='net_pnl', sort_direction='asc')
    unavailable = build_trades_page(report([], count=None, status='partial'), [], page=1, page_size=10, sort_key='net_pnl', sort_direction='asc')
    readable = build_trades_page(report([row(1)], status='partial'), [], page=1, page_size=10, sort_key='net_pnl', sort_direction='asc')
    assert empty['pagination']['filtered_count'] == 0 and empty['pagination']['page_count'] == 0
    assert unavailable['pagination']['filtered_count'] is None and unavailable['pagination']['page_count'] is None
    assert readable['status'] == 'partial' and readable['pagination']['filtered_count'] == 1


def test_canonical_dedup_and_provenance_preserved_without_source_mutation():
    source = closed_trade_record()
    child = fork(source, 'child')
    unknown = record(); unknown['record_id'] = 'unknown'
    source_before = copy.deepcopy([source, child, unknown])
    full = build_dashboard_performance([source, child, unknown], 'tenant-a', include_ledger=True)
    full_before = copy.deepcopy(full)
    result = build_trades_page(full, [], page=1, page_size=10, sort_key='close_time_utc', sort_direction='desc')
    assert result['pagination']['filtered_count'] == 1
    assert result['scope']['duplicate_trade_count'] == 1
    assert result['excluded'] == full['excluded']
    assert result['ledger'][0]['source_provenance'] == full['ledger'][0]['source_provenance']
    assert full == full_before and [source, child, unknown] == source_before


@pytest.mark.parametrize('direction,expected', [('asc', ['trade-003', 'trade-001', 'trade-000', 'trade-002']), ('desc', ['trade-001', 'trade-003', 'trade-000', 'trade-002'])])
def test_null_last_both_directions_and_stable_ties(direction, expected):
    rows = [row(0, rating=None), row(1, rating=5), row(2, rating=None), row(3, rating=2)]
    assert ids(page(rows, sort_key='rating', sort_direction=direction)) == expected
    assert ids(page(rows, sort_key='status', sort_direction=direction)) == [f'trade-{i:03}' for i in range(4)]


def test_return_percentage_sorts_using_each_row_capital():
    rows = [row(0, net_pnl=100, starting_balance=1000), row(1, net_pnl=500, starting_balance=10000), row(2, starting_balance=None)]
    assert ids(page(rows, sort_key='return_pct', sort_direction='asc')) == ['trade-001', 'trade-000', 'trade-002']


def test_revision_and_journal_changes_update_snapshot_while_same_scope_is_stable():
    full = report([row(1)])
    journals = [journal(1, ['planned'])]
    def build():
        return build_trades_page(full, journals, page=1, page_size=10, sort_key='net_pnl', sort_direction='asc')['snapshot_key']
    first = build()
    assert build() == first
    full['sources'][0]['revision'] = 2
    second = build(); assert second != first
    journals[0]['revision'] = 2
    assert build() != second


@pytest.mark.parametrize('patch', [{'page': 0}, {'page_size': 0}, {'page_size': 101}, {'sort_key': 'unknown'}, {'sort_direction': 'sideways'}])
def test_invalid_page_arguments_rejected(patch):
    with pytest.raises(AnalyticsValidationError):
        page([row(1)], **patch)


@pytest.mark.parametrize('raw', ['[]', '{bad', '{"unknown":"x"}', '{"timeStart":"24:00"}', '{"timezone":"not/a-zone"}', '{"tagIncludeMode":"X"}', '{"assets":[true]}', '{"tagInclude":false}', '{"assets":null}', '{"reportKinds":0}'])
def test_invalid_filter_inputs_rejected(raw):
    with pytest.raises(AnalyticsValidationError):
        parse_filters(raw)


def test_type_empty_string_and_explicit_none_remain_distinct():
    rows = [row(1)]
    assert ids(page(rows, filters={'reportKinds': ''})) == ['trade-001']
    assert ids(page(rows, filters={'reportKinds': '[]'})) == []
    assert ids(page(rows, filters={'reportKinds': '["prop"]'})) == []
    assert ids(page(rows, filters={'types': '["market"]'})) == []


def test_js_parity_dst_overnight_weekday_unknown_and_multi_categories():
    rows = [row(0, close_time_utc='2026-11-01T05:30:00Z', tags=['planned']),
            row(1, close_time_utc='2026-11-01T06:30:00Z', tags=['planned', 'review, later']),
            row(2, close_time_utc='2026-11-01T07:30:00Z', tags=['review, later']),
            row(3, close_time_utc='2026-10-06T23:59:00Z'),
            row(4, close_time_utc='2026-10-07T00:00:00Z'), row(5, close_time_utc=None)]
    filters = [{'timezone': 'America/New_York', 'timeStart': '01:30', 'timeEnd': '01:30'},
               {'timeStart': '23:30', 'timeEnd': '00:30'}, {'timeStart': '23:30'},
               {'timezone': 'Asia/Ho_Chi_Minh', 'days': '["3"]', 'hours': '["7"]'},
               {'tagInclude': '["planned","review, later"]', 'tagIncludeMode': 'AND'},
               {'tagExclude': '["planned","review, later"]', 'tagExcludeMode': 'OR'},
               {'reportKinds': ''}, {'reportKinds': '[]'}, {}]
    js = '''import {filterAnalyticsRows} from './src/tradingAnalyticsModel.js';
      let text=''; for await (const part of process.stdin) text+=part;
      const {rows,filters}=JSON.parse(text);
      console.log(JSON.stringify(filters.map(f=>filterAnalyticsRows(rows,f).map(r=>r.trade_id))));'''
    expected = json.loads(subprocess.run(['node', '--input-type=module', '-e', js], input=json.dumps({'rows': rows, 'filters': filters}), capture_output=True, text=True, check=True, cwd=V2 / 'web').stdout)
    for f, wanted in zip(filters, expected):
        result = page(rows, filters=f, page_size=100, sort_key='status', sort_direction='asc')
        assert ids(result) == wanted, (f, ids(result), wanted)


@pytest.mark.parametrize('value', [1700000000000, '1700000000', 946684800000])
def test_timestamp_parser_matches_supported_js_epoch_formats(value):
    js = 'import {closeTime} from "./src/sessionPerformanceModel.js";console.log(closeTime(JSON.parse(process.argv[1])).toISOString())'
    expected = subprocess.run(['node', '--input-type=module', '-e', js, json.dumps(value)], cwd=V2 / 'web', capture_output=True, text=True, check=True).stdout.strip()
    actual = timestamp(value)
    assert actual is not None
    assert actual.isoformat().replace('+00:00', 'Z') == expected.replace('.000Z', 'Z')


def test_http_opt_in_unpaged_compatibility_auth_and_date_boundaries(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from trading_workspace_v2 import api
    from trading_workspace_v2.auth import LocalWorkspaceAuthorization
    source = closed_trade_record()
    before = copy.deepcopy(source)

    class FakeStore:
        def __init__(self, _):
            pass
        def initialize(self):
            pass
        def close(self):
            pass
        def list_records(self, workspace, kind):
            assert workspace == 'tenant-a'
            return [source] if kind == 'replay' else []
        def list_record_heads(self, workspace, kind):
            return [{'record_id': item['record_id'], 'revision': item['revision'], 'payload': {}}
                    for item in self.list_records(workspace, kind)]
        def records_at_heads(self, workspace, kind, heads, **kwargs):
            return self.list_records(workspace, kind)
        def list_replay_activity(self, workspace):
            assert workspace == 'tenant-a'
            return []

    monkeypatch.setattr(api, 'PostgresStore', FakeStore)
    app = api.create_app(dsn='unused', artifact_root=tmp_path, learn_roots={},
                         authorization=LocalWorkspaceAuthorization.for_local_owner(['tenant-a']))
    path = '/api/v2/replay/trades'
    headers = {'X-Workspace-Id': 'tenant-a'}
    with TestClient(app) as client:
        full = client.get(path, headers=headers)
        assert full.status_code == 200
        assert full.json()['schema_version'] == 'dashboard-replay-performance-v1'
        assert len(full.json()['ledger']) == full.json()['metrics']['closed_trade_count'] == 1
        paged = client.get(path, headers=headers, params={'page': 1})
        assert paged.status_code == 200
        assert paged.json()['schema_version'] == 'replay-trades-page-v1'
        exact = client.get(path, headers=headers, params={'page': 1, 'from_close_utc': '2023-11-14T22:14:20Z', 'to_close_utc': '2023-11-14T22:14:20Z'})
        assert exact.json()['pagination']['filtered_count'] == 1
        later = client.get(path, headers=headers, params={'page': 1, 'from_close_utc': '2026-01-01T00:00:00Z'})
        assert later.json()['pagination']['filtered_count'] == 0
        assert client.get(path, headers={'X-Workspace-Id': 'tenant-b'}, params={'page': 1}).status_code == 403
        assert client.get(path, headers=headers, params={'page': 1, 'sessions': 'missing'}).status_code == 404
        for params in [{'page': 0}, {'page': 1, 'page_size': 101}, {'page': 1, 'extra_filters': '[]'}, {'page': 1, 'sort_key': 'unknown'}]:
            assert client.get(path, headers=headers, params=params).status_code == 422
    assert source == before
