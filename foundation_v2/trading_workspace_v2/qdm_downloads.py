"""QDM executor using the existing durable import/publication lifecycle."""
from __future__ import annotations

import csv
import hashlib
import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

from .artifacts import sha256_file
from .data_ingest import DataImportError, DataIngestService
from .dukascopy_downloads import DukascopyDownloads
from .qdm_cli import PROVIDER
from .download_job_store import DownloadJobStore


def normalize_export(source, target, from_date, to_date):
    count = 0
    with Path(source).open(encoding='utf-8-sig', newline='') as handle, Path(target).open('w', encoding='utf-8', newline='') as output:
        reader = csv.DictReader(handle)
        if reader.fieldnames != ['Date', 'Time', 'Open', 'High', 'Low', 'Close', 'Volume']:
            raise RuntimeError('invalid_source_data')
        writer = csv.writer(output)
        writer.writerow(['time', 'open', 'high', 'low', 'close', 'volume'])
        for row in reader:
            try:
                stamp = datetime.strptime(f"{row['Date']} {row['Time']}", '%Y.%m.%d %H:%M:%S').replace(tzinfo=timezone.utc)
                if not from_date <= stamp.date().isoformat() <= to_date:
                    raise ValueError('export outside requested dates')
                writer.writerow([int(stamp.timestamp()), *[row[key] for key in ('Open', 'High', 'Low', 'Close', 'Volume')]])
            except (ValueError, KeyError, TypeError) as exc:
                raise RuntimeError('invalid_source_data') from exc
            count += 1
    if count == 0:
        raise RuntimeError('empty_range')
    return count


class QdmDownloads(DukascopyDownloads):
    provider = PROVIDER
    library = 'qdm-cli-v1'
    price = 'provider_default'

    def __init__(self, store, artifacts, catalog, authorization, *, jobs=None):
        self.store, self.artifacts, self.catalog, self.authorization = store, artifacts, catalog, authorization
        self.cli = catalog.cli
        self.root = artifacts.root / 'qdm'
        self.root.mkdir(parents=True, exist_ok=True)
        self.advisory_key = int.from_bytes(hashlib.sha256(str(self.root.resolve()).encode()).digest()[:8], 'big', signed=True)
        self.lock = threading.RLock()
        self.active = self.process = self.thread = None
        self.stopping = False
        self.ingest = DataIngestService(store, artifacts)
        catalog.refresh()
        self.jobs = jobs or DownloadJobStore(store, self.provider)
        self._save_source()

    @property
    def meta(self):
        return self.catalog.instruments

    def _save(self, job, *, conn=None):
        snapshot = self.catalog.snapshot
        if 'provider_code' not in job and job['instrument_id'] in snapshot['instruments']:
            job['provider_code'] = snapshot['instruments'][job['instrument_id']]['code']
            job['catalog_sha256'] = snapshot['source_sha256']
        super()._save(job, conn=conn)

    def availability(self):
        return {**super().availability(), 'available': bool(self.meta) and self.cli.executable.is_file() and not self.catalog.error,
                'data_source': 'Dukascopy', 'download_engine': self.provider, 'integration': 'cli',
                'price_type': self.price, 'supports_pause': False, 'supports_cancel': False,
                'pilot': False, 'version': self.cli.version, 'error': self.catalog.error}

    def _require_source(self, workspace):
        self.authorization.authorize(workspace)
        if not self.cli.executable.is_file():
            raise RuntimeError('qdm_not_configured')
        if self.catalog.error or not self.meta:
            raise RuntimeError(self.catalog.error or 'qdm_catalog_missing')

    def _request(self, workspace, instrument_id, from_date, to_date, **options):
        self._require_source(workspace)
        return super()._request(workspace, instrument_id, from_date, to_date, **options)

    def request_full(self, workspace, instrument_id, dataset_id=None):
        self._require_source(workspace)
        return super().request_full(workspace, instrument_id, dataset_id)

    def resume(self, workspace, job_id):
        self._require_source(workspace)
        return super().resume(workspace, job_id)

    def _source_policy(self):
        # Node endpoint cooldowns do not describe QDM's own licensed transport.
        return {'rate_limit_level': 0, 'until': 0}

    def _snapshot(self, job):
        return {**super()._snapshot(job), 'provider': self.provider, 'supports_pause': False, 'supports_cancel': False,
                'data_source': 'Dukascopy', 'download_engine': self.provider,
                'transferred_bytes': None, 'progress_scope': 'phase'}

    def list_jobs(self, workspace):
        return {**super().list_jobs(workspace), 'available': self.availability()['available'],
                'supports_pause': False, 'supports_cancel': False}

    def pause(self, workspace, job_id):
        self.authorization.authorize(workspace)
        raise RuntimeError('qdm_control_unsupported')

    def cancel(self, workspace, job_id):
        self.authorization.authorize(workspace)
        raise RuntimeError('qdm_control_unsupported')

    def _ensure_symbol(self, symbol, provider_code=None):
        code = provider_code or self.meta[symbol]['code']
        name = f'{code}_TW'
        existing = next((row for row in self.cli.symbols() if row['Symbol'] == name), None)
        if existing is None:
            # QDM resolves the source instrument and defaults to SQ Default. Its
            # argument parser silently misreads the spaced `broker=SQ Default` value.
            self.cli.run(['-symbol', 'action=add', f'symbols={code}',
                          'datasource=dukascopy', 'datatype=M1', 'bartype=startofbar', 'postfix=_TW'])
            existing = next((row for row in self.cli.symbols() if row['Symbol'] == name), None)
        if (not existing or existing['Timeframe'].upper() != 'M1' or existing['Source'].lower() != 'dukascopy'
                or existing.get('Instrument') != code
                or not (existing.get('Timezone') == '(UTC) Coordinated Universal Time, DST: No'
                        or existing.get('Timezone') == '' and existing.get('Total records') == '0')):
            raise RuntimeError('qdm_symbol_mismatch')
        return name

    def _run(self, job):
        workspace, job_id = job['workspace_id'], job['job_id']
        folder = self._folder(workspace, job_id)
        try:
            self.authorization.authorize(workspace)
            with self.store.dedicated_connection() as owner:
                if not owner.execute('SELECT pg_try_advisory_lock(%s) AS owned', (self.advisory_key,)).fetchone()['owned']:
                    raise RuntimeError('download_busy')
                owner.execute('SELECT pg_advisory_lock(%s)', (self._job_key(job),))
                owner.commit()
                self.cli.probe()
                name = self._ensure_symbol(job['instrument_id'], job.get('provider_code'))
                job.update(status='running', stage='downloading', provider=self.provider,
                           qdm_version=self.cli.version, transferred_bytes=None, progress_percent=None,
                           progress_scope='phase')
                self._save(job)

                def progress(line):
                    if line.startswith(name + ','):
                        match = re.search(r'(\d+)%\s*$', line)
                        if match:
                            with self.lock:
                                job.update(progress_percent=min(100, int(match.group(1))),
                                           stage='processing' if 'Writing' in line else 'downloading')
                                self._save(job)

                self.cli.run(['-data', 'action=update', f'symbols={name}'], on_line=progress)
                self._ensure_symbol(job['instrument_id'], job.get('provider_code'))
                self._continue_check(job)
                export_dir = folder / 'export'
                export_dir.mkdir(exist_ok=True)
                job.update(stage='processing', progress_percent=None)
                self._save(job)
                self.cli.run(['-data', 'action=export', f'symbols={name}', 'timeframe=M1', 'timezone=UTC',
                              f"datefrom={job['from_date'].replace('-', '.')}", f"dateto={job['to_date'].replace('-', '.')}",
                              f'outputdir={export_dir.resolve()}', 'format=Custom', 'cIncludeHeader=true',
                              'cHeader=Date,Time,Open,High,Low,Close,Volume',
                              'cFormat=[Date:yyyy.MM.dd],[Time:HH:mm:ss],[Open],[High],[Low],[Close],[Volume]'])
                exports = list(export_dir.glob('*.csv'))
                if len(exports) != 1:
                    raise RuntimeError('invalid_source_data')
                normalize_export(exports[0], folder / 'candles.csv', job['from_date'], job['to_date'])
                job.setdefault('qdm_retrieved_at_utc', datetime.now(timezone.utc).isoformat())
                job.update(qdm_export_sha256=sha256_file(exports[0]), completed_days=job['total_days'],
                           progress_percent=None, transferred_bytes=None)
                self._save(job)
                self._complete(job, folder)
        except Exception as exc:
            known = {'qdm_busy', 'qdm_license_required', 'qdm_not_configured', 'qdm_command_failed', 'qdm_symbol_mismatch',
                     'qdm_version_unsupported', 'download_busy', 'download_interrupted', 'invalid_source_data', 'empty_range',
                     'quality_rejected', 'dataset_not_supported'}
            error = str(exc) if str(exc) in known else 'quality_rejected' if isinstance(exc, DataImportError) else 'qdm_command_failed'
            with self.lock, self._recovery_owner(job) as owned:
                job = self._read(workspace, job_id)
                if owned and job['status'] not in {'completed', 'cancelled'}:
                    job.update(status='paused' if error in {'qdm_busy', 'download_busy', 'download_interrupted'} else 'failed', error=error)
                    self._save(job)
        finally:
            with self.lock:
                self.active = None

    def _source(self, job, full_start, parent_hash):
        symbol = job['instrument_id']
        return {'source_id': 'quantdatamanager-dukascopy-m1', 'provider': self.provider,
                'instrument_mapping': {job['provider_code']: symbol},
                'license_use': 'owner licensed local QDM research; redistribution not granted',
                'retrieved_at_utc': job['qdm_retrieved_at_utc'],
                'export_settings': json.dumps({'library': self.library, 'qdm_version': job['qdm_version'],
                    'upstream_provider': 'Dukascopy', 'download_engine': self.provider,
                    'timeframe': 'm1', 'price': self.price, 'timezone': 'UTC',
                    'catalog_sha256': job.get('catalog_sha256'),
                    'volume_units': 'provider_defined', 'synthetic_bars': False, 'price_only': True,
                    'requested_from': full_start, 'requested_to': job['to_date'],
                    'qdm_export_sha256': job['qdm_export_sha256'], 'parent_dataset_id': job.get('parent_dataset_id'),
                    'parent_raw_sha256': parent_hash}, sort_keys=True)}

    def stop(self):
        # QDM has no documented mid-command pause/cancel. Let its current file write finish.
        with self.lock:
            self.stopping = True
        if self.thread:
            self.thread.join(timeout=2)
