"""Bounded dashboard card projection; persisted execution remains the financial owner."""
from __future__ import annotations

from collections import OrderedDict, defaultdict
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
from threading import RLock

from .analytics_read_model import AnalyticsValidationError, _timestamp
from .contracts import ReplaySessionCatalogItem
from .replay_analytics import build_replay_analytics_view


class DashboardRevisionConflict(RuntimeError):
    pass


class DashboardSummaryCache:
    """Only retain compact summaries, never bars or execution ledgers."""
    def __init__(self, max_items=256, max_bytes=8 * 1024 * 1024):
        self.max_items, self.max_bytes = max_items, max_bytes
        self.items, self.bytes, self.lock = OrderedDict(), 0, RLock()

    def read(self, workspace, record):
        digest = sha256(json.dumps(record['payload'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        key = (workspace, record['record_id'], record['revision'], digest)
        with self.lock:
            cached = self.items.get(key)
            if cached is not None:
                self.items.move_to_end(key)
                return deepcopy(cached[0])
            # Single flight per process also bounds simultaneous canonical computations.
            summary = build_session_summary(record, workspace)
            size = len(json.dumps(summary, separators=(',', ':')).encode())
            if size <= self.max_bytes:
                self.items[key] = (summary, size)
                self.bytes += size
                while len(self.items) > self.max_items or self.bytes > self.max_bytes:
                    _, (_, removed) = self.items.popitem(last=False)
                    self.bytes -= removed
            return deepcopy(summary)


_SUMMARIES = DashboardSummaryCache()


def replay_metadata(record, workspace):
    """Settings fields only; price rows, positions and raw events are excluded."""
    payload = record['payload']
    execution = payload.get('execution') or {}
    ledger = execution.get('ledger') or []
    cutoff = payload.get('replay_clock_utc') or (ledger[-1].get('virtual_time_utc') if ledger else None)
    config = {key: payload[key] for key in ('dataset_id', 'dataset_ids', 'name', 'description', 'playbook_id',
              'playbook_revision', 'starting_balance', 'starting_balance_ccy', 'cursor_index') if key in payload}
    config['execution'] = {key: execution[key] for key in ('starting_balance', 'balance', 'cost_model',
                            'spread_price', 'instrument_spec') if key in execution} if execution else None
    portfolio = {}
    if payload.get('asset_states'):
        from .replay_portfolio import account
        portfolio = {'portfolio_account': account(payload)}
    return {**portfolio, 'schema_version': 'replay-metadata-v1', 'workspace_id': workspace,
            'record_id': record['record_id'], 'revision': record['revision'],
            'cutoff_timestamp': cutoff, 'payload': config, 'freshness': 'current_revision'}


def build_session_summary(record, workspace):
    metadata = replay_metadata(record, workspace)
    try:
        view = build_replay_analytics_view({**record, 'workspace_id': workspace})
    except (AnalyticsValidationError, KeyError, TypeError, ValueError, ArithmeticError):
        return {'status': 'error', 'revision': record['revision'], 'unavailable': True,
                'strategy': record['payload'].get('playbook_id'), 'pnl': None, 'currency': None,
                'metadata': metadata, 'reason': 'replay_analytics_source_invalid'}
    metrics = {key: value for key, value in view['metrics'].items()
               if not isinstance(value, (list, dict))}
    raw_curve = view['metrics'].get('closed_trade_balance_curve') or []
    # Keep original trade sequence and exact endpoints. Sampling is display-only;
    # KPI/drawdown values above always use the canonical complete ledger.
    indices = sorted({round(i * (len(raw_curve) - 1) / 127) for i in range(128)}) if len(raw_curve) > 128 else range(len(raw_curve))
    curve = {'points': [raw_curve[i] for i in indices], 'total_points': len(raw_curve),
             'sampled': len(raw_curve) > 128, 'method': 'uniform_trade_sequence',
             'minimum_balance': min((p['closed_trade_balance'] for p in raw_curve), default=None),
             'maximum_balance': max((p['closed_trade_balance'] for p in raw_curve), default=None)}
    months, weekdays = defaultdict(float), [0.0] * 7
    incomplete = False
    for trade in view['ledger']:
        close = _timestamp(trade.get('close_time_utc'), 'close_time_utc')
        if close is None:
            incomplete = True
            continue
        months[close.strftime('%Y-%m')] += trade['net_pnl']
        weekdays[close.weekday()] += trade['net_pnl']
    periods = {'months': [{'label': k, 'value': v} for k, v in sorted(months.items())[-12:]],
               'weekdays': [{'label': k, 'value': v} for k, v in zip(('T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'), weekdays)],
               'incomplete': incomplete, 'total_months': len(months)}
    return {'status': 'ready', 'revision': record['revision'], 'strategy': record['payload'].get('playbook_id'),
            'pnl': metrics.get('net_pnl') if view['analytics_available'] else None,
            'currency': view.get('account_currency'), 'metadata': metadata,
            'analytics_available': view['analytics_available'], 'metrics': metrics, 'curve': curve,
            'periods': periods, 'provenance': view['provenance'], 'blocked_by_data': view['blocked_by_data']}


def build_dashboard_sessions(records, datasets, workspace, *, page=1, page_size=6, search='',
                             sort='newest', asset='', strategy='', revision=None, cache=None):
    if isinstance(page, bool) or not isinstance(page, int) or page < 1 or isinstance(page_size, bool) or not isinstance(page_size, int) or not 1 <= page_size <= 25:
        raise ValueError('invalid_dashboard_page')
    if sort not in ('newest', 'oldest', 'last', 'profit') or len(search) > 256 or len(asset) > 128 or len(strategy) > 128:
        raise ValueError('invalid_dashboard_filters')
    manifests = {entry.dataset_id: entry for entry in datasets}
    stamp = sha256(json.dumps({'workspace': workspace, 'records': sorted((r['record_id'], r['revision']) for r in records),
                  'datasets': sorted((m.dataset_id, m.artifact_sha256) for m in datasets)}, sort_keys=True).encode()).hexdigest()
    if revision and revision != stamp:
        raise DashboardRevisionConflict('dashboard_revision_changed')
    cache = cache or _SUMMARIES
    items, source_records = [], {}
    for record in records:
        payload = record['payload']
        dataset_id = payload.get('dataset_id')
        ids = payload.get('dataset_ids') or ([dataset_id] if dataset_id else [])
        manifest = manifests.get(dataset_id)
        linked = [manifests.get(key) for key in ids]
        item = ReplaySessionCatalogItem(record_id=record['record_id'], revision=record['revision'],
            name=payload.get('name', ''), description=payload.get('description', ''), archived=payload.get('archived', False),
            dataset_id=dataset_id, dataset_ids=ids, instrument_ids=[m.instrument_id for m in linked if m],
            instrument_id=manifest.instrument_id if manifest else None, timeframe=manifest.timeframe if manifest else None,
            timeframe_seconds=manifest.timeframe_seconds if manifest else None, row_count=manifest.row_count if manifest else None,
            cursor_index=payload.get('cursor_index', 0), status=payload.get('status', 'unknown'),
            branch_id=payload.get('branch_id'), parent_session_id=payload.get('parent_session_id'), parent_revision=payload.get('parent_revision'),
            dataset_available=bool(linked) and all(m is not None for m in linked),
            has_execution=bool(payload.get('execution')) or any(s.get('execution') for s in payload.get('asset_states', {}).values()),
            created_at_utc=record['created_at_utc'], updated_at_utc=record['updated_at_utc']).model_dump(mode='json')
        item['strategy'] = payload.get('playbook_id')
        if not item['archived']:
            items.append(item)
        source_records[record['record_id']] = record
    facets = {'assets': sorted({symbol for item in items for symbol in item['instrument_ids']}),
              'strategies': sorted({item['strategy'] for item in items if item['strategy']}),
              'unassigned': any(item['strategy'] is None for item in items)}
    needle = search.strip().casefold()
    selected = [item for item in items if (not needle or needle in (' '.join(str(item.get(k) or '') for k in ('name', 'record_id', 'instrument_id', 'timeframe')) + ' ' + ' '.join(item['instrument_ids'])).casefold())
                and (not asset or asset in item['instrument_ids'])
                and (not strategy or (item['strategy'] is None if strategy == 'unassigned' else item['strategy'] == strategy))]
    def timestamp(item):
        return item.get('updated_at_utc' if sort == 'last' else 'created_at_utc') or ''
    selected.sort(key=lambda item: item['record_id'])
    selected.sort(key=timestamp, reverse=sort != 'oldest')
    comparable = True
    summaries = {}
    if sort == 'profit':
        summaries = {item['record_id']: cache.read(workspace, source_records[item['record_id']]) for item in selected}
        currencies = {value['currency'] for value in summaries.values() if value['pnl'] is not None}
        comparable = len(currencies) <= 1 and all(currencies)
        if comparable:
            selected.sort(key=lambda item: (summaries[item['record_id']]['pnl'] is None, -(summaries[item['record_id']]['pnl'] or 0), item['record_id']))
    count = len(selected)
    pages = max(1, (count + page_size - 1) // page_size)
    page = min(page, pages)
    visible = selected[(page - 1) * page_size:page * page_size]
    for item in visible:
        item['detail'] = summaries.get(item['record_id']) or cache.read(workspace, source_records[item['record_id']])
        manifest = manifests.get(item['dataset_id'])
        item['dataset'] = {key: getattr(manifest, key) for key in ('dataset_id', 'instrument_id', 'timeframe', 'row_count', 'first_timestamp', 'last_timestamp')} if manifest else None
    summary_values = list(summaries.values()) if sort == 'profit' else [item['detail'] for item in visible]
    unavailable = sum(value.get('unavailable', False) for value in summary_values)
    return {'status': 'partial' if unavailable else 'ready', 'summary_unavailable_count': unavailable,
            'summary_scope_count': len(summary_values), 'schema_version': 'dashboard-session-list-v1', 'workspace_id': workspace, 'revision': stamp,
            'as_of_utc': datetime.now(timezone.utc).isoformat(), 'items': visible, 'facets': facets,
            'total': len(items), 'matching_count': count, 'page': page, 'page_size': page_size, 'pages': pages,
            'profit_comparable': comparable, 'freshness': 'current_revision'}


def read_dashboard_sessions(store, workspace, **filters):
    return build_dashboard_sessions(store.list_records(workspace, 'replay'), store.list_datasets(workspace), workspace, **filters)


def read_replay_metadata(store, workspace, session_id):
    record = store.get_record(workspace, 'replay', session_id)
    if record is None:
        raise LookupError('replay_not_found')
    return replay_metadata(record, workspace)
