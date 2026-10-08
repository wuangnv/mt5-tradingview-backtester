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
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from .data_ingest import DataImportError, DataIngestService, preview_csv
from .market_sync import atomic_json
from .artifacts import sha256_file
from .contracts import DatasetManifest


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
                'timeframe': 'm1', 'price_type': 'bid', 'supports_full': True}

    @contextmanager
    def dataset_mutation_guard(self):
        with self.lock:
            if self.active or self.stopping:
                raise RuntimeError('download_busy')
            with self.store.connect() as owner:
                claimed = owner.execute('SELECT pg_try_advisory_lock(%s) AS owned', (self.advisory_key,)).fetchone()['owned']
                if not claimed:
                    raise RuntimeError('download_busy')
                owner.commit()
                yield

    def _dataset_scope(self, workspace, manifest):
        if (manifest is None or manifest.workspace_id != workspace or manifest.instrument_id not in self.meta
                or manifest.source.provider.lower() != 'dukascopy' or manifest.timeframe_seconds != 60
                or manifest.holdout_policy.get('mode', 'none') != 'none'):
            raise ValueError('dataset_not_supported')
        try:
            settings = json.loads(manifest.source.export_settings)
            if settings['library'] != 'dukascopy-node@1.50.0' or settings['price'] != 'bid' or settings['timeframe'] != 'm1':
                raise ValueError('dataset_not_supported')
            start = date.fromisoformat(settings['requested_from'])
            end = date.fromisoformat(settings['requested_to'])
            if start > end:
                raise ValueError('dataset_not_supported')
        except (TypeError, KeyError, json.JSONDecodeError, ValueError) as exc:
            raise ValueError('dataset_not_supported') from exc
        return start, end

    def dataset_update_state(self, workspace, manifest):
        if isinstance(manifest, dict):
            try:
                manifest = DatasetManifest.model_validate({key:value for key,value in manifest.items() if key in DatasetManifest.model_fields})
            except ValueError:
                return {'update_available': False}
        try:
            start, end = self._dataset_scope(workspace, manifest)
        except ValueError:
            return {'update_available': False}
        earliest = date.fromisoformat(self.meta[manifest.instrument_id]['startDayForMinuteCandles'][:10])
        yesterday = datetime.now(timezone.utc).date() - timedelta(days=1)
        return {'update_available': start > earliest or end < yesterday,
                'update_from_date': (earliest if start > earliest else end + timedelta(days=1)).isoformat(),
                'to_date': yesterday.isoformat(), 'full_history': start == earliest,
                'coverage_from_date': start.isoformat(), 'coverage_to_date': end.isoformat()}

    def request_full(self, workspace, instrument_id, dataset_id=None):
        self.authorization.authorize(workspace)
        if not self.meta:
            raise RuntimeError('worker_unavailable')
        if not isinstance(instrument_id, str):
            raise ValueError('instrument_not_supported')
        symbol = instrument_id.strip().upper()
        if symbol not in self.meta:
            raise ValueError('instrument_not_supported')
        earliest = date.fromisoformat(self.meta[symbol]['startDayForMinuteCandles'][:10])
        end = datetime.now(timezone.utc).date() - timedelta(days=1)
        start, parent_id = earliest, None
        if dataset_id is not None:
            manifest = self.store.get_dataset(workspace, dataset_id)
            saved_start, saved_end = self._dataset_scope(workspace, manifest)
            if manifest.instrument_id != symbol:
                raise ValueError('dataset_not_supported')
            if saved_start == earliest:
                start, parent_id = saved_end + timedelta(days=1), dataset_id
            if start > end:
                raise ValueError('already_current')
        return self._request(workspace, symbol, start.isoformat(), end.isoformat(),
                             full_from_date=earliest.isoformat(), parent_dataset_id=parent_id)

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
        if job['status'] in {'running', 'queued', 'pausing'} and self.active != (job['workspace_id'], job['job_id']) and not self._remote_owner(job):
            result.update(status='paused', error=None if job['status'] == 'pausing' else 'download_interrupted')
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
            return {'available': bool(self.meta), 'supports_pause': True, 'items': sorted(jobs, key=lambda item: item['created_at_utc'], reverse=True)[:20]}

    def request(self, workspace, instrument_id, from_date, to_date):
        return self._request(workspace, instrument_id, from_date, to_date, range_limit=366)

    def _request(self, workspace, instrument_id, from_date, to_date, *, range_limit=None,
                 full_from_date=None, parent_dataset_id=None):
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
        if (days < 1 or (range_limit is not None and days > range_limit) or end >= datetime.now(timezone.utc).date()
                or start < date.fromisoformat(meta['startDayForMinuteCandles'][:10])):
            raise ValueError('invalid_date_range')
        with self.lock:
            for old in self.list_jobs(workspace)['items']:
                if (old['instrument_id'], old['from_date'], old['to_date'], old.get('parent_dataset_id'), old.get('full_from_date')) == (symbol, from_date, to_date, parent_dataset_id, full_from_date) and old['status'] not in {'cancelled', 'failed'}:
                    if old['status'] == 'completed' and self.store.get_dataset(workspace, old.get('dataset_id')) is None:
                        continue
                    return self.resume(workspace, old['job_id']) if old['status'] == 'paused' else old
            if self.active or self.stopping:
                raise RuntimeError('download_busy')
            job = {'job_id': uuid4().hex, 'workspace_id': workspace, 'instrument_id': symbol,
                   'from_date': from_date, 'to_date': to_date, 'status': 'queued', 'error': None,
                   'completed_days': 0, 'total_days': days, 'dataset_id': None,
                   'transferred_bytes': 0, 'cached_bytes': 0, 'stage': 'downloading',
                   'full_from_date': full_from_date, 'parent_dataset_id': parent_dataset_id,
                   'created_at_utc': datetime.now(timezone.utc).isoformat()}
            self._save(job)
            atomic_json(self._folder(workspace, job['job_id']) / 'request.json',
                        {key: job[key] for key in ('instrument_id', 'from_date', 'to_date', 'parent_dataset_id')})
            self._start(job)
            return self._public(job)

    def resume(self, workspace, job_id):
        self.authorization.authorize(workspace)
        with self.lock:
            job = self._read(workspace, job_id)
            if job['status'] == 'completed' or self.active == (workspace, job_id):
                return self._public(job)
            if job['status'] in {'queued','running','pausing'} and self._remote_owner(job):
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
        return self._interrupt(workspace, job_id, 'cancelled')

    def pause(self, workspace, job_id):
        return self._interrupt(workspace, job_id, 'pausing')

    def _interrupt(self, workspace, job_id, status):
        self.authorization.authorize(workspace)
        with self.lock:
            def interrupt_owned():
                job = self._read(workspace, job_id)
                terminal = {'completed', 'cancelled'} if status == 'cancelled' else {'completed', 'cancelled', 'paused', 'failed'}
                if job['status'] not in terminal:
                    job.update(status=status if self.active == (workspace, job_id) or status == 'cancelled' else 'paused', error=None)
                    job.pop('retry_at', None)
                    self._save(job)
                    if self.active == (workspace, job_id) and self.process:
                        self.process.terminate()
                return self._public(job)
            if self.active == (workspace, job_id):
                return interrupt_owned()
            job = self._read(workspace, job_id)
            # Remote owners hold this lock for progress and publication. Never overwrite their job journal.
            with self.store.connect() as owner:
                claimed = owner.execute('SELECT pg_try_advisory_lock(%s) AS owned', (self._job_key(job),)).fetchone()['owned']
                if not claimed:
                    raise RuntimeError('download_busy')
                owner.commit()
                return interrupt_owned()

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
                    if self._read(workspace, job_id)['status'] in {'cancelled', 'pausing'}:
                        return
                    if self.stopping:
                        raise RuntimeError('download_interrupted')
                    job.update(status='running')
                    self._save(job)
                    atomic_json(folder / 'request.json', {**{key:job[key] for key in ('instrument_id','from_date','to_date')},
                        'parent_dataset_id':job.get('parent_dataset_id'),
                        'transferred_bytes':job.get('transferred_bytes',0)})
                    self.process = subprocess.Popen([self.node, str(self.worker), str(folder / 'request.json')],
                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding='utf-8',
                        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                done = False
                for line in self.process.stdout:
                    payload = json.loads(line)
                    with self.lock:
                        if self._read(workspace, job_id)['status'] in {'cancelled', 'pausing'}:
                            return
                        if payload['event'] == 'progress':
                            job['completed_days'] = payload['completed_days']
                            job['transferred_bytes'] = payload.get('transferred_bytes', job.get('transferred_bytes', 0))
                            job['cached_bytes'] = payload.get('cached_bytes', 0)
                            job['stage'] = payload.get('stage', 'downloading')
                            self._save(job)
                        elif payload['event'] == 'error':
                            error = payload['error']
                            cooldown = max(60, min(86400, int(payload.get('retry_after_seconds', 60))))
                        elif payload['event'] == 'complete':
                            done = True
                            job['buckets_sha256'] = payload['buckets_sha256']
                            job.update(stage='processing', transferred_bytes=payload.get('transferred_bytes',job.get('transferred_bytes',0)),
                                       cached_bytes=payload.get('cached_bytes',0))
                            self._save(job)
                code = self.process.wait(timeout=5)
                if code != 0 or not done or error:
                    raise RuntimeError(error or 'download_interrupted')
                self._complete(job, folder)
        except Exception as exc:
            known = {'source_rate_limited','source_unavailable','invalid_source_data','empty_range','download_busy',
                     'worker_unavailable','download_interrupted','download_cancelled','quality_rejected','invalid_date_range','instrument_not_supported','dataset_not_supported'}
            error = str(exc) if str(exc) in known else 'quality_rejected' if isinstance(exc, DataImportError) else 'download_interrupted'
            with self.lock:
                if self._read(workspace, job_id)['status'] not in {'cancelled', 'pausing'} and not (error == 'download_busy' and self._remote_owner(job)):
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
                try:
                    latest = self._read(workspace, job_id)
                    if latest['status'] == 'pausing':
                        latest.update(status='paused', error=None)
                        self._save(latest)
                finally:
                    self.active = None

    def _continue_check(self, job):
        with self.lock:
            status = self._read(job['workspace_id'], job['job_id'])['status']
            if status == 'cancelled':
                raise RuntimeError('download_cancelled')
            if status == 'pausing':
                raise RuntimeError('download_paused')
            if self.stopping:
                raise RuntimeError('download_interrupted')

    def _complete(self, job, folder):
        workspace, symbol = job['workspace_id'], job['instrument_id']
        check = lambda: self._continue_check(job)
        check()
        self.authorization.authorize(workspace)
        csv = folder / 'candles.csv'
        full_start = job.get('full_from_date') or job['from_date']
        parent_hash = None
        if job.get('parent_dataset_id'):
            parent = self.store.get_dataset(workspace, job['parent_dataset_id'])
            saved_start, saved_end = self._dataset_scope(workspace, parent)
            if saved_start.isoformat() != full_start or (saved_end + timedelta(days=1)).isoformat() != job['from_date']:
                raise ValueError('dataset_not_supported')
            raw = (self.artifacts.root / parent.raw_artifact_path).resolve()
            if self.artifacts.root not in raw.parents or sha256_file(raw, continue_check=check) != parent.raw_sha256:
                raise RuntimeError('invalid_source_data')
            merged = folder / 'merged.csv'
            with merged.open('wb') as output:
                for path, skip_header in ((raw, False), (csv, True)):
                    with path.open('rb') as source_file:
                        if skip_header:
                            source_file.readline()
                        for block in iter(lambda: source_file.read(1024 * 1024), b''):
                            check()
                            output.write(block)
                    if not skip_header:
                        output.write(b'\n')
            csv = merged
            parent_hash = parent.raw_sha256
        source = {'source_id': 'dukascopy-public-m1-bid', 'provider': 'Dukascopy',
            'instrument_mapping': {self.meta[symbol]['code']: symbol},
            'license_use': 'owner-requested local research; redistribution not granted',
            'retrieved_at_utc': job['created_at_utc'],
            'export_settings': json.dumps({'library':'dukascopy-node@1.50.0', 'timeframe':'m1', 'price':'bid',
                'timezone':'UTC', 'synthetic_bars':False, 'volume_units':'units', 'requested_from':full_start,
                'requested_to':job['to_date'], 'raw_buckets_sha256':job['buckets_sha256'], 'price_only':True,
                'parent_dataset_id':job.get('parent_dataset_id'), 'parent_raw_sha256':parent_hash}, sort_keys=True)}
        requested_range = (int(datetime.fromisoformat(full_start).replace(tzinfo=timezone.utc).timestamp()),
                           int((datetime.fromisoformat(job['to_date']).replace(tzinfo=timezone.utc)+timedelta(days=1)).timestamp()))
        preview = preview_csv(csv, source, symbol, 60, requested_range=requested_range, continue_check=check)
        if preview['quality']['duplicates'] or preview['quality']['out_of_order'] or preview['quality']['overlapping_intervals']:
            raise RuntimeError('quality_rejected')
        manifest = self.store.get_dataset(workspace, preview['dataset_id'])
        @contextmanager
        def publication():
            # Cancellation and final registration are serialized; long parsing stays outside this lock.
            with self.lock:
                check()
                yield
                job.update(status='completed', dataset_id=preview['dataset_id'], error=None, quality=preview['quality']['disposition'])
                self._save(job)
        if manifest is None:
            self.ingest.import_csv(workspace_id=workspace, path=csv, source=source, instrument=symbol,
                timeframe_seconds=60, requested_range=requested_range, continue_check=check,
                validated_preview=preview, publication_guard=publication())
        else:
            with publication():
                pass

    def stop(self):
        with self.lock:
            self.stopping = True
            if self.process and self.process.poll() is None:
                self.process.terminate()
        if self.thread:
            self.thread.join(timeout=10)
