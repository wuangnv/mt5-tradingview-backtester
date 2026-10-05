"""Local history catch-up and broker read snapshots, isolated from replay execution."""

import csv
from contextlib import closing
import hashlib
import json
import os
import sqlite3
import subprocess
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from .data_ingest import DataIngestService


DEFAULT_SYMBOLS = tuple(f'{base}{quote}m' for i, base in enumerate(('EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'))
                        for quote in ('EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY')[i + 1:])
# Broker symbol names are discovered; this list is an initial preference, not a mapping rule.
PREFERRED = ('EURUSDm', 'XAUUSDm', 'US500m', 'USTECm', 'GBPUSDm', 'USDJPYm',
             'AUDUSDm', 'USDCADm', 'USDCHFm', 'NZDUSDm', 'XAGUSDm', 'US30m',
             'BTCUSDm', 'ETHUSDm')


def atomic_json(path, payload):
    temporary = path.with_name(f'.{path.name}.{uuid4().hex}.tmp')
    temporary.write_text(json.dumps(payload, allow_nan=False), encoding='utf-8')
    os.replace(temporary, path)


def merge_bars(paths, destination):
    """Later source wins at the same timestamp; gaps are never filled."""
    db = destination.with_suffix('.sqlite')
    try:
        with closing(sqlite3.connect(db)) as conn:
            conn.execute('CREATE TABLE bars (timestamp INTEGER PRIMARY KEY, row TEXT NOT NULL)')
            for path in paths:
                if path is None:
                    continue
                with Path(path).open(newline='', encoding='utf-8-sig') as handle:
                    reader = csv.reader(handle)
                    next(reader)
                    conn.executemany('INSERT OR REPLACE INTO bars VALUES (?, ?)',
                                     ((int(row[0]), json.dumps(row)) for row in reader))
            with destination.open('w', newline='', encoding='utf-8') as handle:
                writer = csv.writer(handle)
                writer.writerow(['time', 'open', 'high', 'low', 'close', 'volume'])
                writer.writerows(json.loads(row[0]) for row in conn.execute('SELECT row FROM bars ORDER BY timestamp'))
    finally:
        db.unlink(missing_ok=True)
    return hashlib.sha256(destination.read_bytes()).hexdigest()


class MarketRuntime:
    def __init__(self, store, artifacts, *, workspace, python, worker, terminal, server='Exness-MT5Trial14', seed_days=90):
        self.store, self.artifacts, self.workspace = store, artifacts, workspace
        self.python, self.worker, self.terminal, self.server = map(str, (python, worker, terminal, server))
        self.root = artifacts.root / workspace / 'market-sync'
        self.root.mkdir(parents=True, exist_ok=True)
        self.state_path, self.live_path = self.root / 'history-state.json', self.root / 'live-snapshot.json'
        self.pin_path = self.root / 'account-pin.json'
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.threads = []
        self.seed_days = seed_days
        self.state = json.loads(self.state_path.read_text()) if self.state_path.exists() else {'assets': {}, 'pending': [], 'daily_attempt': None}
        self.live = json.loads(self.live_path.read_text()) if self.live_path.exists() else None
        self.error = 'awaiting_snapshot'
        self.pin = json.loads(self.pin_path.read_text())['account_key'] if self.pin_path.exists() else None
        self.active = None
        self.owned = False

    def authorize(self, workspace):
        if workspace != self.workspace:
            raise PermissionError('market_source_workspace_denied')

    def _collect(self, command, *arguments):
        params = [self.python, self.worker, command, '--terminal', self.terminal, '--server', self.server]
        if self.pin:
            params += ['--account-key', self.pin]
        result = subprocess.run(params + list(arguments), capture_output=True, text=True,
                                timeout=240 if command == 'history' else 25,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            try:
                error = json.loads(result.stderr.strip().splitlines()[-1])['error']
            except (ValueError, KeyError, IndexError):
                error = 'mt5_collector_failed'
            raise RuntimeError(error)
        payload = json.loads(result.stdout)
        if payload['server'] != self.server or payload['mode'] != 'demo' or payload['execution_capability'] is not False:
            raise RuntimeError('mt5_snapshot_scope_invalid')
        if self.pin and self.pin != payload['account_key']:
            raise RuntimeError('mt5_account_changed')
        return payload

    def _save(self):
        atomic_json(self.state_path, self.state)

    def _snapshot_loop(self):
        while not self.stop_event.is_set():
            try:
                payload = self._collect('snapshot')
                with self.lock:
                    if not self.pin:
                        self.pin = payload['account_key']
                        atomic_json(self.pin_path, {'account_key': self.pin, 'server': self.server, 'mode': 'demo'})
                    if self.live and self.live['account_key'] == payload['account_key']:
                        saved_deals = {deal['ticket']: deal for deal in self.live['deals']}
                        saved_deals.update({deal['ticket']: deal for deal in payload['deals']})
                        payload['deals'] = list(saved_deals.values())
                        payload['history_from_utc'] = min(self.live['history_from_utc'], payload['history_from_utc'])
                    atomic_json(self.live_path, payload)
                    self.live, self.error = payload, None
                    self._discover(payload)
            except Exception as exc:
                with self.lock:
                    self.error = str(exc) if str(exc).startswith('mt5_') else 'snapshot_unavailable'
            self.stop_event.wait(5)

    def _discover(self, payload):
        existing = {}
        for dataset in self.store.list_datasets(self.workspace):
            if dataset.source.provider == f'{self.server} / MT5':
                existing.setdefault(dataset.instrument_id, dataset)
        symbols = {s['symbol']: s for s in payload['symbols']}
        for name, metadata in symbols.items():
            asset = self.state['assets'].setdefault(name, {'enabled': False, 'dataset_id': None, 'status': 'not_downloaded'})
            asset['metadata'] = metadata
            if name in existing and asset['dataset_id'] != existing[name].dataset_id:
                dataset = existing[name]
                asset.update(dataset_id=dataset.dataset_id, status='ready',
                             first_timestamp=dataset.first_timestamp, last_timestamp=dataset.last_timestamp,
                             row_count=dataset.row_count, quality=dataset.quality.get('disposition', 'unverified'))
            if name in PREFERRED or name in DEFAULT_SYMBOLS:
                asset['enabled'] = True
        self._save()

    def request(self, workspace, symbol=None, start=None):
        self.authorize(workspace)
        with self.lock:
            if not self.owned or self.stop_event.is_set():
                raise RuntimeError('market_sync_owner_unavailable')
            if symbol and symbol not in self.state['assets']:
                raise ValueError('unknown_market_asset')
            if start:
                date = datetime.fromisoformat(start).replace(tzinfo=timezone.utc)
                if date > datetime.now(timezone.utc) or date < datetime.now(timezone.utc) - timedelta(days=1827):
                    raise ValueError('history_range_outside_five_years')
            names = [symbol] if symbol else [name for name, item in self.state['assets'].items() if item['enabled']]
            for name in names:
                self.state['assets'][name]['enabled'] = True
                # The in-flight request is already frozen; upgrades go behind it.
                pending = next((item for index, item in enumerate(self.state['pending'])
                                if item['symbol'] == name and not (index == 0 and name == self.active)), None)
                requested_start = start or self.state['assets'][name].get('failed_from_date')
                if pending:
                    dates = [date for date in (pending.get('from_date'), requested_start) if date]
                    pending.update(from_date=min(dates) if dates else None, latest=True, retry_at=0)
                else:
                    self.state['pending'].append({'symbol': name, 'from_date': requested_start, 'latest': True})
            self._save()
        return self.catalog(workspace)

    def catalog(self, workspace):
        self.authorize(workspace)
        with self.lock:
            queued = {item['symbol'] for item in self.state['pending']}
            items = [{**item, 'symbol': name,
                      'status': 'syncing' if name == self.active else 'queued' if name in queued else item['status']}
                     for name, item in self.state['assets'].items()]
            return {'status': 'ready' if items else 'unavailable', 'items': sorted(items, key=lambda s: (not s['enabled'], s['symbol'])),
                    'schedule': 'daily_utc_closed_bars', 'running': self.active, 'queued': len(queued),
                    'connection_error': self.error, 'source': f'{self.server} / MT5',
                    'seed_days': self.seed_days, 'execution_capability': False,
                    'provider_limits': 'Dukascopy archive disabled pending license clarification; futures exchange data not configured.'}

    def live_status(self, workspace):
        self.authorize(workspace)
        with self.lock:
            if not self.live:
                return {'status': 'unavailable', 'error': self.error, 'execution_capability': False}
            age = max(0, (datetime.now(timezone.utc) - datetime.fromisoformat(self.live['captured_at_utc'])).total_seconds())
            stale = bool(self.error) or age > 20
            # Only broker BUY/SELL deals count as execution events; deposits are separate.
            trades = [d for d in self.live['deals'] if d['type'] in (0, 1)]
            return {'status': 'ready', 'stale': stale, 'error': self.error, 'snapshot_age_seconds': age,
                    'poll_seconds': 5, 'execution_capability': False,
                    'source': self.live['server'], 'mode': self.live['mode'], 'account_key': self.live['account_key'],
                    'captured_at_utc': self.live['captured_at_utc'], 'history_from_utc': self.live['history_from_utc'],
                    'account': self.live['account'], 'positions': self.live['positions'], 'orders': self.live['orders'],
                    'deals': sorted(trades, key=lambda d: (d['time_msc'], d['ticket']), reverse=True),
                    'cashflows': [d for d in self.live['deals'] if d['type'] not in (0, 1)],
                    'quotes': self.live['quotes'], 'deal_count': len(trades)}

    def _sync_one(self, request):
        name = request['symbol']
        with self.lock:
            asset = dict(self.state['assets'][name])
        previous = self.store.get_dataset(self.workspace, asset['dataset_id']) if asset.get('dataset_id') else None
        now = datetime.now(timezone.utc)
        end = now.replace(second=0, microsecond=0) if request.get('latest') else now.replace(hour=0, minute=0, second=0, microsecond=0)
        start = (datetime.fromtimestamp(previous.last_timestamp, timezone.utc) - timedelta(days=2)) if previous else end - timedelta(days=self.seed_days)
        if request.get('from_date'):
            start = min(start, datetime.fromisoformat(request['from_date']).replace(tzinfo=timezone.utc))
        if start >= end:
            return
        folder = self.root / 'captures' / f'{name}-{uuid4().hex}'
        receipt = self._collect('history', '--symbol', name, '--start', str(int(start.timestamp())),
                                '--end', str(int(end.timestamp())), '--output', str(folder))
        if self.stop_event.is_set():
            return
        if receipt['row_count'] < 2:
            raise RuntimeError('mt5_history_empty')
        previous_path = self.artifacts.root / previous.raw_artifact_path if previous else None
        merged = folder / 'merged.csv'
        merged_hash = merge_bars([previous_path, folder / 'bars.csv'], merged)
        if previous and merged_hash == previous.raw_sha256:
            with self.lock:
                self.state['assets'][name].update(status='ready', last_checked_utc=now.isoformat(), error=None, failed_from_date=None)
            return
        source = {'source_id': f'{self.server}:{name}:M1', 'provider': f'{self.server} / MT5',
                  'instrument_mapping': {name: name}, 'license_use': 'owner-authorized local personal replay; no redistribution',
                  'retrieved_at_utc': receipt['captured_at_utc'],
                  'export_settings': 'closed UTC M1, broker Bid OHLC/tick_volume; raw spread retained; current symbol snapshot; historical costs/spec changes unverified'}
        dataset = DataIngestService(self.store, self.artifacts).import_csv(
            workspace_id=self.workspace, path=merged, source=source,
            instrument=receipt['metadata']['instrument'], timeframe_seconds=60)
        with self.lock:
            self.state['assets'][name].update(dataset_id=dataset.dataset_id, status='ready',
                first_timestamp=dataset.first_timestamp, last_timestamp=dataset.last_timestamp, row_count=dataset.row_count,
                quality=dataset.quality.get('disposition'), last_checked_utc=now.isoformat(), error=None, failed_from_date=None)

    def _schedule_daily(self, today):
        if not self.state['assets'] or self.error or self.state['daily_attempt'] == today:
            return
        queued = {item['symbol'] for item in self.state['pending']}
        names = sorted(self.state['assets'], key=lambda name: (name not in PREFERRED, PREFERRED.index(name) if name in PREFERRED else name))
        for name in names:
            if self.state['assets'][name]['enabled'] and name not in queued:
                self.state['pending'].append({'symbol': name, 'latest': False,
                    'from_date': self.state['assets'][name].get('failed_from_date')})
        self.state['daily_attempt'] = today
        self._save()

    def _history_loop(self):
        while not self.stop_event.is_set():
            with self.lock:
                self._schedule_daily(datetime.now(timezone.utc).date().isoformat())
                request = next((item for item in self.state['pending'] if item.get('retry_at', 0) <= time.time()), None) if not self.error else None
                if request:
                    self.state['pending'].remove(request)
                    self.state['pending'].insert(0, request)
                    request = dict(request)
                self.active = request['symbol'] if request else None
            if request:
                failure = None
                try:
                    self._sync_one(request)
                except Exception as exc:
                    failure = str(exc) if str(exc).startswith(('mt5_', 'symbol_', 'invalid_')) else 'history_import_failed'
                    with self.lock:
                        self.state['assets'][request['symbol']].update(status='error', error=failure,
                            failed_from_date=request.get('from_date'))
                with self.lock:
                    if not self.stop_event.is_set():
                        self.state['pending'].pop(0)
                        attempts = request.get('attempts', 0) + 1
                        if failure and attempts < 3:
                            self.state['pending'].append({**request, 'attempts': attempts, 'retry_at': time.time() + 30 * attempts})
                    self.active = None
                    self._save()
            else:
                self.stop_event.wait(2)

    def _owner_loop(self):
        # One owner for both snapshots and history, even with multiple API workers.
        with self.store.connect() as conn:
            conn.autocommit = True
            key = int.from_bytes(hashlib.sha256(f'market-sync:{self.workspace}'.encode()).digest()[:8], 'big', signed=True)
            if not conn.execute('SELECT pg_try_advisory_lock(%s) AS owned', (key,)).fetchone()['owned']:
                self.error = 'mt5_sync_owned_by_another_process'
                return
            self.owned = True
            for name, target in (('market-read-snapshot', self._snapshot_loop), ('market-history-catchup', self._history_loop)):
                thread = threading.Thread(target=target, name=name, daemon=True)
                self.threads.append(thread)
                thread.start()
            self.stop_event.wait()
            for thread in self.threads[1:]:
                thread.join()
            self.owned = False

    def start(self):
        thread = threading.Thread(target=self._owner_loop, name='market-sync-owner', daemon=True)
        self.threads.append(thread)
        thread.start()

    def stop(self):
        self.stop_event.set()
        for thread in self.threads:
            thread.join(timeout=1)
