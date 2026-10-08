import hashlib
import json
import sys
import tempfile
import threading
import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path[:0] = [str(Path(__file__).resolve().parents[2]), str(Path(__file__).resolve().parents[1])]
from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.data_ingest import DataIngestService, preview_csv, MAX_GAP_DETAILS
from trading_workspace_v2.dukascopy_downloads import DukascopyDownloads


class MemoryStore:
    def __init__(self):
        self.datasets = {}

    def get_dataset(self, workspace, dataset_id):
        return self.datasets.get((workspace, dataset_id))

    def ensure_workspace(self, workspace):
        pass

    def put_dataset(self, manifest):
        self.datasets[(manifest.workspace_id, manifest.dataset_id)] = manifest

    @contextmanager
    def connect(self):
        yield SimpleNamespace(execute=lambda sql, args: SimpleNamespace(fetchone=lambda: {'owned':True, 'active':False}), commit=lambda:None)


def source(start, end):
    return {'source_id':'dukascopy-public-m1-bid','provider':'Dukascopy','license_use':'mock-only',
            'instrument_mapping':{'EUR-USD':'EUR/USD'},'retrieved_at_utc':'2026-01-01T00:00:00Z',
            'export_settings':json.dumps({'library':'dukascopy-node@1.50.0','timeframe':'m1','price':'bid',
                                          'requested_from':start,'requested_to':end})}


class FullDownloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.artifacts = ArtifactStore(Path(self.temp.name)/'artifacts')
        self.store = MemoryStore()
        self.service = DukascopyDownloads.__new__(DukascopyDownloads)
        self.service.store, self.service.artifacts = self.store, self.artifacts
        self.service.root = self.artifacts.root/'dukascopy'
        self.service.root.mkdir()
        self.service.catalog = SimpleNamespace(list_instruments=lambda workspace:[{'instrument_id':'EUR/USD','provider_code':'EUR-USD'}])
        self.service.authorization = SimpleNamespace(authorize=lambda workspace:None)
        self.service.meta = {'EUR/USD':{'code':'EUR-USD','startDayForMinuteCandles':'2003-05-04T19:00:00Z'}}
        self.service.lock = threading.RLock()
        self.service.active = None
        self.service.stopping = False
        self.service.process = None
        self.service.advisory_key = 123
        self.service.ingest = DataIngestService(self.store, self.artifacts)
        self.service._start = lambda job:setattr(self.service,'active',(job['workspace_id'],job['job_id']))
        self.yesterday = datetime.now(timezone.utc).date()-timedelta(days=1)

    def manifest(self, start, end, dataset_id='old'):
        manifest = SimpleNamespace(workspace_id='a',instrument_id='EUR/USD',timeframe_seconds=60,
            source=SimpleNamespace(provider='Dukascopy',export_settings=source(start,end)['export_settings']),
            holdout_policy={'mode':'none'},dataset_id=dataset_id)
        self.store.datasets[('a',dataset_id)] = manifest
        return manifest

    def test_full_dates_are_derived_from_metadata_and_completed_utc_day(self):
        job = self.service.request_full('a','EUR/USD')
        self.assertEqual(job['from_date'],'2003-05-04')
        self.assertEqual(job['to_date'],self.yesterday.isoformat())
        self.assertGreater(job['total_days'],366)
        self.assertIsNone(job['parent_dataset_id'])
        self.assertTrue(self.service.availability()['supports_full'])

    def test_partial_history_backfills_and_full_history_updates_only_tail(self):
        saved_end = self.yesterday-timedelta(days=2)
        partial = self.manifest(saved_end.isoformat(),saved_end.isoformat())
        state = self.service.dataset_update_state('a',partial)
        self.assertTrue(state['update_available'])
        self.assertFalse(state['full_history'])
        job = self.service.request_full('a','EUR/USD','old')
        self.assertEqual(job['from_date'],'2003-05-04')
        self.assertIsNone(job['parent_dataset_id'])
        self.service.active = None
        full = self.manifest('2003-05-04',saved_end.isoformat(),'full')
        job = self.service.request_full('a','EUR/USD','full')
        self.assertEqual(job['from_date'],(saved_end+timedelta(days=1)).isoformat())
        self.assertEqual(job['total_days'],2)
        self.assertEqual(job['parent_dataset_id'],'full')
        self.assertEqual(self.service.dataset_update_state('a',full)['update_from_date'],job['from_date'])

    def test_current_foreign_source_wrong_symbol_and_missing_dataset_are_rejected(self):
        current = self.manifest('2003-05-04',self.yesterday.isoformat())
        self.assertFalse(self.service.dataset_update_state('a',current)['update_available'])
        with self.assertRaisesRegex(ValueError,'already_current'):
            self.service.request_full('a','EUR/USD','old')
        with self.assertRaisesRegex(ValueError,'dataset_not_supported'):
            self.service.request_full('b','EUR/USD','old')
        current.source.provider = 'CSV'
        with self.assertRaisesRegex(ValueError,'dataset_not_supported'):
            self.service.request_full('a','EUR/USD','old')
        with self.assertRaisesRegex(ValueError,'instrument_not_supported'):
            self.service.request_full('a','UNKNOWN')

    def test_deleted_completed_manifest_does_not_reuse_old_success(self):
        job = self.service.request_full('a','EUR/USD')
        old = self.service._read('a',job['job_id'])
        old.update(status='completed',dataset_id='deleted')
        self.service._save(old)
        self.service.active = None
        new = self.service.request_full('a','EUR/USD')
        self.assertNotEqual(new['job_id'],job['job_id'])

    def test_tail_merge_creates_new_complete_version_preserving_parent_hash(self):
        old_end = self.yesterday-timedelta(days=1)
        timestamp = lambda day:int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp())
        csv = Path(self.temp.name)/'old.csv'
        csv.write_text(f'time,open,high,low,close,volume\n{timestamp("2003-05-04")},1,2,1,1,1\n{timestamp(old_end.isoformat())},1,2,1,1,1\n')
        parent = self.service.ingest.import_csv(workspace_id='a',path=csv,source=source('2003-05-04',old_end.isoformat()),instrument='EUR/USD',timeframe_seconds=60)
        job = self.service.request_full('a','EUR/USD',parent.dataset_id)
        folder = self.service._folder('a',job['job_id'])
        start = timestamp(job['from_date'])
        (folder/'candles.csv').write_text(f'time,open,high,low,close,volume\n{start},1,2,1,1,1\n{start+60},1,2,1,1,1\n')
        private = self.service._read('a',job['job_id'])
        private['buckets_sha256'] = 'mock-bucket-hash'
        self.service._complete(private,folder)
        complete = self.service._read('a',job['job_id'])
        updated = self.store.get_dataset('a',complete['dataset_id'])
        self.assertEqual(complete['status'],'completed')
        self.assertNotEqual(updated.dataset_id,parent.dataset_id)
        self.assertEqual(updated.row_count,4)
        self.assertEqual(json.loads(updated.source.export_settings)['requested_from'],'2003-05-04')
        self.assertEqual(hashlib.sha256((self.artifacts.root/parent.raw_artifact_path).read_bytes()).hexdigest(),parent.raw_sha256)
        self.assertIs(self.store.get_dataset('a',parent.dataset_id),parent)
        enriched = {**updated.model_dump(mode='json'),'provider_id':'dukascopy','size_bytes':123,'quality_status':'unverified'}
        self.assertFalse(self.service.dataset_update_state('a',enriched)['update_available'])
        self.assertFalse(self.service.dataset_update_state('a',{'dataset_id':'invalid'})['update_available'])

    def test_gap_summary_is_bounded_exact_and_preview_can_cancel(self):
        csv = Path(self.temp.name)/'gaps.csv'
        csv.write_text('time,open,high,low,close\n'+''.join(f'{index*120},1,2,1,1\n' for index in range(MAX_GAP_DETAILS+20)))
        preview = preview_csv(csv,source('2003-05-04',self.yesterday.isoformat()),'EUR/USD',60)
        self.assertEqual(preview['quality']['gap_count'],MAX_GAP_DETAILS+19)
        self.assertEqual(len(preview['quality']['gaps']),MAX_GAP_DETAILS)
        self.assertTrue(preview['quality']['gap_details_truncated'])
        self.assertEqual(preview['quality']['disposition'],'review')
        with self.assertRaisesRegex(RuntimeError,'download_cancelled'):
            preview_csv(csv,source('2003-05-04',self.yesterday.isoformat()),'EUR/USD',60,continue_check=lambda:(_ for _ in ()).throw(RuntimeError('download_cancelled')))

    def test_mutation_guard_blocks_active_local_worker(self):
        with self.service.dataset_mutation_guard():
            pass
        self.service.active = ('a','job')
        with self.assertRaisesRegex(RuntimeError,'download_busy'):
            with self.service.dataset_mutation_guard():
                self.fail('busy mutation was entered')

    def test_long_parse_does_not_block_cancel_and_never_publishes_cancelled_dataset(self):
        job = self.service.request_full('a','EUR/USD')
        folder = self.service._folder('a',job['job_id'])
        (folder/'candles.csv').write_text('time,open,high,low,close,volume\n1052006400,1,2,1,1,1\n1052006460,1,2,1,1,1\n')
        private = self.service._read('a',job['job_id'])
        private['buckets_sha256'] = 'mock'
        entered, release = threading.Event(), threading.Event()
        errors = []
        real_preview = preview_csv
        def slow_preview(*args,**kwargs):
            entered.set()
            release.wait(timeout=3)
            return real_preview(*args,**kwargs)
        def finish():
            try:
                self.service._complete(private,folder)
            except RuntimeError as error:
                errors.append(str(error))
        with patch('trading_workspace_v2.dukascopy_downloads.preview_csv',side_effect=slow_preview):
            thread = threading.Thread(target=finish)
            thread.start()
            try:
                self.assertTrue(entered.wait(timeout=2))
                self.assertEqual(self.service.cancel('a',job['job_id'])['status'],'cancelled')
            finally:
                release.set()
                thread.join(timeout=3)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors,['download_cancelled'])
        self.assertFalse(self.store.datasets)

    def test_cancelled_import_rolls_back_only_its_new_artifacts(self):
        csv = Path(self.temp.name)/'cancelled.csv'
        csv.write_text('time,open,high,low,close\n60,1,2,1,1\n120,1,2,1,1\n')
        @contextmanager
        def reject_publication():
            raise RuntimeError('download_cancelled')
            yield
        with self.assertRaisesRegex(RuntimeError,'download_cancelled'):
            self.service.ingest.import_csv(workspace_id='a',path=csv,source=source('2003-05-04',self.yesterday.isoformat()),instrument='EUR/USD',timeframe_seconds=60,publication_guard=reject_publication())
        self.assertFalse(list(self.artifacts.root.glob('a/raw/**/source.csv')))
        self.assertFalse(list(self.artifacts.root.glob('a/datasets/*.parquet')))
        self.assertFalse(self.store.datasets)

    def test_remote_cancel_cannot_overwrite_active_owner_progress_or_publication(self):
        job = self.service.request_full('a','EUR/USD')
        private = self.service._read('a',job['job_id'])
        private['status'] = 'running'
        self.service._save(private)
        self.service.active = None
        @contextmanager
        def denied_lock():
            yield SimpleNamespace(execute=lambda sql,args:SimpleNamespace(fetchone=lambda:{'owned':False}),commit=lambda:None)
        with patch.object(self.store,'connect',denied_lock):
            with self.assertRaisesRegex(RuntimeError,'download_busy'):
                self.service.cancel('a',job['job_id'])
        self.assertEqual(self.service._read('a',job['job_id'])['status'],'running')
        # A stopped owner releases the job lock, so stale journals can then be cancelled safely.
        self.assertEqual(self.service.cancel('a',job['job_id'])['status'],'cancelled')

    def test_empty_weekend_and_one_bar_tail_keep_parent_rows_and_review_coverage(self):
        old_end = self.yesterday-timedelta(days=1)
        timestamp = lambda day:int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp())
        for tail_rows in (0,1):
            with self.subTest(tail_rows=tail_rows):
                self.service.active = None
                parent_csv=Path(self.temp.name)/f'parent-{tail_rows}.csv'
                parent_csv.write_text(f'time,open,high,low,close,volume\n{timestamp("2003-05-04")},1,2,1,1,1\n{timestamp(old_end.isoformat())},1,2,1,1,1\n')
                parent_source={**source('2003-05-04',old_end.isoformat()),'source_id':f'tail-fixture-{tail_rows}'}
                parent=self.service.ingest.import_csv(workspace_id='a',path=parent_csv,source=parent_source,instrument='EUR/USD',timeframe_seconds=60)
                job=self.service.request_full('a','EUR/USD',parent.dataset_id)
                folder=self.service._folder('a',job['job_id'])
                tail=f'{timestamp(job["from_date"])},1,2,1,1,1\n' if tail_rows else ''
                (folder/'candles.csv').write_text('time,open,high,low,close,volume\n'+tail)
                private=self.service._read('a',job['job_id'])
                private['buckets_sha256']='mock'
                self.service._complete(private,folder)
                saved=self.store.get_dataset('a',self.service._read('a',job['job_id'])['dataset_id'])
                self.assertEqual(saved.row_count,2+tail_rows)
                self.assertEqual(saved.quality['disposition'],'review')
                self.assertEqual(json.loads(saved.source.export_settings)['requested_to'],self.yesterday.isoformat())
                if not tail_rows:
                    self.assertEqual(saved.last_timestamp,parent.last_timestamp)
                self.assertGreater(saved.quality['coverage']['trailing_missing_intervals'],0)
                self.assertFalse(self.service.dataset_update_state('a',saved)['update_available'])


if __name__ == '__main__': unittest.main()
