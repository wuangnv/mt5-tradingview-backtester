"""One persisted replay clock/account with immutable per-instrument execution state."""

from bisect import bisect_right
from copy import deepcopy
from decimal import Decimal
from uuid import uuid4

from .replay_execution import advance_replay_execution, parse_replay_execution_snapshot, fork_replay_execution_checkpoint
from .replay_interval import next_interval_cursor


def closed_time(manifest, row):
    seconds = manifest.timeframe_seconds
    if not seconds or seconds <= 0:
        raise ValueError('multi-asset replay requires a declared bar timeframe')
    return int(row['timestamp']) + int(seconds)


def cursor_at(manifest, rows, clock):
    return bisect_right(rows, clock, key=lambda row: closed_time(manifest, row)) - 1


def initialize_portfolio(service, workspace, payload, dataset_ids):
    if (not isinstance(dataset_ids, list) or not 1 <= len(dataset_ids) <= 12
            or any(not isinstance(key, str) or not key.strip() for key in dataset_ids)
            or len(set(dataset_ids)) != len(dataset_ids) or payload['dataset_id'] != dataset_ids[0]):
        raise ValueError('choose unique datasets with the primary dataset first')
    if len(dataset_ids) == 1:
        return payload
    assets = {key: service._dataset_rows(workspace, key) for key in dataset_ids}
    symbols = [manifest.instrument_id for manifest, _ in assets.values()]
    if len(set(symbols)) != len(symbols):
        raise ValueError('choose one immutable dataset version per instrument')
    currencies = {(manifest.instrument_spec or {}).get('account_ccy', 'USD') for manifest, _ in assets.values()}
    if len(currencies) != 1:
        raise ValueError('all replay assets must use the same account currency')
    manifest, rows = assets[payload['dataset_id']]
    begin = max(closed_time(m, r[0]) for m, r in assets.values())
    clock = max(begin, closed_time(manifest, rows[payload['cursor_index']]))
    end = min(closed_time(m, r[-1]) for m, r in assets.values())
    if clock >= end:
        raise ValueError('assets have no common replay period with future bars')
    states = {key: {'cursor_index': cursor_at(m, r, clock), 'execution': None}
              for key, (m, r) in assets.items()}
    return {**payload, 'dataset_ids': dataset_ids, 'asset_states': states,
            'cursor_index': states[payload['dataset_id']]['cursor_index'],
            'replay_clock_utc': clock, 'replay_start_utc': clock, 'replay_end_utc': end}


def sync_active_state(payload):
    payload = deepcopy(payload)
    payload['asset_states'][payload['dataset_id']] = {
        'cursor_index': payload['cursor_index'], 'execution': payload.get('execution')}
    return payload


def account(payload):
    initial = Decimal(payload.get('starting_balance', '10000'))
    balance, floating, positions, pending = initial, Decimal(0), 0, 0
    for state in payload['asset_states'].values():
        raw = state.get('execution')
        if raw:
            snapshot = parse_replay_execution_snapshot(raw)
            if snapshot.starting_balance != initial:
                raise ValueError('portfolio starting balance is inconsistent')
            balance += snapshot.balance - initial
            floating += snapshot.floating_pl
            positions += int(snapshot.position is not None)
            pending += int(snapshot.pending_market_order is not None)
    return {'starting_balance': str(initial), 'balance': str(balance), 'floating_pl': str(floating), 'equity': str(balance + floating),
            'account_ccy': payload.get('starting_balance_ccy', 'USD'),
            'open_position_count': positions, 'pending_order_count': pending}


def select_asset(service, workspace, session_id, revision, dataset_id):
    record = service.store.get_record(workspace, 'replay', session_id)
    if record is None:
        raise LookupError('replay session not found')
    if record['revision'] != revision:
        raise RuntimeError('record revision conflict')
    payload = deepcopy(record['payload'])
    if dataset_id not in payload.get('asset_states', {}):
        raise ValueError('asset is not part of this replay session')
    service._dataset_rows(workspace, dataset_id)
    state = payload['asset_states'][dataset_id]
    payload.update(dataset_id=dataset_id, cursor_index=state['cursor_index'], execution=state.get('execution'))
    service._update_payload(workspace, session_id, revision, payload)
    return service.view(workspace, session_id)


def step_portfolio(service, workspace, record, steps, interval):
    payload = deepcopy(record['payload'])
    if isinstance(steps, bool) or not isinstance(steps, int) or not 1 <= steps <= 1000:
        raise ValueError('replay steps must be an integer between 1 and 1000')
    assets = {key: service._dataset_rows(workspace, key) for key in payload['dataset_ids']}
    manifest, rows = assets[payload['dataset_id']]
    current = payload['cursor_index']
    if interval is not None:
        if steps != 1:
            raise ValueError('choose either replay interval or a bar count')
        next_cursor = next_interval_cursor(rows, current, len(rows) - 1, interval, manifest.timeframe_seconds)
    else:
        next_cursor = min(current + steps, len(rows) - 1)
    clock = min(closed_time(manifest, rows[next_cursor]), payload['replay_end_utc'])
    events = []
    for key, (manifest, rows) in assets.items():
        state = payload['asset_states'][key]
        target = cursor_at(manifest, rows, clock)
        execution = parse_replay_execution_snapshot(state['execution']) if state.get('execution') else None
        if execution and execution.cursor_index != state['cursor_index']:
            raise RuntimeError('portfolio execution cursor is inconsistent')
        for cursor in range(state['cursor_index'] + 1, target + 1):
            if execution:
                advanced = advance_replay_execution(execution, bar=rows[cursor], cursor_index=cursor)
                execution = advanced.snapshot
                events.extend(event.model_dump(mode='json') for event in advanced.events)
        state.update(cursor_index=target, execution=execution.model_dump(mode='json') if execution else None)
    elapsed = max(0, clock - payload['replay_clock_utc'])
    payload['timing']['historical_time_replayed_seconds'] += elapsed
    payload.update(replay_clock_utc=clock, status='completed' if clock >= payload['replay_end_utc'] else 'paused')
    active = payload['asset_states'][payload['dataset_id']]
    payload.update(cursor_index=active['cursor_index'], execution=active.get('execution'))
    service._update_payload(workspace, record['record_id'], record['revision'], payload)
    result = service.view(workspace, record['record_id'])
    result['execution_events'] = sorted(events, key=lambda event: (event['virtual_time_utc'], event['dataset_id'], event['sequence']))
    return result


def checkpoint_portfolio(service, workspace, record, cursor=None, cutoff=None, event_sequence=None):
    if event_sequence is not None:
        raise ValueError('multi-asset checkpoints use the shared replay time, not a local event sequence')
    payload = deepcopy(record['payload'])
    canonical = payload['cursor_index']
    manifest, rows = service._dataset_rows(workspace, payload['dataset_id'])
    if cutoff is not None:
        if isinstance(cutoff, bool) or not isinstance(cutoff, int):
            raise ValueError('analytics cutoff must be an integer bar timestamp')
        if not int(rows[0]['timestamp']) <= cutoff <= int(rows[canonical]['timestamp']):
            raise ValueError('analytics cutoff is outside the visible replay range')
        index = bisect_right(rows, cutoff, key=lambda row: int(row['timestamp'])) - 1
        if cursor is not None and cursor != index:
            raise ValueError('analytics cursor and cutoff disagree')
        cursor = index
    cursor = canonical if cursor is None else cursor
    if isinstance(cursor, bool) or not isinstance(cursor, int) or not 0 <= cursor <= canonical:
        raise ValueError('analytics cursor is outside the visible replay range')
    clock = payload['replay_clock_utc'] if cursor == canonical else closed_time(manifest, rows[cursor])
    if cursor < canonical:
        for key, state in payload['asset_states'].items():
            m, bars = service._dataset_rows(workspace, key)
            target = cursor_at(m, bars, clock)
            snapshot = parse_replay_execution_snapshot(state['execution']) if state.get('execution') else None
            if target < 0:
                snapshot = None
            if snapshot and target != snapshot.cursor_index:
                try:
                    snapshot = service._checkpoint(snapshot, cursor_index=target)
                except ValueError as exc:
                    if str(exc) != 'execution branch cursor has no canonical checkpoint':
                        raise
                    snapshot = None
                    for prior in reversed(service.store.list_record_revisions(workspace, 'replay', record['record_id'])):
                        candidate = prior['payload'].get('asset_states', {}).get(key, {})
                        if candidate.get('cursor_index') == target and candidate.get('execution'):
                            candidate_snapshot = parse_replay_execution_snapshot(candidate['execution'])
                            current_snapshot = parse_replay_execution_snapshot(state['execution'])
                            for field in ('replay_session_id', 'branch_id', 'dataset_id', 'dataset_sha256',
                                          'instrument_spec', 'cost_model', 'spread_price', 'timeframe_seconds', 'starting_balance'):
                                if getattr(candidate_snapshot, field) != getattr(current_snapshot, field):
                                    raise ValueError('historical portfolio checkpoint lineage is inconsistent')
                            snapshot = candidate_snapshot
                            break
                    if snapshot is None and state['execution']['ledger'] and target >= state['execution']['ledger'][0]['cursor_index']:
                        raise ValueError('historical portfolio checkpoint is unavailable')
            state.update(cursor_index=target, execution=snapshot.model_dump(mode='json') if snapshot else None)
        payload['replay_clock_utc'] = clock
    active = payload['asset_states'][payload['dataset_id']]
    payload.update(cursor_index=cursor, execution=active.get('execution'))
    trade_cursors = {}
    for key, state in payload['asset_states'].items():
        if state.get('execution'):
            m, bars = service._dataset_rows(workspace, key)
            for event in state['execution']['ledger']:
                if event['kind'] == 'protective_fill':
                    trade_cursors[f"{key}:{event['sequence']}"] = cursor_at(manifest, rows, closed_time(m, bars[event['cursor_index']]))
    return {**record, 'payload': payload, 'portfolio_trade_cursors': trade_cursors, 'view_cursor_index': cursor,
            'canonical_cursor_index': canonical, 'historical_view': cursor < canonical,
            'canonical_execution_event_sequence': None}


def branch_portfolio(service, workspace, record, cursor):
    checkpoint = checkpoint_portfolio(service, workspace, record, cursor)
    payload = deepcopy(checkpoint['payload'])
    if payload['replay_clock_utc'] < payload['replay_start_utc']:
        raise ValueError('portfolio branch must remain within the common replay period')
    child, branch = uuid4().hex, uuid4().hex
    payload.update(branch_id=branch, parent_session_id=record['record_id'], parent_revision=record['revision'], status='paused')
    payload['parent_asset_checkpoint_sequences'] = {
        key: state['execution']['event_sequence'] if state.get('execution') else 0
        for key, state in payload['asset_states'].items()}
    from .replay_activity import new_timing
    payload['timing'] = new_timing()
    for state in payload['asset_states'].values():
        if state.get('execution'):
            snapshot = parse_replay_execution_snapshot(state['execution'])
            state['execution'] = fork_replay_execution_checkpoint(snapshot, replay_session_id=child, branch_id=branch).model_dump(mode='json')
    payload['execution'] = payload['asset_states'][payload['dataset_id']].get('execution')
    created = service.store.create_replay_branch_record(workspace, record['record_id'], record['revision'], child, payload)
    return service.view(workspace, created['record_id'])
