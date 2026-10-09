"""Paged table projection; financial reports continue using the full read model."""

from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime, timezone
from functools import cmp_to_key
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .analytics_read_model import AnalyticsValidationError

KEYS = {
    'asset', 'tag', 'strategy', 'source', 'weekday', 'hour', 'timeStart', 'timeEnd',
    'reportKinds', 'timezone', 'search', 'notes', 'assets', 'sides', 'outcomes',
    'types', 'years', 'months', 'days', 'hours', 'tagInclude', 'tagExclude',
    'tagIncludeMode', 'tagExcludeMode',
}
LISTS = {'reportKinds', 'assets', 'sides', 'outcomes', 'types', 'years', 'months', 'days', 'hours', 'tagInclude', 'tagExclude'}
SORT_KEYS = {'session_id', 'status', 'source', 'recorded_at_utc', 'open_time_utc', 'symbol', 'side', 'entry_type', 'net_pnl', 'return_pct', 'realized_r', 'rating', 'price_open', 'quantity', 'stop_loss', 'take_profit', 'close_time_utc', 'price_close', 'gross_pnl', 'fees', 'tags'}


def timestamp(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        if isinstance(value, (int, float)) or re.fullmatch(r'\d+(\.\d+)?', str(value)):
            number = float(value)
            return datetime.fromtimestamp(number / 1000 if abs(number) >= 1e11 else number, timezone.utc)
        date = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return date if date.tzinfo else date.replace(tzinfo=timezone.utc)
    except (ValueError, OverflowError, OSError):
        return None


def parse_filters(raw):
    try:
        filters = json.loads(raw or '{}')
        if not isinstance(filters, dict) or set(filters) - KEYS:
            raise ValueError()
        for key, value in filters.items():
            if key in LISTS:
                parsed = json.loads(value) if isinstance(value, str) and value else [] if value == '' else value
                if not isinstance(parsed, list) or any(not isinstance(item, (str, int)) or isinstance(item, bool) for item in parsed):
                    raise ValueError()
                filters[key] = [str(item) for item in parsed]
            elif not isinstance(value, str):
                raise ValueError()
        for key in ('timeStart', 'timeEnd'):
            if filters.get(key) and not re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d', filters[key]):
                raise ValueError()
        for key in ('tagIncludeMode', 'tagExcludeMode'):
            if filters.get(key, 'AND') not in ('AND', 'OR'):
                raise ValueError()
        for key, upper in (('weekday', 6), ('hour', 23)):
            if filters.get(key, 'all') not in ('', 'all') and filters[key] not in {str(index) for index in range(upper + 1)}:
                raise ValueError()
        for key, valid in {'sides': {'buy', 'sell'}, 'outcomes': {'win', 'loss', 'breakeven', 'unknown'}, 'reportKinds': {'app', 'prop', 'research', 'battles'}, 'days': {str(index) for index in range(7)}, 'hours': {str(index) for index in range(24)}, 'months': {str(index) for index in range(1, 13)}}.items():
            if set(filters.get(key) or []) - valid:
                raise ValueError()
        zone = ZoneInfo(filters.get('timezone') or 'UTC')
        return filters, zone
    except (ValueError, TypeError, ZoneInfoNotFoundError) as exc:
        raise AnalyticsValidationError('trade_page_filters_invalid') from exc


def build_trades_page(report, journals, *, page, page_size, sort_key, sort_direction, extra_filters='{}'):
    if page < 1 or not 1 <= page_size <= 100 or sort_key not in SORT_KEYS or sort_direction not in ('asc', 'desc'):
        raise AnalyticsValidationError('trade_page_parameters_invalid')
    filters, zone = parse_filters(extra_filters)
    journal_tags = {}
    wanted = {(row['session_id'], row['trade_id']) for row in report['ledger']}
    for record in journals:
        payload = record.get('payload') or {}
        source = payload.get('source') or {}
        sessions = {value for value in (source.get('session_id'), source.get('replay_session_id')) if isinstance(value, str)}
        trades = {value for value in (source.get('trade_id'), source.get('id')) if isinstance(value, str)}
        # Alias combinations match the original OR predicates; a journal is
        # appended once per matching trade, in journal order, even with aliases.
        for session in sessions:
            for trade in trades:
                if (session, trade) in wanted:
                    journal_tags.setdefault((session, trade), []).extend(payload.get('tags') or [])
    rows = []
    for index, raw in enumerate(report['ledger']):
        row = {**raw, 'report_kind': 'app', '_index': index}
        tags = list(row.get('tags') or [])
        tags.extend(journal_tags.get((row['session_id'], row['trade_id']), []))
        row['tags'] = list(dict.fromkeys(tags))
        rows.append(row)

    close_dates = {row['_index']: timestamp(row.get('close_time_utc')) for row in rows}
    local_dates = {index: date.astimezone(zone) if date else None for index, date in close_dates.items()}
    start, end = [int(filters[key][:2]) * 60 + int(filters[key][3:]) if filters.get(key) else None for key in ('timeStart', 'timeEnd')]
    explicit_no_kinds = 'reportKinds' in filters and not filters['reportKinds'] and json.loads(extra_filters).get('reportKinds') != ''
    facets = {'assets': sorted({row['symbol'] for row in rows if row.get('symbol')}),
              'tags': sorted({tag for row in rows for tag in row['tags']}),
              'strategies': sorted({row['playbook_id'] for row in rows if row.get('playbook_id')}),
              'years': sorted({str(date.year) for date in local_dates.values() if date}),
              'types': sorted({row['entry_type'] for row in rows if row.get('entry_type')}),
              'has_notes': any(row.get('notes') or row.get('note') for row in rows)}
    def matches(row):
        local = local_dates[row['_index']]
        weekday = (local.weekday() + 1) % 7 if local else None
        minute = local.hour * 60 + local.minute if local else None
        if start is not None or end is not None:
            if minute is None or not (minute >= start or minute <= end if start is not None and end is not None and start > end else (start is None or minute >= start) and (end is None or minute <= end)):
                return False
        net = float(row['net_pnl'])
        values = {'reportKinds': 'app', 'assets': row.get('symbol'), 'sides': str(row.get('side', '')).lower(), 'outcomes': 'win' if net > 1e-12 else 'loss' if net < -1e-12 else 'breakeven', 'types': row.get('entry_type'), 'years': local.year if local else None, 'months': local.month if local else None, 'days': weekday, 'hours': local.hour if local else None}
        if explicit_no_kinds:
            return False
        for key, value in values.items():
            if filters.get(key) and str(value) not in filters[key]:
                return False
        for key, value in {'asset': row.get('symbol'), 'strategy': row.get('playbook_id'), 'source': (row.get('source') or {}).get('session_id') if isinstance(row.get('source'), dict) else row.get('source') or row['session_id'], 'weekday': weekday, 'hour': local.hour if local else None}.items():
            if filters.get(key, 'all') not in ('', 'all') and str(value) != filters[key]:
                return False
        tags = row['tags']
        if filters.get('tag', 'all') not in ('', 'all') and filters['tag'] not in tags:
            return False
        for key in ('tagInclude', 'tagExclude'):
            chosen = filters.get(key) or []
            if chosen:
                group = any(value in tags for value in chosen) if filters.get(key + 'Mode', 'AND') == 'OR' else all(value in tags for value in chosen)
                if group == (key == 'tagExclude'):
                    return False
        search = filters.get('search', '').strip().lower()
        row_id = json.dumps([row['session_id'], row['trade_id']], separators=(',', ':'))
        if search and search not in ' '.join(map(str, [row_id, row['trade_id'], row.get('symbol', ''), row.get('side', ''), *tags])).lower():
            return False
        notes = filters.get('notes', '').strip().lower()
        return not notes or any(notes in str(row.get(key) or '').lower() for key in ('notes', 'note'))

    filtered = [row for row in rows if matches(row)]
    def value(row):
        if sort_key == 'session_id': return row.get('session_name') or row['session_id']
        if sort_key == 'source': return 'Replay'
        if sort_key == 'status': return 'Closed'
        if sort_key == 'return_pct': return float(row['net_pnl']) / float(row['starting_balance']) * 100 if row.get('starting_balance') and float(row['starting_balance']) > 0 else None
        if sort_key == 'tags': return ', '.join(row['tags'])
        if sort_key.endswith('_time_utc') or sort_key == 'recorded_at_utc':
            date = close_dates[row['_index']] if sort_key == 'close_time_utc' else timestamp(row.get(sort_key))
            return date.timestamp() if date else None
        if sort_key in {'net_pnl', 'realized_r', 'rating', 'price_open', 'quantity', 'stop_loss', 'take_profit', 'price_close', 'gross_pnl', 'fees'}:
            raw = row.get(sort_key)
            if raw is None or raw == '' or isinstance(raw, bool): return None
            try:
                number = float(raw)
                return number if math.isfinite(number) else None
            except (TypeError, ValueError):
                return None
        return row.get(sort_key)
    sort_values = {row['_index']: value(row) for row in filtered}
    def compare(a, b):
        left, right = sort_values[a['_index']], sort_values[b['_index']]
        if left is None or right is None:
            return 0 if left is None and right is None else 1 if left is None else -1
        if isinstance(left, (int, float)) and isinstance(right, (int, float)):
            result = (left > right) - (left < right)
        else:
            result = (str(left) > str(right)) - (str(left) < str(right))
        return result * (1 if sort_direction == 'asc' else -1) or a['_index'] - b['_index']
    filtered.sort(key=cmp_to_key(compare))
    count = None if report['metrics']['closed_trade_count'] is None else len(filtered)
    pages = math.ceil(count / page_size) if count is not None else None
    page = min(page, max(1, pages or 1))
    visible = [{key: value for key, value in row.items() if key != '_index'} for row in filtered[(page - 1) * page_size:page * page_size]]
    snapshot = {key: report.get(key) for key in ('scope', 'sources', 'excluded')}
    snapshot['journals'] = [(record['record_id'], record['revision']) for record in journals]
    snapshot['filters'] = filters
    return {'schema_version': 'replay-trades-page-v1', 'status': report['status'], 'scope': {**report['scope'], 'extra_filters': filters}, 'sources': report['sources'], 'excluded': report['excluded'], 'sessions': report['sessions'], 'ledger': visible, 'facets': facets,
            'pagination': {'page': page, 'page_size': page_size, 'returned_count': len(visible), 'filtered_count': count, 'page_count': pages, 'has_next': pages is not None and page < pages},
            'sort': {'key': sort_key, 'direction': sort_direction}, 'snapshot_key': hashlib.sha256(json.dumps(snapshot, sort_keys=True, default=str).encode()).hexdigest()}
