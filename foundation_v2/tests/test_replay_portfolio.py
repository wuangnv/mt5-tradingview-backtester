from copy import deepcopy
from decimal import Decimal
from types import SimpleNamespace

import pytest

from foundation_v2.tests.test_ps02_replay_prop_connection import BASE_TIME, FakeStore, instrument_mapping, cost_mapping
from trading_workspace_v2.replay import ReplayService
from trading_workspace_v2.replay_analytics import build_replay_analytics_view
from trading_workspace_v2.dashboard_read_model import build_dashboard_performance


class PortfolioStore(FakeStore):
    def __init__(self):
        super().__init__([])
        self.manifests = {}
        self.bars = {}
        for key, symbol, offset, price in [('a', 'EURUSD', 0, 1.1), ('b', 'GBPUSD', 120, 1.2)]:
            spec = {**instrument_mapping(), 'instrument_id': symbol}
            self.manifests[key] = SimpleNamespace(artifact_path=key, artifact_sha256=key * 64,
                instrument_id=symbol, instrument_spec=spec, timeframe='M1', timeframe_seconds=60, row_count=7)
            self.bars[key] = [dict(timestamp=BASE_TIME + offset + i * 60, open=price, high=price + .002,
                low=price - .001, close=price + .001, volume=10) for i in range(7)]

    def get_dataset(self, workspace, key):
        return self.manifests.get(key) if workspace == 'tenant-a' else None

    def read_dataset(self, path, digest):
        assert digest == self.manifests[path].artifact_sha256
        return deepcopy(self.bars[path])


@pytest.fixture
def portfolio():
    store = PortfolioStore()
    service = ReplayService(store, store)
    record = service.create('tenant-a', 'a', dataset_ids=['a', 'b'], starting_balance='10000')
    return store, service, record


def switch(service, record, asset):
    return service.select_asset('tenant-a', record['record_id'], record['revision'], asset)


def initialize(service, record, **changes):
    spec = service.store.manifests[record['payload']['dataset_id']].instrument_spec
    return service.initialize_execution('tenant-a', record['record_id'], record['revision'], **{
        'instrument_spec': spec, 'cost_model': cost_mapping(), 'spread_price': '.0002',
        'timeframe_seconds': 60, 'starting_balance': '10000', **changes})


def queue(service, record, asset):
    price = 1.1 if asset == 'a' else 1.2
    return service.queue_market_order('tenant-a', record['record_id'], record['revision'],
        operation_id='order-' + asset, side='BUY', quantity='.1', stop_loss=str(price - .01), take_profit=str(price + .01))


def step(service, record, count=1):
    return service.step('tenant-a', record['record_id'], record['revision'], count)


def test_common_clock_switch_reload_and_no_future(portfolio):
    store, service, record = portfolio
    assert record['payload']['cursor_index'] == 2
    assert record['payload']['replay_clock_utc'] == BASE_TIME + 180
    switched = switch(service, record, 'b')
    assert switched['payload']['cursor_index'] == 0
    assert len(switched['visible_rows']) == 1
    assert switched['payload']['replay_clock_utc'] == record['payload']['replay_clock_utc']
    assert switched['portfolio_account'] == record['portfolio_account']
    resumed = ReplayService(store, store).view('tenant-a', record['record_id'])
    assert resumed == switched
    advanced = step(service, switched)
    assert advanced['payload']['asset_states']['a']['cursor_index'] == 3
    assert advanced['payload']['asset_states']['b']['cursor_index'] == 1
    assert advanced['payload']['timing']['historical_time_replayed_seconds'] == 60
    assert max(row['timestamp'] + 60 for row in advanced['visible_rows']) <= advanced['payload']['replay_clock_utc']


def test_shared_wallet_inactive_sl_tp_and_analytics(portfolio):
    store, service, record = portfolio
    record = queue(service, initialize(service, record), 'a')
    record = queue(service, initialize(service, switch(service, record, 'b')), 'b')
    record = step(service, record)
    assert record['portfolio_account']['open_position_count'] == 2
    assert Decimal(record['portfolio_account']['balance']) == 10000
    # Both instruments hit TP while only GBPUSD is displayed.
    store.bars['a'][4]['high'] = 1.12
    store.bars['b'][2]['high'] = 1.22
    record = step(service, record)
    states = record['payload']['asset_states']
    expected = Decimal(10000) + sum(Decimal(state['execution']['balance']) - 10000 for state in states.values())
    assert Decimal(record['portfolio_account']['balance']) == expected > 10000
    assert record['portfolio_account']['open_position_count'] == 0
    analytics = build_replay_analytics_view(service.analytics_record('tenant-a', record['record_id']))
    assert len(analytics['ledger']) == 2
    assert len({trade['trade_id'] for trade in analytics['ledger']}) == 2
    assert analytics['portfolio_account']['balance'] == str(expected)
    assert Decimal(str(sum(t['net_pnl'] for t in analytics['ledger']))) == expected - 10000
    assert analytics['scope']['total_trade_count'] == 2
    branch = service.branch('tenant-a', record['record_id'], record['revision'], record['payload']['cursor_index'])
    dashboard = build_dashboard_performance([record, branch], 'tenant-a', include_ledger=True)
    assert dashboard['metrics']['closed_trade_count'] == 2
    assert dashboard['excluded'] == []
    switched = switch(service, record, 'a')
    assert switched['portfolio_account'] == record['portfolio_account']


def test_history_does_not_leak_inactive_execution_and_branch(portfolio):
    _, service, initial = portfolio
    record = initialize(service, initial)
    record = queue(service, record, 'a')
    record = step(service, record, 2)
    record = switch(service, record, 'b')  # Active asset was never initialized.
    historical = service.view('tenant-a', record['record_id'], cursor_index=0)
    assert historical['payload']['asset_states']['a']['cursor_index'] == 2
    assert historical['portfolio_account']['open_position_count'] == 0
    assert historical['payload']['execution'] is None
    branch = service.branch('tenant-a', record['record_id'], record['revision'], 0)
    assert branch['record_id'] != record['record_id']
    assert branch['payload']['replay_clock_utc'] == initial['payload']['replay_clock_utc']
    assert branch['payload']['asset_states']['a']['execution']['replay_session_id'] == branch['record_id']
    assert service.view('tenant-a', record['record_id']) == record


@pytest.mark.parametrize('ids', [['a', 'a'], ['b', 'a'], ['a', 'missing'], ['a', '']])
def test_invalid_membership(portfolio, ids):
    store, service, _ = portfolio
    before = deepcopy(store.records)
    with pytest.raises((ValueError, LookupError)):
        service.create('tenant-a', 'a', dataset_ids=ids)
    assert store.records == before


def test_scope_conflict_currency_version_and_unsupported_modes(portfolio):
    store, service, record = portfolio
    with pytest.raises(RuntimeError, match='revision conflict'):
        service.select_asset('tenant-a', record['record_id'], 99, 'b')
    with pytest.raises(LookupError):
        service.select_asset('tenant-other', record['record_id'], 1, 'b')
    with pytest.raises(ValueError):
        service.select_asset('tenant-a', record['record_id'], 1, 'missing')
    store.manifests['b'].instrument_id = 'EURUSD'
    with pytest.raises(ValueError, match='one immutable'):
        service.create('tenant-a', 'a', dataset_ids=['a', 'b'])
    store.manifests['b'].instrument_id = 'GBPUSD'
    store.manifests['b'].instrument_spec['account_ccy'] = 'EUR'
    with pytest.raises(ValueError, match='currency'):
        service.create('tenant-a', 'a', dataset_ids=['a', 'b'])
    with pytest.raises(ValueError, match='shared starting'):
        initialize(service, record, starting_balance='20000')
    with pytest.raises(ValueError, match='bar execution'):
        initialize(service, record, tick_snapshot_id='ticks-x')
    with pytest.raises(ValueError, match='bar execution'):
        initialize(service, record, research_margin={'version':'fixed-starting-balance-leverage-v1', 'leverage':'100'})
    assert service.tick_options('tenant-a', record['record_id'])['available'] is False
    with pytest.raises(ValueError, match='Prop lifecycle'):
        service.feed_prop_lifecycle('tenant-a', record['record_id'], prop_session_id='x', prop_attempt_id='x',
            replay_event_sequence=1, expected_prop_revision=1, prop_event_sequence=1)


def test_failed_step_is_atomic_and_gaps_are_asof(portfolio):
    store, service, record = portfolio
    record = queue(service, initialize(service, record), 'a')
    # Invalid future bracket on one asset must not partly advance the session.
    store.bars['a'][3].update(open=2, high=2.01, low=1.99, close=2)
    with pytest.raises(ValueError):
        step(service, record)
    assert service.view('tenant-a', record['record_id']) == record
    store.bars['a'][3].update(open=1.1, high=1.102, low=1.099, close=1.101)
    store.bars['b'].pop(1)
    advanced = step(service, record)
    assert advanced['payload']['asset_states']['b']['cursor_index'] == 0
    assert advanced['payload']['replay_clock_utc'] == BASE_TIME + 240


def test_common_end_and_legacy_single_asset(portfolio):
    _, service, record = portfolio
    record = step(service, record, 1000)
    assert record['payload']['replay_clock_utc'] == BASE_TIME + 420
    assert record['payload']['status'] == 'completed'
    assert record['has_future_rows'] is False
    legacy = service.create('tenant-a', 'a', dataset_ids=['a'])
    assert 'asset_states' not in legacy['payload']
    assert 'portfolio_account' not in legacy
    assert step(service, legacy)['payload']['cursor_index'] == 1


def test_different_timeframes_keep_only_closed_bars(portfolio):
    store, service, _ = portfolio
    store.manifests['b'].timeframe_seconds = 300
    store.bars['b'] = [{**row, 'timestamp':BASE_TIME + i * 300} for i, row in enumerate(store.bars['b'])]
    record = service.create('tenant-a', 'a', dataset_ids=['a', 'b'])
    assert record['payload']['replay_clock_utc'] == BASE_TIME + 300
    assert record['payload']['asset_states']['a']['cursor_index'] == 4
    assert record['payload']['asset_states']['b']['cursor_index'] == 0
    record = switch(service, record, 'b')
    record = step(service, record)
    assert record['payload']['replay_clock_utc'] == BASE_TIME + 420
    assert record['payload']['asset_states']['b']['cursor_index'] == 0
    assert record['payload']['status'] == 'completed'
    assert record['has_future_rows'] is False


def test_visible_window_preserves_absolute_cursor_and_old_history(portfolio):
    store, service, _ = portfolio
    for key, price in [('a',1.1),('b',1.2)]:
        store.bars[key] = [dict(timestamp=BASE_TIME + i*60, open=price, high=price+.002,
            low=price-.001, close=price+.001, volume=10) for i in range(5000)]
    record = service.create('tenant-a', 'a', start_index=4000, dataset_ids=['a', 'b'])
    assert len(record['visible_rows']) == 2000
    assert record['visible_row_start'] == 2001
    assert record['view_cursor_index'] == 4000
    historical = service.view('tenant-a', record['record_id'], 10)
    assert len(historical['visible_rows']) == 11
    assert historical['payload']['asset_states']['b']['cursor_index'] == 10
    with pytest.raises(ValueError, match='common replay period'):
        service.branch('tenant-a', record['record_id'], record['revision'], 10)


def test_stale_asset_cannot_fill_in_the_past(portfolio):
    store, service, _ = portfolio
    store.manifests['b'].timeframe_seconds = 300
    store.bars['a'] = [{**store.bars['a'][0], 'timestamp':BASE_TIME+i*60} for i in range(14)]
    store.bars['b'] = [{**row, 'timestamp':BASE_TIME + i*300} for i, row in enumerate(store.bars['b'])]
    record = service.create('tenant-a','a',dataset_ids=['a','b'])
    record = step(service, record)
    record = switch(service, record, 'b')
    record = initialize(service, record, timeframe_seconds=300)
    with pytest.raises(ValueError, match='newly closed bar'):
        queue(service, record, 'b')
    assert record['payload']['replay_clock_utc'] == BASE_TIME + 360
