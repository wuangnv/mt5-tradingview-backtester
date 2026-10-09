"""Bounded process-local read projections over immutable persisted revisions.

Cold reads evaluate the complete canonical financial oracle. Warm page reads
reuse its ordered projection; this is not SQL pagination of raw fills.
"""
from __future__ import annotations

from collections import OrderedDict
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import sys
from threading import Lock

from .analytics_read_model import normalize_filters, serialize_filters
from .dashboard_read_model import build_dashboard_performance
from .replay_activity import dashboard_timing
from .replay_analytics import build_replay_analytics_view
from .trades_page import prepare_trades_projection, slice_trades_projection


def _identity(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str, separators=(',', ':')).encode()).hexdigest()


def _size(value, seen=None, limit=None):
    seen = set() if seen is None else seen
    if id(value) in seen:
        return 0
    seen.add(id(value))
    result = sys.getsizeof(value)
    children = ((item for pair in value.items() for item in pair) if isinstance(value, dict)
                else iter(value) if isinstance(value, (list, tuple)) else ())
    for item in children:
        if limit is not None and result > limit:
            break
        result += _size(item, seen, None if limit is None else limit - result)
    return result


class BoundedProjectionCache:
    """Private object LRU; account retained Python memory, not just JSON length."""
    def __init__(self, *, max_bytes=64 * 1024 * 1024, max_entries=24):
        if max_bytes < 0 or max_entries < 1:
            raise ValueError('projection_cache_limit_invalid')
        self.max_bytes, self.max_entries = max_bytes, max_entries
        self._entries, self._bytes = OrderedDict(), 0
        self._lock = Lock()
        self._build_locks = [Lock() for _ in range(16)]

    def get_or_build(self, key, build):
        # Fixed striped locks bound synchronization state while suppressing
        # concurrent evaluation of the same immutable snapshot.
        with self._build_locks[int(_identity(key)[:8], 16) % len(self._build_locks)]:
            with self._lock:
                if key in self._entries:
                    value, size = self._entries[key]
                    self._entries.move_to_end(key)
                    return value
            value = build()
            self.put(key, value)
            return value

    def put(self, key, value):
        # Admission itself was costly on 100k-trade reports that cannot fit.
        # Skip large ledgers conservatively; compact pages can still be cached.
        if not self.max_bytes or (isinstance(value, dict) and isinstance(value.get('ledger'), list)
                                  and len(value['ledger']) > 20_000):
            return
        size = _size(value, limit=self.max_bytes) + _size(key)
        if size > self.max_bytes:
            return
        with self._lock:
            if key in self._entries:
                _, old_size = self._entries.pop(key)
                self._bytes -= old_size
            while self._entries and (self._bytes + size > self.max_bytes or len(self._entries) >= self.max_entries):
                _, (_, old_size) = self._entries.popitem(last=False)
                self._bytes -= old_size
            self._entries[key] = (value, size)
            self._bytes += size

    def get(self, key):
        with self._lock:
            if key not in self._entries:
                return None
            value, _ = self._entries[key]
            self._entries.move_to_end(key)
            return value

    def statistics(self):
        with self._lock:
            return {'entries': len(self._entries), 'retained_bytes': self._bytes,
                    'max_entries': self.max_entries, 'max_bytes': self.max_bytes}


class ReplayReadProjectionService:
    def __init__(self, store, *, max_bytes=64 * 1024 * 1024, max_entries=24):
        self.store = store
        self.cache = BoundedProjectionCache(max_bytes=max_bytes, max_entries=max_entries)

    def trades(self, workspace_id, *, session_ids=None, side='all', outcome='all',
               from_close_utc=None, to_close_utc=None, page=None, page_size=10,
               sort_key='close_time_utc', sort_direction='desc', extra_filters='{}'):
        filters = serialize_filters(normalize_filters({'side': side, 'outcome': outcome,
                    'from_close_utc': from_close_utc, 'to_close_utc': to_close_utc}))
        heads = self.store.list_record_heads(workspace_id, 'replay')
        revisions = [(head['record_id'], head['revision']) for head in heads]
        selected = None if session_ids is None else list(dict.fromkeys(session_ids))
        existing = {head['record_id'] for head in heads}
        if selected is not None and any(value not in existing for value in selected):
            raise LookupError('replay session not found')
        # Catalog ordering participates in both lineage selection and sessions.
        base_key = ('replay-performance-v1', workspace_id, _identity([revisions, selected, filters]))
        def build_report():
            records = self.store.records_at_heads(workspace_id, 'replay', heads)
            if len(records) != len(heads):
                raise LookupError('replay snapshot unavailable')
            return build_dashboard_performance(records, workspace_id, session_ids=selected,
                       include_ledger=True, **filters)
        if page is None:
            report = self.cache.get_or_build(base_key, build_report)
            # Timing can change without an execution revision. Fetch separately
            # so paged reads never de-TOAST execution JSON just to extract it.
            timing_heads = self.store.records_at_heads(workspace_id, 'replay', heads, metadata_only=True)
            timing_heads = timing_heads if selected is None else [head for head in timing_heads if head['record_id'] in selected]
            return {**deepcopy(report), 'as_of_utc': datetime.now(timezone.utc).isoformat(),
                    **dashboard_timing(timing_heads, self.store.list_replay_activity(workspace_id))}
        # Validate even on a hit and include original filter representation:
        # empty-string reportKinds differs from explicitly empty selection.
        slice_trades_projection({'filtered_count': 0, 'ledger': []}, page=page, page_size=page_size)
        journal_heads = self.store.list_record_heads(workspace_id, 'journal')
        journal_revisions = [(head['record_id'], head['revision']) for head in journal_heads]
        key = ('replay-trades-ordered-v1', workspace_id,
               _identity([base_key, journal_revisions, sort_key, sort_direction, extra_filters]))
        page_key = ('replay-trades-page-v1', key, page, page_size)
        cached_page = self.cache.get(page_key)
        if cached_page is not None:
            return deepcopy(cached_page)
        cached = self.cache.get(key)
        if cached is not None:
            return deepcopy(slice_trades_projection(cached, page=page, page_size=page_size))
        report = self.cache.get_or_build(base_key, build_report)
        def build_ordered():
            ids = report['scope']['session_ids']
            matching = self.store.records_at_heads(workspace_id, 'journal', journal_heads, session_ids=ids)
            by_id = {record['record_id']: record for record in matching}
            # Foreign journals affect the legacy snapshot identity but do not
            # need their text/body transferred or retained for a tag join.
            journals = [by_id.get(head['record_id'], head) for head in journal_heads]
            return prepare_trades_projection(report, journals, sort_key=sort_key,
                       sort_direction=sort_direction, extra_filters=extra_filters)
        projection = self.cache.get_or_build(key, build_ordered)
        result = slice_trades_projection(projection, page=page, page_size=page_size)
        if self.cache.get(key) is None:
            self.cache.put(page_key, result)
        return deepcopy(result)

    def analytics(self, record, filters=None, *, include_ledger=True):
        # Historical/cursor views can share revision yet have different event
        # sequences and marks. Identity covers the complete supplied authority.
        key = ('replay-analytics-v1', record.get('workspace_id'), _identity([record, filters]))
        view = self.cache.get_or_build(key, lambda: build_replay_analytics_view(record, filters))
        return deepcopy(view if include_ledger else {key: value for key, value in view.items() if key != 'ledger'})
