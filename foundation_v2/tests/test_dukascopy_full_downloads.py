import hashlib
import json
import sys
import tempfile
import threading
import shutil
import unittest
from contextlib import contextmanager, nullcontext
from copy import deepcopy
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

    def put_dataset(self, manifest, *, conn=None):
        self.datasets[(manifest.workspace_id, manifest.dataset_id)] = manifest

    @contextmanager
    def connect(self):
        yield SimpleNamespace(execute=lambda sql, args: SimpleNamespace(fetchone=lambda: {'owned':True, 'active':False}), commit=lambda:None, transaction=nullcontext)

    def dedicated_connection(self):
        return self.connect()


class MemoryDownloadJobs:
    """Test-owned fake; production always uses PostgreSQL authority."""
    def __init__(self):
        self.rows = {}
        self.project = lambda job: {key:value for key,value in job.items() if key != 'workspace_id'}

    def source(self, snapshot):
        self.source_snapshot = deepcopy(snapshot)

    def read(self, workspace, job_id):
        try:
            return deepcopy(self.rows[(workspace,job_id)])
        except KeyError:
            raise ValueError('download_not_found')

    def save(self, job, snapshot, key, *, adopt=False, conn=None):
        identity = (job['workspace_id'],job['job_id'])
        current = self.rows.get(identity)
        if adopt and current:
            return False
        if current and current['revision'] != job.get('revision'):
            raise RuntimeError('download_revision_conflict')
        job['revision'] = (current or {}).get('revision',0)+1
        self.rows[identity] = deepcopy(job)
        return True

    def list(self, workspace, limit=20):
        rows = sorted((row for (scope,_),row in self.rows.items() if scope==workspace),
                      key=lambda row:(row['created_at_utc'],row['job_id']),reverse=True)
        return [self.project(deepcopy(row)) for row in rows[:limit]]

    def matching(self, workspace, symbol, start, end, parent, full_start):
        return [self.project(deepcopy(row)) for (scope,_),row in self.rows.items()
                if scope==workspace and (row['instrument_id'],row['from_date'],row['to_date'],
                    row.get('parent_dataset_id'),row.get('full_from_date'))==(symbol,start,end,parent,full_start)
                and row['status'] not in {'cancelled','failed'}]


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
        self.service.jobs = MemoryDownloadJobs()
        self.service.jobs.project = self.service._public
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

    def test_source_cooldown_blocks_new_jobs_and_resume_even_if_job_has_no_timer(self):
        job = self.service.request_full('a','EUR/USD')
        private = self.service._read('a',job['job_id'])
        private.update(status='paused',error=None)
        self.service._save(private)
        self.service.active = None
        (self.service.root/'cooldown.json').write_text(json.dumps({'until':10120,'rate_limit_level':2}))
        with patch('trading_workspace_v2.dukascopy_downloads.time.time',return_value=10000):
            self.assertEqual(self.service._public(private)['retry_after_seconds'],121)
            with self.assertRaisesRegex(RuntimeError,'download_cooldown'):
                self.service.resume('a',job['job_id'])
            with self.assertRaisesRegex(RuntimeError,'download_cooldown'):
                self.service.request('a','EUR/USD','2026-01-01','2026-01-02')
            self.assertEqual(len(list(self.service._folder('a').glob('*/job.json'))),1)
        with patch('trading_workspace_v2.dukascopy_downloads.time.time',return_value=10121):
            self.assertEqual(self.service.resume('a',job['job_id'])['status'],'queued')

    @unittest.skipUnless(shutil.which('node'), 'Node is required for the offline worker integration')
    def test_real_node_worker_retries_transient_fixture_then_publishes_validated_artifact(self):
        job = self.service.request('a','EUR/USD','2026-01-05','2026-01-06')
        worker = Path(__file__).resolve().parents[1]/'data_worker/index.mjs'
        harness = Path(self.temp.name)/'worker-fixture.mjs'
        harness.write_text("import {download} from "+json.dumps(worker.as_uri())+";\n"+"""
let calls=0;
globalThis.fetch=async url=>{
  if(++calls===1) return new Response('',{status:503});
  const parts=url.split('/').slice(-3).map(Number);
  return new Response(JSON.stringify({timestamp:Date.UTC(parts[0],parts[1]-1,parts[2]),
    multiplier:0.00001,shift:60000,open:1.1,high:1.1,low:1.1,close:1.1,
    times:[0,1],opens:[0,0],highs:[0,0],lows:[0,0],closes:[0,0],volumes:[1,1]}));
};
await download(process.argv[2],{sleepFn:async()=>{}});
""",encoding='utf-8')
        self.service.node,self.service.worker = shutil.which('node'),harness
        self.service._run(self.service._read('a',job['job_id']))
        completed = self.service.list_jobs('a')['items'][0]
        self.assertEqual(completed['status'],'completed')
        self.assertEqual(completed['completed_days'],2)
        self.assertEqual(completed['network_days'],2)
        manifest = self.store.get_dataset('a',completed['dataset_id'])
        self.assertEqual(manifest.row_count,4)
        self.assertEqual(manifest.instrument_id,'EUR/USD')
        self.assertEqual(manifest.quality['disposition'],'review')
        self.assertEqual(hashlib.sha256((self.artifacts.root/manifest.raw_artifact_path).read_bytes()).hexdigest(),manifest.raw_sha256)

    def run_failed_worker(self, job, error='source_rate_limited', retry=300):
        self.service.node, self.service.worker = 'mock-node', Path('mock-worker')
        class Output:
            def __iter__(stream):
                yield json.dumps({'event':'error','error':error,'retry_after_seconds':retry})
            def close(stream):
                pass
        process = SimpleNamespace(stdout=Output(),terminate=lambda:None,poll=lambda:1,wait=lambda **kwargs:1)
        with patch('trading_workspace_v2.dukascopy_downloads.subprocess.Popen',return_value=process) as spawn:
            self.service._run(self.service._read('a',job['job_id']))
        return spawn

    def test_access_challenge_preserves_job_without_inventing_cooldown_or_escalating_pacing(self):
        job = self.service.request_full('a','EUR/USD')
        self.run_failed_worker(job,'source_access_challenge',0)
        saved = self.service._read('a',job['job_id'])
        self.assertEqual(saved['status'],'paused')
        self.assertEqual(saved['error'],'source_access_challenge')
        self.assertEqual(self.service._public(saved)['retry_after_seconds'],0)
        self.assertEqual(self.service._source_policy(),{'rate_limit_level':0})

    def test_repeated_429_persists_source_pacing_backoff_and_retains_resume_cache(self):
        job = self.service.request_full('a','EUR/USD')
        folder = self.service._folder('a',job['job_id'])
        cache = folder/'raw'/'bucket.json'
        cache.parent.mkdir(); cache.write_text('existing raw bucket')
        now = 10000
        for expected_pace, expected_level, expected_wait in [
                ({'concurrency':3,'pause_ms':1000},1,300),
                ({'concurrency':2,'pause_ms':2000},2,600),
                ({'concurrency':1,'pause_ms':4000},3,1200)]:
            with patch('trading_workspace_v2.dukascopy_downloads.time.time',return_value=now):
                self.assertEqual(self.run_failed_worker(job).call_count,1)
                request = json.loads((folder/'request.json').read_text())
                self.assertEqual(request['pacing'],expected_pace)
                policy = self.service._source_policy()
                self.assertEqual(policy['rate_limit_level'],expected_level)
                self.assertEqual(policy['until'],now+expected_wait)
                saved = self.service._read('a',job['job_id'])
                self.assertEqual(saved['status'],'paused')
                self.assertEqual(saved['retry_at'],policy['until'])
                with self.assertRaisesRegex(RuntimeError,'download_cooldown'):
                    self.service.resume('a',job['job_id'])
            now += expected_wait+1
            with patch('trading_workspace_v2.dukascopy_downloads.time.time',return_value=now):
                self.assertEqual(self.service.resume('a',job['job_id'])['status'],'queued')
        self.assertEqual(cache.read_text(),'existing raw bucket')
        self.assertFalse(self.store.datasets)

    def test_global_cooldown_does_not_spawn_or_escalate_and_manual_pause_cannot_bypass(self):
        job = self.service.request_full('a','EUR/USD')
        with patch('trading_workspace_v2.dukascopy_downloads.time.time',return_value=10000):
            self.run_failed_worker(job,retry=900)
            before = self.service._source_policy()
            self.assertEqual(before['until'],10900)
            # This models another queued job encountering the existing source wait.
            saved = self.service._read('a',job['job_id'])
            saved.update(status='queued'); self.service._save(saved)
            self.assertEqual(self.run_failed_worker(job).call_count,0)
            self.assertEqual(self.service._source_policy(),before)
            self.service.pause('a',job['job_id'])
            self.assertEqual(self.service._read('a',job['job_id'])['retry_at'],10900)

    def test_legacy_cooldown_migrates_and_success_recovers_one_level_only(self):
        (self.service.root/'cooldown.json').write_text(json.dumps({'until':1}))
        self.assertEqual(self.service._pacing(self.service._source_policy()),{'concurrency':2,'pause_ms':2000})
        with patch('trading_workspace_v2.dukascopy_downloads.time.time',return_value=10000):
            until = self.service._record_rate_limit(1000)
            self.assertEqual(until,11000)
            self.assertEqual(self.service._pacing(self.service._source_policy()),{'concurrency':1,'pause_ms':4000})
        self.service._record_source_success()
        self.assertEqual(self.service._source_policy(),{'until':0,'rate_limit_level':1})
        for _ in range(10):
            self.service._record_rate_limit(300)
        self.assertEqual(self.service._pacing(self.service._source_policy()),{'concurrency':1,'pause_ms':30000})

    def test_network_errors_do_not_increase_rate_limit_level(self):
        job = self.service.request_full('a','EUR/USD')
        self.run_failed_worker(job,error='source_unavailable',retry=60)
        self.assertEqual(self.service._source_policy()['rate_limit_level'],0)
        self.assertFalse((self.service.root/'cooldown.json').exists())

    def test_pacing_write_failure_cannot_corrupt_an_already_published_completion(self):
        job = self.service.request_full('a','EUR/USD')
        self.service.node, self.service.worker = 'mock-node', Path('mock-worker')
        class Output:
            def __iter__(stream):
                yield json.dumps({'event':'complete','buckets_sha256':'fixture','transferred_bytes':100})
            def close(stream):
                pass
        process = SimpleNamespace(stdout=Output(),terminate=lambda:None,poll=lambda:0,wait=lambda **kwargs:0)
        with patch('trading_workspace_v2.dukascopy_downloads.subprocess.Popen',return_value=process), \
                patch.object(self.service,'_record_source_success',side_effect=OSError('policy unavailable')), \
                patch.object(self.service,'_complete') as publish:
            self.service._run(self.service._read('a',job['job_id']))
        publish.assert_not_called()
        self.assertEqual(self.service._read('a',job['job_id'])['status'],'paused')
        self.assertFalse(self.store.datasets)

    def test_429_signal_is_retained_when_owner_cancels_before_error_is_consumed(self):
        job = self.service.request_full('a','EUR/USD')
        self.service.node, self.service.worker = 'mock-node', Path('mock-worker')
        class Output:
            def __iter__(stream):
                self.service.cancel('a',job['job_id'])
                yield json.dumps({'event':'error','error':'source_rate_limited','retry_after_seconds':900})
            def close(stream):
                pass
        process = SimpleNamespace(stdout=Output(),terminate=lambda:None,poll=lambda:1,wait=lambda **kwargs:1)
        with patch('trading_workspace_v2.dukascopy_downloads.subprocess.Popen',return_value=process), \
                patch('trading_workspace_v2.dukascopy_downloads.time.time',return_value=10000):
            self.service._run(self.service._read('a',job['job_id']))
        self.assertEqual(self.service._read('a',job['job_id'])['status'],'cancelled')
        self.assertEqual(self.service._source_policy(),{'until':10900,'rate_limit_level':1})

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

    def test_pause_preserves_journal_and_blocks_publication_until_worker_exits(self):
        job = self.service.request_full('a','EUR/USD')
        saved = self.service._read('a',job['job_id'])
        saved.update(status='running',completed_days=42,transferred_bytes=123456)
        self.service._save(saved)
        process = SimpleNamespace(terminate=lambda:None)
        self.service.process = process
        paused = self.service.pause('a',job['job_id'])
        self.assertEqual(paused['status'],'pausing')
        self.assertEqual(paused['completed_days'],42)
        self.assertEqual(paused['transferred_bytes'],123456)
        self.assertEqual(self.service.resume('a',job['job_id'])['status'],'pausing')
        with self.assertRaisesRegex(RuntimeError,'download_paused'):
            self.service._continue_check(saved)
        self.service.active = None
        self.assertEqual(self.service.list_jobs('a')['items'][0]['status'],'paused')
        resumed = self.service.resume('a',job['job_id'])
        self.assertEqual(resumed['status'],'queued')
        self.assertEqual(resumed['completed_days'],42)
        self.assertEqual(resumed['transferred_bytes'],123456)

    def test_pause_is_idempotent_and_does_not_resurrect_cancelled_or_completed_jobs(self):
        job = self.service.request_full('a','EUR/USD')
        self.service.active = None
        self.assertEqual(self.service.pause('a',job['job_id'])['status'],'paused')
        self.assertEqual(self.service.pause('a',job['job_id'])['status'],'paused')
        self.assertEqual(self.service.cancel('a',job['job_id'])['status'],'cancelled')
        self.assertEqual(self.service.pause('a',job['job_id'])['status'],'cancelled')
        with self.assertRaisesRegex(ValueError,'download_cancelled'):
            self.service.resume('a',job['job_id'])
        saved = self.service._read('a',job['job_id'])
        saved.update(status='completed')
        self.service._save(saved)
        self.assertEqual(self.service.pause('a',job['job_id'])['status'],'completed')

    def test_pause_refuses_to_overwrite_remote_worker_journal(self):
        job = self.service.request_full('a','EUR/USD')
        self.service.active = None
        @contextmanager
        def remote_owner():
            yield SimpleNamespace(execute=lambda *args:SimpleNamespace(fetchone=lambda:{'owned':False}),commit=lambda:None)
        self.store.connect = remote_owner
        with self.assertRaisesRegex(RuntimeError,'download_busy'):
            self.service.pause('a',job['job_id'])
        self.assertEqual(self.service._read('a',job['job_id'])['status'],'queued')

    def test_worker_finalizes_manual_pause_and_keeps_resumable_progress(self):
        job = self.service.request_full('a','EUR/USD')
        private = self.service._read('a',job['job_id'])
        self.service.node, self.service.worker = 'mock-node', Path('mock-worker')
        terminated = []
        class Output:
            def __iter__(stream):
                yield json.dumps({'event':'progress','completed_days':7,'transferred_bytes':999})
                self.service.pause('a',job['job_id'])
                yield json.dumps({'event':'progress','completed_days':8,'transferred_bytes':1200})
            def close(stream):
                pass
        process = SimpleNamespace(stdout=Output(),terminate=lambda:terminated.append(True),poll=lambda:0,wait=lambda **kwargs:0)
        with patch('trading_workspace_v2.dukascopy_downloads.subprocess.Popen',return_value=process):
            self.service._run(private)
        paused = self.service._read('a',job['job_id'])
        self.assertEqual(paused['status'],'paused')
        self.assertIsNone(paused['error'])
        self.assertEqual(paused['completed_days'],7)
        self.assertEqual(paused['transferred_bytes'],999)
        self.assertEqual(len(terminated),1)
        self.assertIsNone(self.service.active)
        self.assertFalse(self.store.datasets)
        self.assertEqual(self.service.resume('a',job['job_id'])['status'],'queued')

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

    def test_pause_during_processing_never_publishes_incomplete_dataset(self):
        job = self.service.request_full('a','EUR/USD')
        folder = self.service._folder('a',job['job_id'])
        (folder/'candles.csv').write_text('time,open,high,low,close\n1052006400,1,2,1,1\n1052006460,1,2,1,1\n')
        private = self.service._read('a',job['job_id'])
        private['buckets_sha256'] = 'mock'
        real_preview = preview_csv
        def interrupted_preview(*args, **kwargs):
            self.service.pause('a',job['job_id'])
            return real_preview(*args, **kwargs)
        with patch('trading_workspace_v2.dukascopy_downloads.preview_csv',side_effect=interrupted_preview):
            with self.assertRaisesRegex(RuntimeError,'download_paused'):
                self.service._complete(private,folder)
        self.assertEqual(self.service._read('a',job['job_id'])['status'],'pausing')
        self.assertFalse(self.store.datasets)
        self.assertFalse(list(self.artifacts.root.glob('a/datasets/*.parquet')))

    def test_paused_publication_rolls_back_new_artifacts_and_keeps_download_cache(self):
        job = self.service.request_full('a','EUR/USD')
        folder = self.service._folder('a',job['job_id'])
        cached = folder/'raw'/'bucket.json'
        cached.parent.mkdir()
        cached.write_text('cached raw bucket')
        csv = folder/'candles.csv'
        csv.write_text('time,open,high,low,close\n60,1,2,1,1\n120,1,2,1,1\n')
        @contextmanager
        def pause_before_publication():
            self.service.pause('a',job['job_id'])
            self.service._continue_check(self.service._read('a',job['job_id']))
            yield
        with self.assertRaisesRegex(RuntimeError,'download_paused'):
            self.service.ingest.import_csv(workspace_id='a',path=csv,
                source=source('2003-05-04',self.yesterday.isoformat()),instrument='EUR/USD',
                timeframe_seconds=60,publication_guard=pause_before_publication())
        self.assertFalse(list(self.artifacts.root.glob('a/raw/**/source.csv')))
        self.assertFalse(list(self.artifacts.root.glob('a/datasets/*.parquet')))
        self.assertFalse(self.store.datasets)
        self.assertEqual(cached.read_text(),'cached raw bucket')
        self.assertTrue(csv.is_file())
        self.assertEqual(self.service._read('a',job['job_id'])['status'],'pausing')

    def test_remote_cancel_cannot_overwrite_active_owner_progress_or_publication(self):
        job = self.service.request_full('a','EUR/USD')
        private = self.service._read('a',job['job_id'])
        private['status'] = 'running'
        self.service._save(private)
        self.service.active = None
        @contextmanager
        def denied_lock():
            yield SimpleNamespace(execute=lambda sql,args:SimpleNamespace(fetchone=lambda:{'owned':False}),commit=lambda:None)
        with patch.object(self.store,'dedicated_connection',denied_lock):
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
