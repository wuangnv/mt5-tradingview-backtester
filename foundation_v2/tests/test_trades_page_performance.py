"""Installed projection parity against the frozen pre-optimization source."""

import copy
import json
import random
import sys
from pathlib import Path

import pytest

V2 = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(V2.parent), str(V2), str(V2 / 'tests')]
from scripts.api_performance_probe import projection_baseline
from test_trades_page import journal, report, row
from trading_workspace_v2.trades_page import SORT_KEYS, build_trades_page


def fixtures():
    rng = random.Random(4519)
    rows = [row(i, session_id=f'session-{i % 3}', session_name=f'Name {i % 2}',
                net_pnl=rng.randint(-100, 100), tags=['base', f'raw-{i % 3}'],
                symbol=['EURUSD', 'XAUUSD', 'GBPUSD'][i % 3], side=['BUY', 'SELL'][i % 2],
                entry_type=['market', 'limit', None][i % 3], playbook_id=['a', 'b', None][i % 3],
                close_time_utc=[None, '2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z', '2026-10-07T00:00:00Z'][i % 4],
                open_time_utc=1700000000 + i * 120, rating=[None, 2, 5, 'invalid'][i % 4],
                price_open=[1.2, 1.3, None][i % 3], quantity=[1, 2, None][i % 3],
                price_close=[None, 1.4, 1.5][i % 3], stop_loss=[1.1, None][i % 2],
                starting_balance=[1000, 10000, None][i % 3], notes='review' if i % 4 == 0 else None)
            for i in range(27)]
    journals = [
        {'record_id': f'journal-{i}', 'revision': i + 1,
         'payload': {'source': {'session_id': f'session-{i % 3}',
                                'replay_session_id': f'session-{(i + 1) % 3}',
                                'trade_id': f'trade-{i:03}', 'id': f'trade-{i + 1:03}'},
                     'tags': ['base', 'planned', f'journal-{i % 2}']}}
        for i in range(15)]
    journals += [journal(1, ['foreign-session']),
                 {'record_id': 'missing', 'revision': 1, 'payload': {}},
                 {'record_id': 'malformed-ids', 'revision': 1,
                  'payload': {'source': {'session_id': ['session-0'], 'trade_id': {'id': 0}}, 'tags': ['ignored']}}]
    return report(rows), journals


@pytest.mark.parametrize('direction', ['asc', 'desc'])
@pytest.mark.parametrize('sort_key', sorted(SORT_KEYS))
def test_every_sort_filter_page_and_snapshot_matches_original(sort_key, direction):
    baseline, _ = projection_baseline()
    source, journals = fixtures()
    before = copy.deepcopy([source, journals])
    filters = [{}, {'tagInclude': ['planned', 'journal-0']},
               {'tagExclude': ['planned', 'journal-0'], 'tagExcludeMode': 'OR'},
               {'assets': ['XAUUSD'], 'sides': ['sell']}, {'types': ['market']},
               {'outcomes': ['loss']}, {'search': 'journal-1'}, {'notes': 'review'},
               {'strategy': 'a'}, {'source': 'session-1'},
               {'timezone': 'America/New_York', 'timeStart': '01:30', 'timeEnd': '01:30'},
               {'timeStart': '23:30', 'timeEnd': '00:30'}, {'weekday': '3', 'hour': '0'},
               {'reportKinds': ''}, {'reportKinds': []}, {'reportKinds': ['prop']}]
    for extra in filters:
        for selected_page in [1, 2, 999]:
            options = dict(page=selected_page, page_size=3, sort_key=sort_key,
                           sort_direction=direction, extra_filters=json.dumps(extra))
            assert build_trades_page(source, journals, **options) == baseline(source, journals, **options)
    assert [source, journals] == before


def test_duplicate_source_aliases_append_once_with_exact_original_tag_order():
    rows = [row(1, tags=['raw', 'duplicate']), row(2), row(1, session_id='session-b')]
    journals = [journal(1, ['first', 'duplicate']),
                {'record_id': 'alias', 'revision': 1, 'payload': {
                    'source': {'session_id': 'session-a', 'replay_session_id': 'session-a',
                               'trade_id': 'trade-001', 'id': 'trade-001'}, 'tags': ['second', 'first']}},
                {'record_id': 'multi', 'revision': 1, 'payload': {
                    'source': {'session_id': 'session-a', 'replay_session_id': 'session-b',
                               'trade_id': 'trade-001', 'id': 'trade-002'}, 'tags': ['shared']}}]
    payload = build_trades_page(report(rows), journals, page=1, page_size=10, sort_key='status', sort_direction='asc')
    assert payload['ledger'][0]['tags'] == ['raw', 'duplicate', 'first', 'second', 'shared']
    assert payload['ledger'][1]['tags'] == ['shared']
    assert payload['ledger'][2]['tags'] == ['shared']


def test_journals_are_not_rescanned_per_trade():
    class CountingJournals(list):
        iterations = 0
        def __iter__(self):
            self.iterations += 1
            return super().__iter__()

    journals = CountingJournals([journal(i, ['planned']) for i in range(25)])
    payload = build_trades_page(report([row(i) for i in range(500)]), journals,
                               page=1, page_size=10, sort_key='close_time_utc', sort_direction='desc')
    assert payload['pagination']['filtered_count'] == 500
    assert journals.iterations <= 2  # One indexed join plus journal revision snapshot.
