"""Explicit, resumable public M1/Bid imports through the pinned Node worker."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from .data_ingest import DataImportError, DataIngestService, preview_csv
from .market_sync import atomic_json


class DukascopyDownloads:
    def __init__(self, store, artifacts, catalog, authorization, *, node=None, worker=None):
        self.store, self.artifacts, self.catalog, self.authorization = store, artifacts, catalog, authorization
        self.root = artifacts.root / 'dukascopy'
        self.root.mkdir(parents=True, exist_ok=True)
        self.advisory_key = int.from_bytes(hashlib.sha256(str(self.root.resolve()).encode()).digest()[:8], 'big', signed=True)
        self.node = node or shutil.which('node')
        self.worker = Path(worker or Path(__file__).resolve().parents[1] / 'data_worker/index.mjs')
        self.lock = threading.RLock()
        self.active = None
        self.process = None
        self.thread = None
        self.stopping = False
        self.meta = {}
        if self.node and self.worker.is_file():
            try:
                result = subprocess.run([self.node, str(self.worker), '--metadata'], capture_output=True, text=True,
                                        timeout=10, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                if result.returncode == 0:
                    payload = json.loads(result.stdout)
                    if payload['version'] == '1.50.0':
                        self.meta = {item['name'].upper(): item for item in payload['items']
                                     if item.get('startDayForMinuteCandles')}
            except (OSError, ValueError, KeyError, subprocess.TimeoutExpired):
                pass
        self.ingest = DataIngestService(store, artifacts)

    def availability(self):
        return {'available': bool(self.meta), 'supported_instruments': sorted(self.meta),
                'earliest_dates': {name: item['startDayForMinuteCandles'][:10] for name, item in self.meta.items()},
                'timeframe': 'm1', 'price_type': 'bid', 'max_days': 366}

    def _folder(self, workspace, job_id=None):
        # Keep temporary/raw paths below Windows path limits in the nested checkout.
        root = self.root / hashlib.sha256(workspace.encode()).hexdigest()[:16]
        if job_id is not None:
            if not re.fullmatch(r'[a-f0-9]{32}', job_id):
                raise ValueError('download_not_found')
            root /= job_id
        return root

    def _read(self, workspace, job_id):
        try:
            job = json.loads((self._folder(workspace, job_id) / 'job.json').read_text(encoding='utf-8'))
            if job['workspace_id'] != workspace or job['job_id'] != job_id:
                raise ValueError('download_not_found')
            return job
        except (OSError, KeyError, json.JSONDecodeError) as exc:
            raise ValueError('download_not_found') from exc

    def _save(self, job):
        folder = self._folder(job['workspace_id'], job['job_id'])
        folder.mkdir(parents=True, exist_ok=True)
        atomic_json(folder / 'job.json', job)

    def _public(self, job):
        result = {key: value for key, value in job.items() if key != 'workspace_id'}
        if job['status'] in {'running', 'queued'} and self.active != (job['workspace_id'], job['job_id']) and not self._remote_owner(job):
            result.update(status='paused', error='download_interrupted')
        result['retry_after_seconds'] = max(0, int(job.get('retry_at', 0) - time.time()) + 1) if job.get('retry_at') else 0
        result.pop('retry_at', None)
        return result

    def _job_key(self, job):
        return int.from_bytes(hashlib.sha256(str(self._folder(job['workspace_id'], job['job_id']).resolve()).encode()).digest()[:8], 'big', signed=True)

    def _remote_owner(self, job):
        key = self._job_key(job) & ((1 << 64) - 1)
        with self.store.connect() as conn:
            return conn.execute("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND classid=%s::oid AND objid=%s::oid AND objsubid=1 AND granted) AS active",
                                (key >> 32, key & 0xffffffff)).fetchone()['active']

    def list_jobs(self, workspace):
        with self.lock:
            jobs = []
            for path in self._folder(workspace).glob('*/job.json'):
                try:
                    jobs.append(self._public(self._read(workspace, path.parent.name)))
                except ValueError:
                    continue
            return {'available': bool(self.meta), 'items': sorted(jobs, key=lambda item: item['created_at_utc'], reverse=True)[:20]}

    def request(self, workspace, instrument_id, from_date, to_date):
        self.authorization.authorize(workspace)
        if not self.meta:
            raise RuntimeError('worker_unavailable')
        symbol = instrument_id.strip().upper()
        item = next((i for i in self.catalog.list_instruments(workspace) if i['instrument_id'] == symbol), None)
        meta = self.meta.get(symbol)
        if not item or not meta or item['provider_code'] != meta['code']:
            raise ValueError('instrument_not_supported')
        try:
            start, end = date.fromisoformat(from_date), date.fromisoformat(to_date)
        except ValueError as exc:
            raise ValueError('invalid_date_range') from exc
        days = (end - start).days + 1
        if (not 1 <= days <= 366 or end >= datetime.now(timezone.utc).date()
                or start < date.fromisoformat(meta['startDayForMinuteCandles'][:10])):
            raise ValueError('invalid_date_range')
        with self.lock:
            for old in self.list_jobs(workspace)['items']:
                if (old['instrument_id'], old['from_date'], old['to_date']) == (symbol, from_date, to_date) and old['status'] not in {'cancelled', 'failed'}:
                    return self.resume(workspace, old['job_id']) if old['status'] == 'paused' else old
            if self.active or self.stopping:
                raise RuntimeError('download_busy')
            job = {'job_id': uuid4().hex, 'workspace_id': workspace, 'instrument_id': symbol,
                   'from_date': from_date, 'to_date': to_date, 'status': 'queued', 'error': None,
                   'completed_days': 0, 'total_days': days, 'dataset_id': None,
                   'created_at_utc': datetime.now(timezone.utc).isoformat()}
            self._save(job)
            atomic_json(self._folder(workspace, job['job_id']) / 'request.json',
                        {key: job[key] for key in ('instrument_id', 'from_date', 'to_date')})
            self._start(job)
            return self._public(job)

    def resume(self, workspace, job_id):
        self.authorization.authorize(workspace)
        with self.lock:
            job = self._read(workspace, job_id)
            if job['status'] == 'completed' or self.active == (workspace, job_id):
                return self._public(job)
            if job['status'] in {'queued','running'} and self._remote_owner(job):
                raise RuntimeError('download_busy')
            if job['status'] == 'cancelled':
                raise ValueError('download_cancelled')
            if job.get('retry_at', 0) > time.time():
                raise RuntimeError('download_cooldown')
            if not self.meta:
                raise RuntimeError('worker_unavailable')
            if self.active or self.stopping:
                raise RuntimeError('download_busy')
            job.update(status='queued', error=None)
            self._save(job)
            self._start(job)
            return self._public(job)

    def _start(self, job):
        self.active = (job['workspace_id'], job['job_id'])
        self.thread = threading.Thread(target=self._run, args=(dict(job),), daemon=True, name='dukascopy-download')
        self.thread.start()

    def cancel(self, workspace, job_id):
        self.authorization.authorize(workspace)
        with self.lock:
            job = self._read(workspace, job_id)
            if job['status'] != 'completed':
                job.update(status='cancelled', error=None)
                self._save(job)
                if self.active == (workspace, job_id) and self.process:
                    self.process.terminate()
            return self._public(job)

    def _run(self, job):
        workspace, job_id = job['workspace_id'], job['job_id']
        folder = self._folder(workspace, job_id)
        error, cooldown = None, 60
        try:
            self.authorization.authorize(workspace)
            # One public-data worker across API processes connected to this database.
            with self.store.connect() as owner:
                claimed = owner.execute('SELECT pg_try_advisory_lock(%s) AS owned', (self.advisory_key,)).fetchone()['owned']
                if not claimed:
                    raise RuntimeError('download_busy')
                owner.execute('SELECT pg_advisory_lock(%s)', (self._job_key(job),))
                owner.commit()
                cooldown_path = self.root / 'cooldown.json'
                if cooldown_path.exists():
                    until = json.loads(cooldown_path.read_text())['until']
                    if until > time.time():
                        cooldown = int(until - time.time()) + 1
                        raise RuntimeError('source_rate_limited')
                with self.lock:
                    if self._read(workspace, job_id)['status'] == 'cancelled':
                        return
                    if self.stopping:
                        raise RuntimeError('download_interrupted')
                    job.update(status='running')
                    self._save(job)
                    self.process = subprocess.Popen([self.node, str(self.worker), str(folder / 'request.json')],
                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding='utf-8',
                        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                done = False
                for line in self.process.stdout:
                    payload = json.loads(line)
                    with self.lock:
                        if self._read(workspace, job_id)['status'] == 'cancelled':
                            return
                        if payload['event'] == 'progress':
                            job['completed_days'] = payload['completed_days']
                            self._save(job)
                        elif payload['event'] == 'error':
                            error = payload['error']
                            cooldown = max(60, min(86400, int(payload.get('retry_after_seconds', 60))))
                        elif payload['event'] == 'complete':
                            done = True
                            job['buckets_sha256'] = payload['buckets_sha256']
                code = self.process.wait(timeout=5)
                if code != 0 or not done or error:
                    raise RuntimeError(error or 'download_interrupted')
                with self.lock:
                    if self._read(workspace, job_id)['status'] == 'cancelled' or self.stopping:
                        return
                    self.authorization.authorize(workspace)
                    source = {'source_id': 'dukascopy-public-m1-bid', 'provider': 'Dukascopy',
                        'instrument_mapping': {self.meta[job['instrument_id']]['code']: job['instrument_id']},
                        'license_use': 'owner-requested local research; redistribution not granted',
                        'retrieved_at_utc': job['created_at_utc'],
                        'export_settings': json.dumps({'library':'dukascopy-node@1.50.0', 'timeframe':'m1', 'price':'bid',
                            'timezone':'UTC', 'synthetic_bars':False, 'volume_units':'units', 'requested_from':job['from_date'],
                            'requested_to':job['to_date'], 'raw_buckets_sha256':job['buckets_sha256'], 'price_only':True}, sort_keys=True)}
                    csv = folder / 'candles.csv'
                    requested_range = (int(datetime.fromisoformat(job['from_date']).replace(tzinfo=timezone.utc).timestamp()),
                                       int((datetime.fromisoformat(job['to_date']).replace(tzinfo=timezone.utc)+timedelta(days=1)).timestamp()))
                    preview = preview_csv(csv, source, job['instrument_id'], 60, requested_range=requested_range)
                    if preview['quality']['duplicates'] or preview['quality']['out_of_order'] or preview['quality']['overlapping_intervals']:
                        raise RuntimeError('quality_rejected')
                    manifest = self.store.get_dataset(workspace, preview['dataset_id'])
                    if manifest is None:
                        manifest = self.ingest.import_csv(workspace_id=workspace, path=csv, source=source, instrument=job['instrument_id'], timeframe_seconds=60, requested_range=requested_range)
                    job.update(status='completed', dataset_id=manifest.dataset_id, error=None, quality=manifest.quality['disposition'])
                    self._save(job)
        except Exception as exc:
            known = {'source_rate_limited','source_unavailable','invalid_source_data','empty_range','download_busy',
                     'worker_unavailable','download_interrupted','quality_rejected','invalid_date_range','instrument_not_supported'}
            error = str(exc) if str(exc) in known else 'quality_rejected' if isinstance(exc, DataImportError) else 'download_interrupted'
            with self.lock:
                if self._read(workspace, job_id)['status'] != 'cancelled' and not (error == 'download_busy' and self._remote_owner(job)):
                    job.update(status='paused' if error in {'source_rate_limited','source_unavailable','download_busy','download_interrupted'} else 'failed',
                               error=error, retry_at=time.time()+cooldown)
                    self._save(job)
                    if error == 'source_rate_limited':
                        atomic_json(self.root / 'cooldown.json', {'until':job['retry_at']})
        finally:
            with self.lock:
                if self.process:
                    if self.process.poll() is None:
                        self.process.terminate()
                    self.process.wait(timeout=5)
                    self.process.stdout.close()
                self.process = None
                self.active = None

    def stop(self):
        with self.lock:
            self.stopping = True
            if self.process and self.process.poll() is None:
                self.process.terminate()
        if self.thread:
            self.thread.join(timeout=10)
