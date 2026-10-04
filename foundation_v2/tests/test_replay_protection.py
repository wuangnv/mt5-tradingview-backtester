from copy import deepcopy
from decimal import Decimal
import pytest

from foundation_v2.tests.test_replay_execution_core import initial_state
from foundation_v2.tests.test_ps02_replay_prop_connection import (
    BASE_TIME, FakeArtifacts, FakeStore, instrument_mapping, cost_mapping,
)
from trading_workspace_v2.replay import ReplayService
from trading_workspace_v2.replay_execution import (
    advance_replay_execution, change_replay_protection, queue_market_order,
    reconstruct_replay_execution_checkpoint, parse_replay_execution_snapshot,
)


def opened(side='BUY'):
    snapshot = queue_market_order(initial_state(), operation_id='open-1', side=side, quantity='.1',
        stop_loss='1.09' if side == 'BUY' else '1.12', take_profit='1.12' if side == 'BUY' else '1.09')
    return advance_replay_execution(snapshot, bar={'timestamp': 60, 'open': 1.1, 'high': 1.105,
        'low': 1.099, 'close': 1.102}, cursor_index=1).snapshot


def amend(snapshot, **kwargs):
    return change_replay_protection(snapshot, target_id=snapshot.position.position_id if snapshot.position else 'open-1',
        operation_id='edit-1', stop_loss='1.101' if snapshot.position and snapshot.position.side == 'BUY' else '1.11',
        take_profit='1.115' if snapshot.position and snapshot.position.side == 'BUY' else '1.095',
        mid_close='1.102', virtual_time_utc=120, **kwargs)


@pytest.mark.parametrize('side', ['BUY', 'SELL'])
def test_protection_is_future_only_and_does_not_change_account(side):
    before = opened(side)
    changed = amend(before)
    assert changed.position.entry_fill == before.position.entry_fill
    assert changed.position.quantity == before.position.quantity
    assert (changed.balance, changed.equity, changed.floating_pl) == (before.balance, before.equity, before.floating_pl)
    assert changed.cursor_index == before.cursor_index
    assert changed.event_sequence == before.event_sequence + 1
    assert changed.ledger[-1]['kind'] == 'protection_change'
    assert before.position.stop_loss != changed.position.stop_loss
    assert parse_replay_execution_snapshot(changed.model_dump(mode='json')) == changed
    # The new stop is inside the prior candle's range. It must not be retro-filled.
    assert changed.position is not None
    future = advance_replay_execution(changed, bar={'timestamp': 120, 'open': 1.102,
        'high': 1.105, 'low': 1.099, 'close': 1.103}, cursor_index=2).snapshot
    if side == 'BUY':
        assert future.position is None
        assert next(e for e in future.ledger if e['kind'] == 'protective_fill')['cursor_index'] == 2


def test_exact_checkpoint_before_and_after_amendment_survives_later_step():
    before = opened()
    changed = amend(before)
    later = advance_replay_execution(changed, bar={'timestamp': 120, 'open': 1.102,
        'high': 1.105, 'low': 1.1015, 'close': 1.103}, cursor_index=2).snapshot
    assert reconstruct_replay_execution_checkpoint(later, cursor_index=1) == changed
    assert reconstruct_replay_execution_checkpoint(later, cursor_index=1, event_sequence=before.event_sequence) == before


@pytest.mark.parametrize('field,value', [('stop_loss', '1.103'), ('take_profit', '1.101'),
    ('stop_loss', 'NaN'), ('take_profit', '0'), ('target_id', 'other-position'), ('operation_id', 'open-1')])
def test_invalid_protection_does_not_mutate_snapshot(field, value):
    before = opened()
    serialized = deepcopy(before.model_dump(mode='json'))
    params = dict(target_id=before.position.position_id, operation_id='edit-1', stop_loss='1.101',
        take_profit='1.115', mid_close='1.102', virtual_time_utc=120)
    params[field] = value
    with pytest.raises(ValueError):
        change_replay_protection(before, **params)
    assert before.model_dump(mode='json') == serialized


def test_queued_order_can_change_protection_without_filling():
    queued = queue_market_order(initial_state(), operation_id='open-1', side='SELL', quantity='.1', stop_loss='1.12', take_profit='1.09')
    changed = amend(queued)
    assert changed.position is None
    assert changed.pending_market_order.stop_loss == Decimal('1.11')
    assert changed.pending_market_order.submitted_cursor_index == 0
    assert changed.balance == queued.balance
    with pytest.raises(ValueError, match='already consumed'):
        change_replay_protection(queued, target_id='open-1', operation_id='open-1',
            stop_loss='1.11', take_profit='1.095', mid_close='1.102', virtual_time_utc=120)


@pytest.mark.parametrize('side,stop,target', [('BUY', '1.10235', '1.115'), ('SELL', '1.10265', '1.095')])
def test_protection_brackets_adversely_rounded_quote_instead_of_unrounded_mid(side, stop, target):
    state = opened(side)
    with pytest.raises(ValueError, match='closeable quote'):
        change_replay_protection(state, target_id=state.position.position_id, operation_id='fractional-tick',
            stop_loss=stop, take_profit=target, mid_close='1.10249' if side == 'BUY' else '1.10251', virtual_time_utc=120)


def test_protection_checkpoint_is_typed_and_versioned_with_margin_execution():
    from foundation_v2.tests.test_replay_margin_v2 import MARGIN
    from trading_workspace_v2.replay_execution import ReplayExecutionSnapshotV2
    state = initial_state()
    state = ReplayExecutionSnapshotV2.model_validate({**state.model_dump(mode='json'),
        'schema_version': 'replay-execution-v2', 'research_margin': MARGIN})
    queued = queue_market_order(state, operation_id='open-1', side='BUY', quantity='.1', stop_loss='1.09', take_profit='1.12')
    opened_state = advance_replay_execution(queued, bar={'timestamp': 60, 'open': 1.1, 'high': 1.105,
        'low': 1.099, 'close': 1.102}, cursor_index=1).snapshot
    changed = amend(opened_state)
    assert changed.ledger[-1]['schema_version'] == 'replay-execution-event-v2'
    assert parse_replay_execution_snapshot(changed.model_dump(mode='json')) == changed
    tampered = deepcopy(changed.model_dump(mode='json'))
    tampered['ledger'][-1]['details']['target_id'] = 'other-position'
    with pytest.raises(ValueError): parse_replay_execution_snapshot(tampered)


def test_service_revision_tenant_future_guard_and_historical_projection():
    rows = [{'timestamp': BASE_TIME + n * 60, 'open': 1.102, 'high': 1.105, 'low': 1.1015,
             'close': 1.103, 'volume': 10} for n in range(4)]
    store = FakeStore(rows)
    service = ReplayService(store, FakeArtifacts(rows))
    created = service.create('tenant-a', 'dataset-1', 0)
    sid = created['record_id']
    initialized = service.initialize_execution('tenant-a', sid, created['revision'], instrument_spec=instrument_mapping(),
        cost_model=cost_mapping(), spread_price='.0002', timeframe_seconds=60, starting_balance='100000')
    queued = service.queue_market_order('tenant-a', sid, initialized['revision'], operation_id='open-1', side='BUY',
        quantity='.1', stop_loss='1.09', take_profit='1.12')
    stepped = service.step('tenant-a', sid, queued['revision'])
    target_id = stepped['payload']['execution']['position']['position_id']
    params = dict(target_id=target_id, operation_id='edit-1', stop_loss='1.101', take_profit='1.115')
    with pytest.raises(LookupError): service.change_protection('other', sid, stepped['revision'], **params)
    changed = service.change_protection('tenant-a', sid, stepped['revision'], **params)
    with pytest.raises(RuntimeError): service.change_protection('tenant-a', sid, stepped['revision'], **params)
    later = service.step('tenant-a', sid, changed['revision'])
    history = service.view('tenant-a', sid, cursor_index=1)
    assert history['payload']['execution'] == changed['payload']['execution']
    assert history['payload']['execution']['event_sequence'] < later['payload']['execution']['event_sequence']
    assert history['execution_view_status'] == 'checkpoint'
    terminal = service.step('tenant-a', sid, later['revision'])
    with pytest.raises(ValueError, match='future replay bar'):
        service.change_protection('tenant-a', sid, terminal['revision'], **params)


def test_historical_before_execution_initialization_stays_unknown():
    rows = [{'timestamp': BASE_TIME + n * 60, 'open': 1.1, 'high': 1.101, 'low': 1.099, 'close': 1.1, 'volume': 10} for n in range(4)]
    store = FakeStore(rows); service = ReplayService(store, FakeArtifacts(rows))
    created = service.create('tenant-a', 'dataset-1', 2)
    service.initialize_execution('tenant-a', created['record_id'], created['revision'], instrument_spec=instrument_mapping(),
        cost_model=cost_mapping(), spread_price='.0002', timeframe_seconds=60, starting_balance='100000')
    history = service.view('tenant-a', created['record_id'], cursor_index=0)
    assert history['payload']['execution'] is None
    assert history['execution_view_status'] == 'unavailable'
