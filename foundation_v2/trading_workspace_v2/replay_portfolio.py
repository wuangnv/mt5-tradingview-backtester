"""One persisted replay clock/account with immutable per-instrument execution state."""

from bisect import bisect_right
from copy import deepcopy
from decimal import Decimal
from uuid import uuid4

from .replay_execution import advance_replay_execution, parse_replay_execution_snapshot, fork_replay_execution_checkpoint


def closed_time(manifest, row):
    seconds = manifest.timeframe_seconds
    if not seconds or seconds <= 0:
        raise ValueError('multi-asset replay requires a declared bar timeframe')
    return int(row['timestamp']) + int(seconds)


def cursor_at(manifest, rows, clock):
    return bisect_right(rows, clock, key=lambda row: closed_time(manifest, row)) - 1


def initialize_portfolio(service, workspace, payload, dataset_ids, *, primary=None, start_timestamp=None, end_timestamp=None):
    if (not isinstance(dataset_ids, list) or not 1 <= len(dataset_ids) <= 12
            or any(not isinstance(key, str) or not key.strip() for key in dataset_ids)
            or len(set(dataset_ids)) != len(dataset_ids) or payload['dataset_id'] != dataset_ids[0]):
        raise ValueError('choose unique datasets with the primary dataset first')
    if len(dataset_ids) == 1:
        return payload
    assets = {key: primary if key == payload['dataset_id'] and primary is not None
              else service._dataset_timing(workspace, key, index=payload['cursor_index'] if key == payload['dataset_id'] else 0)
              for key in dataset_ids}
    symbols = [manifest.instrument_id for manifest, _ in assets.values()]
    if len(set(symbols)) != len(symbols):
        raise ValueError('choose one immutable dataset version per instrument')
    currencies = {(manifest.instrument_spec or {}).get('account_ccy', 'USD') for manifest, _ in assets.values()}
    if len(currencies) != 1:
        raise ValueError('all replay assets must use the same account currency')
    if start_timestamp is not None or end_timestamp is not None:
        return initialize_period_portfolio(service, workspace, payload, dataset_ids, assets, start_timestamp, end_timestamp)
    manifest, timing = assets[payload['dataset_id']]
    begin = max(closed_time(m, {'timestamp': t['first_utc']}) for m, t in assets.values())
    clock = max(begin, closed_time(manifest, {'timestamp': timing['index_utc']}))
    end = min(closed_time(m, {'timestamp': t['last_utc']}) for m, t in assets.values())
    if clock >= end:
        raise ValueError('assets have no common replay period with future bars')
    states = {key: {'cursor_index': service._dataset_timing(workspace, key,
                  at_or_before=clock - int(m.timeframe_seconds))[1]['cursor_index'], 'execution': None}
              for key, (m, _) in assets.items()}
    return {**payload, 'dataset_ids': dataset_ids, 'asset_states': states,
            'cursor_index': states[payload['dataset_id']]['cursor_index'],
            'replay_clock_utc': clock, 'replay_start_utc': clock, 'replay_end_utc': end}


def initialize_period_portfolio(service, workspace, payload, dataset_ids, assets, requested_start, requested_end):
    common_first = max(timing['first_utc'] for _, timing in assets.values())
    common_last = min(timing['last_utc'] for _, timing in assets.values())
    if any(value is not None and not common_first <= value <= common_last for value in (requested_start, requested_end)):
        raise ValueError('requested replay period is outside common dataset range')
    end_cutoff = common_last if requested_end is None else min(common_last, requested_end)
    manifest, primary = assets[payload['dataset_id']]
    start_cutoff = max(common_first, requested_start if requested_start is not None else primary['index_utc'])
    if start_cutoff >= end_cutoff:
        raise ValueError('assets have no common replay period with future bars')
    selected = service._dataset_timing(workspace, payload['dataset_id'], at_or_before=start_cutoff - 1)[1]['cursor_index'] + 1
    if selected >= primary['row_count']:
        raise ValueError('start_timestamp is outside the common dataset period')
    selected_time = service._dataset_timing(workspace, payload['dataset_id'], index=selected)[1]['index_utc']
    if selected_time > end_cutoff:
        raise ValueError('start_timestamp is outside the common dataset period')
    begin = max(closed_time(m, {'timestamp': timing['first_utc']}) for m, timing in assets.values())
    clock = max(begin, closed_time(manifest, {'timestamp': selected_time}))
    terminal = {}
    for key, (m, timing) in assets.items():
        index = service._dataset_timing(workspace, key, at_or_before=end_cutoff)[1]['cursor_index']
        if index < 0:
            raise ValueError('end_timestamp is outside the common dataset period')
        timestamp = service._dataset_timing(workspace, key, index=index)[1]['index_utc']
        terminal[key] = closed_time(m, {'timestamp': timestamp})
    end_clock = min(terminal.values())
    if clock >= end_clock:
        raise ValueError('selected replay period has no future closed bars')
    states, bounds = {}, {}
    for key, (m, _) in assets.items():
        results = service._dataset_timings(workspace, key, [
            {'at_or_before': clock - m.timeframe_seconds}, {'at_or_before': end_clock - m.timeframe_seconds}])
        start, end = (value['cursor_index'] for value in results)
        if start < 0 or end < start:
            raise ValueError('assets have no common closed-bar replay period')
        times = service._dataset_timings(workspace, key, [{'index': start}, {'index': end}])
        bounds[key] = {'start_cursor_index': start, 'end_cursor_index': end,
                      'start_timestamp': times[0]['index_utc'], 'end_timestamp': times[1]['index_utc']}
        states[key] = {'cursor_index': start, 'execution': None}
    active = bounds[payload['dataset_id']]
    if not common_first <= active['start_timestamp'] <= common_last:
        raise ValueError('start_timestamp is outside the common dataset period')
    period = {'schema_version': 'replay-period-v1', 'requested_start_timestamp': requested_start,
              'requested_end_timestamp': requested_end, 'start_timestamp': active['start_timestamp'],
              'end_timestamp': end_cutoff, 'start_clock_utc': clock, 'end_clock_utc': end_clock,
              'asset_bounds': bounds}
    return {**payload, 'dataset_ids': dataset_ids, 'asset_states': states,
            'cursor_index': active['start_cursor_index'], 'replay_clock_utc': clock,
            'replay_start_utc': clock, 'replay_end_utc': end_clock, 'session_period': period}


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
    service._dataset_timing(workspace, dataset_id, index=payload['asset_states'][dataset_id]['cursor_index'])
    state = payload['asset_states'][dataset_id]
    if payload.get('session_period'):
        bounds = service._period_bounds({**payload, 'dataset_id': dataset_id})
        if not bounds['start_cursor_index'] <= state['cursor_index'] <= bounds['end_cursor_index']:
            raise RuntimeError('stored replay cursor exceeds its session period')
    payload.update(dataset_id=dataset_id, cursor_index=state['cursor_index'], execution=state.get('execution'))
    service._update_payload(workspace, session_id, revision, payload)
    return service.view(workspace, session_id)


def step_portfolio(service, workspace, record, steps, interval):
    payload = deepcopy(record['payload'])
    if isinstance(steps, bool) or not isinstance(steps, int) or not 1 <= steps <= 1000:
        raise ValueError('replay steps must be an integer between 1 and 1000')
    current = payload['cursor_index']
    bounds = service._period_bounds(payload)
    if bounds and not bounds['start_cursor_index'] <= current <= bounds['end_cursor_index']:
        raise RuntimeError('stored replay cursor exceeds its session period')
    if bounds and payload['replay_clock_utc'] >= payload['replay_end_utc']:
        raise ValueError('selected replay period is completed')
    manifest, rows, cursor, _ = service._step_window(workspace, payload['dataset_id'], current, steps, interval,
        limit=bounds['end_cursor_index'] if bounds else None)
    period_exhausted = bounds and (current >= bounds['end_cursor_index'] or
        (interval is None and current + steps > bounds['end_cursor_index']) or
        (interval is not None and int(rows[-1]['timestamp']) < (int(rows[0]['timestamp']) // interval + 1) * interval))
    clock = (payload['replay_end_utc'] if period_exhausted else
             min(closed_time(manifest, rows[-1]), payload['replay_end_utc']))
    events = []
    for key in payload['dataset_ids']:
        state = payload['asset_states'][key]
        manifest = service.store.get_dataset(workspace, key)
        if manifest is None:
            raise LookupError('dataset not found')
        target = service._dataset_timing(workspace, key, at_or_before=clock - manifest.timeframe_seconds)[1]['cursor_index']
        if bounds:
            limit = service._period_bounds({**payload, 'dataset_id': key})['end_cursor_index']
            if target > limit:
                raise RuntimeError('portfolio replay clock exceeds its session period')
        execution = parse_replay_execution_snapshot(state['execution']) if state.get('execution') else None
        if execution and execution.cursor_index != state['cursor_index']:
            raise RuntimeError('portfolio execution cursor is inconsistent')
        if execution:
            # Inactive assets can cross many bars in one active-asset step. Keep
            # every execution event while bounding the decoded window.
            for begin in range(state['cursor_index'] + 1, target + 1, 1000):
                _, window = service._dataset_slice(workspace, key, begin, min(begin + 1000, target + 1))
                for cursor, bar in enumerate(window, begin):
                    advanced = advance_replay_execution(execution, bar=bar, cursor_index=cursor)
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
    manifest, timing = service._dataset_timing(workspace, payload['dataset_id'], index=canonical)
    if cutoff is not None:
        if isinstance(cutoff, bool) or not isinstance(cutoff, int):
            raise ValueError('analytics cutoff must be an integer bar timestamp')
        if not timing['first_utc'] <= cutoff <= timing['index_utc']:
            raise ValueError('analytics cutoff is outside the visible replay range')
        index = service._dataset_timing(workspace, payload['dataset_id'], at_or_before=cutoff)[1]['cursor_index']
        if cursor is not None and cursor != index:
            raise ValueError('analytics cursor and cutoff disagree')
        cursor = index
    cursor = canonical if cursor is None else cursor
    if isinstance(cursor, bool) or not isinstance(cursor, int) or not 0 <= cursor <= canonical:
        raise ValueError('analytics cursor is outside the visible replay range')
    clock = payload['replay_clock_utc'] if cursor == canonical else closed_time(manifest,
        {'timestamp': service._dataset_timing(workspace, payload['dataset_id'], index=cursor)[1]['index_utc']})
    if cursor < canonical:
        for key, state in payload['asset_states'].items():
            m = service.store.get_dataset(workspace, key)
            target = service._dataset_timing(workspace, key, at_or_before=clock - m.timeframe_seconds)[1]['cursor_index']
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
    trade_events, cutoffs = [], []
    for key, state in payload['asset_states'].items():
        if state.get('execution'):
            m = service.store.get_dataset(workspace, key)
            events = [event for event in state['execution']['ledger'] if event['kind'] == 'protective_fill']
            if events:
                timings = service._dataset_timings(workspace, key, [{'index': event['cursor_index']} for event in events])
                for event, timing in zip(events, timings):
                    trade_events.append(f"{key}:{event['sequence']}")
                    cutoffs.append({'at_or_before': timing['index_utc'] + m.timeframe_seconds - manifest.timeframe_seconds})
    if cutoffs:
        trade_cursors = {event: timing['cursor_index'] for event, timing in zip(trade_events,
            service._dataset_timings(workspace, payload['dataset_id'], cutoffs))}
    return {**record, 'payload': payload, 'portfolio_trade_cursors': trade_cursors, 'view_cursor_index': cursor,
            'canonical_cursor_index': canonical, 'historical_view': cursor < canonical,
            'canonical_execution_event_sequence': None}


def branch_portfolio(service, workspace, record, cursor):
    bounds = service._period_bounds(record['payload'])
    if bounds and cursor < bounds['start_cursor_index']:
        raise ValueError('branch cursor is before the selected replay period')
    checkpoint = checkpoint_portfolio(service, workspace, record, cursor)
    payload = deepcopy(checkpoint['payload'])
    if payload['replay_clock_utc'] < payload['replay_start_utc']:
        raise ValueError('portfolio branch must remain within the common replay period')
    child, branch = uuid4().hex, uuid4().hex
    payload.update(branch_id=branch, parent_session_id=record['record_id'], parent_revision=record['revision'], status='paused')
    if bounds and payload['replay_clock_utc'] >= payload['replay_end_utc']:
        payload['status'] = 'completed'
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
