from __future__ import annotations

import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

sys.path[:0] = [str(Path(__file__).resolve().parents[2]), str(Path(__file__).resolve().parents[1])]
from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.data_ingest import DataIngestService
from trading_workspace_v2.data_sources import LocalCatalogProvider
from trading_workspace_v2.local_datasets import LocalDatasetService, DatasetInUse
from trading_workspace_v2.store import PostgresStore


class ExactDatasetPathsTests(unittest.TestCase):
    def test_paths_reject_cross_workspace_traversal_and_absolute_paths(self):
        with tempfile.TemporaryDirectory() as temp:
            artifacts = ArtifactStore(temp)
            for value in ['../victim.parquet', 'other/datasets/d.parquet', str(Path(temp)/'w/datasets/d.parquet')]:
                with self.assertRaises(ValueError): artifacts.dataset_paths('w','d',value)
            self.assertEqual(artifacts.dataset_paths('w','d','w/datasets/d.parquet'),[Path(temp)/'w/datasets/d.parquet'])

    def test_symlink_file_is_not_an_owned_dataset(self):
        with tempfile.TemporaryDirectory() as temp:
            artifacts=ArtifactStore(temp);target=Path(temp)/'w/datasets/d.parquet';target.parent.mkdir(parents=True)
            outside=Path(temp)/'unrelated';outside.write_bytes(b'keep')
            try:target.symlink_to(outside)
            except OSError:self.skipTest('local Windows symlink privilege unavailable')
            with self.assertRaises(ValueError):artifacts.dataset_paths('w','d','w/datasets/d.parquet')
            self.assertEqual(outside.read_bytes(),b'keep')

    def test_artifact_cancellation_before_publish_leaves_no_target(self):
        with tempfile.TemporaryDirectory() as temp:
            artifacts = ArtifactStore(temp)
            source = Path(temp)/'input.csv'; source.write_bytes(b'a'*2048)
            def cancel(): raise RuntimeError('download_cancelled')
            with self.assertRaisesRegex(RuntimeError,'download_cancelled'):
                artifacts.write_raw_source('w','d',source,continue_check=cancel)
            with self.assertRaisesRegex(RuntimeError,'download_cancelled'):
                artifacts.write_dataset_iter('w','d',[{'timestamp':1}],continue_check=cancel)
            self.assertFalse((Path(temp)/'w/raw/d/source.csv').exists())
            self.assertFalse((Path(temp)/'w/datasets/d.parquet').exists())


@unittest.skipUnless(os.getenv('TW_V2_DATABASE_URL'), 'loopback PostgreSQL fixture not configured')
class LocalDatasetRemovalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        config=conninfo_to_dict(os.environ['TW_V2_DATABASE_URL'])
        if config.get('host') not in {'localhost','127.0.0.1','::1'}: raise unittest.SkipTest('loopback required')
        cls.name='dataset_delete_qa_'+uuid4().hex
        cls.admin=make_conninfo(**{**config,'dbname':'postgres'})
        with psycopg.connect(cls.admin,autocommit=True) as conn:
            conn.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(cls.name)))
        cls.store=PostgresStore(make_conninfo(**{**config,'dbname':cls.name}));cls.store.initialize()

    @classmethod
    def tearDownClass(cls):
        cls.store.close()
        with psycopg.connect(cls.admin,autocommit=True) as conn:
            conn.execute(sql.SQL('DROP DATABASE {}').format(sql.Identifier(cls.name)))

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.artifacts=ArtifactStore(self.temp.name);self.workspace='qa-'+uuid4().hex
        self.service=LocalDatasetService(self.store,self.artifacts)
        path=Path(self.temp.name)/'input.csv';path.write_text('time,open,high,low,close,volume\n60,1,2,1,1,0\n120,1,2,1,1,1\n')
        source={'source_id':'delete-test','provider':'Dukascopy','license_use':'qa-only','instrument_mapping':{'EUR-USD':'EUR/USD'},'retrieved_at_utc':'2026-01-01T00:00:00Z','export_settings':'synthetic fixture'}
        self.source,self.csv=source,path
        self.manifest=DataIngestService(self.store,self.artifacts).import_csv(workspace_id=self.workspace,path=path,source=source,instrument='EUR/USD',timeframe_seconds=60)
        self.paths=self.artifacts.dataset_paths(self.workspace,self.manifest.dataset_id,self.manifest.artifact_path,self.manifest.raw_artifact_path)

    def test_size_is_actual_parquet_bytes_and_removal_is_exact(self):
        item=LocalCatalogProvider(self.store,self.artifacts).list_datasets(self.workspace)[0]
        self.assertEqual(item['size_bytes'],self.paths[0].stat().st_size)
        sibling=self.paths[0].with_name('other.parquet');sibling.write_bytes(b'keep')
        extra=self.paths[1].with_name('notes.txt');extra.write_text('keep')
        self.assertTrue(self.service.delete_dataset(self.workspace,self.manifest.dataset_id)['deleted'])
        self.assertIsNone(self.store.get_dataset(self.workspace,self.manifest.dataset_id))
        self.assertTrue(all(not path.exists() for path in self.paths));self.assertEqual(sibling.read_bytes(),b'keep');self.assertEqual(extra.read_text(),'keep')

    def test_wrong_workspace_and_unknown_do_not_touch_files(self):
        with self.assertRaisesRegex(LookupError,'dataset_not_found'):self.service.delete_dataset('other',self.manifest.dataset_id)
        self.assertTrue(all(path.exists() for path in self.paths))

    def test_missing_file_size_is_unknown_and_missing_files_can_be_removed(self):
        self.paths[0].unlink()
        self.assertIsNone(LocalCatalogProvider(self.store,self.artifacts).list_datasets(self.workspace)[0]['size_bytes'])
        self.assertTrue(self.service.delete_dataset(self.workspace,self.manifest.dataset_id)['deleted'])

    def test_concurrent_replay_pin_cannot_reference_deleted_dataset(self):
        started, finished = threading.Event(), threading.Event()
        result=[]
        def pin():
            started.set()
            try:self.store.create_record(self.workspace,'replay',{'dataset_id':self.manifest.dataset_id})
            except LookupError as error:result.append(str(error))
            finally:finished.set()
        with self.store.dataset_removal(self.workspace,self.manifest.dataset_id):
            thread=threading.Thread(target=pin);thread.start();self.assertTrue(started.wait(2))
            self.assertFalse(finished.wait(.2))
        thread.join(5);self.assertTrue(finished.is_set());self.assertEqual(result,['dataset_not_found'])

    def test_concurrent_prop_resume_pin_cannot_reference_deleted_dataset(self):
        started,finished=threading.Event(),threading.Event();result=[]
        def pin():
            started.set()
            try:
                with self.store.connect() as conn:
                    self.store._lock_resume_datasets(conn,self.workspace,{'nested':{'dataset_id':self.manifest.dataset_id}})
            except LookupError as error:result.append(str(error))
            finally:finished.set()
        with self.store.dataset_removal(self.workspace,self.manifest.dataset_id):
            thread=threading.Thread(target=pin);thread.start();self.assertTrue(started.wait(2));self.assertFalse(finished.wait(.2))
        thread.join(5);self.assertTrue(finished.is_set());self.assertEqual(result,['dataset_not_found'])

    def test_reimport_waits_until_old_exact_files_are_removed(self):
        cleanup,release,started,finished=threading.Event(),threading.Event(),threading.Event(),threading.Event()
        original=Path.unlink;failures=[]
        def hold(path,*args,**kwargs):
            if path==self.paths[0] and not cleanup.is_set():
                cleanup.set()
                if not release.wait(5):raise TimeoutError('fixture cleanup release missing')
            return original(path,*args,**kwargs)
        def delete():
            try:self.service.delete_dataset(self.workspace,self.manifest.dataset_id)
            except Exception as error:failures.append(error)
        def import_again():
            started.set()
            try:DataIngestService(self.store,self.artifacts).import_csv(workspace_id=self.workspace,path=self.csv,source=self.source,instrument='EUR/USD',timeframe_seconds=60)
            except Exception as error:failures.append(error)
            finally:finished.set()
        with patch.object(Path,'unlink',hold):
            deleting=threading.Thread(target=delete);deleting.start()
            try:
                self.assertTrue(cleanup.wait(3));importing=threading.Thread(target=import_again);importing.start()
                self.assertTrue(started.wait(2));self.assertFalse(finished.wait(.2))
            finally:release.set()
            deleting.join(5);importing.join(5)
        self.assertTrue(finished.is_set());self.assertEqual(failures,[])
        self.assertIsNotNone(self.store.get_dataset(self.workspace,self.manifest.dataset_id));self.assertTrue(all(path.exists() for path in self.paths))

    def test_research_pin_conflicts_and_preserves_catalog_and_files(self):
        self.store.create_job(self.workspace,self.manifest.dataset_id,'close-delta-v1',1000)
        with self.assertRaises(DatasetInUse):self.service.delete_dataset(self.workspace,self.manifest.dataset_id)
        self.assertIsNotNone(self.store.get_dataset(self.workspace,self.manifest.dataset_id));self.assertTrue(all(path.exists() for path in self.paths))

    def test_historical_archived_replay_pin_conflicts(self):
        record=self.store.create_record(self.workspace,'replay',{'dataset_id':self.manifest.dataset_id,'archived':True})
        self.store.update_record(self.workspace,'replay',record['record_id'],record['revision'],{'archived':True})
        with self.assertRaises(DatasetInUse):self.service.delete_dataset(self.workspace,self.manifest.dataset_id)
        self.assertTrue(all(path.exists() for path in self.paths))

    def test_nested_prop_resume_pin_conflicts(self):
        with self.store.connect() as conn:
            conn.execute("INSERT INTO prop_sessions VALUES(%s,'s',1,'{}','t','t')",(self.workspace,))
            conn.execute("INSERT INTO prop_attempts VALUES(%s,'s','a',1,'{}','{}','{}','t','t')",(self.workspace,))
            conn.execute("INSERT INTO prop_attempt_revisions VALUES(%s,'s','a',1,'{}','{}',%s::jsonb,'t')",(self.workspace,'{"nested":{"dataset_id":"'+self.manifest.dataset_id+'"}}'));conn.commit()
        with self.assertRaises(DatasetInUse):self.service.delete_dataset(self.workspace,self.manifest.dataset_id)
        self.assertTrue(all(path.exists() for path in self.paths))

    def test_file_failure_keeps_journal_for_exact_retry(self):
        original=Path.unlink
        def fail(path,*args,**kwargs):
            if path==self.paths[1]:raise PermissionError('fixture sharing violation')
            return original(path,*args,**kwargs)
        with patch.object(Path,'unlink',fail):
            with self.assertRaises(PermissionError):self.service.delete_dataset(self.workspace,self.manifest.dataset_id)
        self.assertIsNone(self.store.get_dataset(self.workspace,self.manifest.dataset_id));self.assertTrue(self.paths[1].exists())
        self.assertTrue(self.service.delete_dataset(self.workspace,self.manifest.dataset_id)['deleted']);self.assertFalse(self.paths[1].exists())

    def test_invalid_manifest_path_rolls_back_database(self):
        with self.store.connect() as conn:
            conn.execute("UPDATE datasets SET manifest_json=jsonb_set(manifest_json,'{artifact_path}',%s::jsonb) WHERE workspace_id=%s AND dataset_id=%s", ('"../victim"',self.workspace,self.manifest.dataset_id));conn.commit()
        with self.assertRaises(ValueError):self.service.delete_dataset(self.workspace,self.manifest.dataset_id)
        self.assertIsNotNone(self.store.get_dataset(self.workspace,self.manifest.dataset_id));self.assertTrue(all(path.exists() for path in self.paths))


if __name__=='__main__':unittest.main()
