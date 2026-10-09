"""PostgreSQL download authority with synthetic CLI/files and a disposable DB."""
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import traceback
from types import SimpleNamespace
from uuid import uuid4

import pytest

sys.path[:0]=[str(Path(__file__).resolve().parents[1]),str(Path(__file__).resolve().parents[2])]

from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.download_job_store import DownloadJobStore, DownloadRevisionConflict, public_download_snapshot
from trading_workspace_v2.qdm_cli import QdmCatalog
from trading_workspace_v2.qdm_downloads import QdmDownloads
from trading_workspace_v2.store import PostgresStore
from test_qdm_downloads import FixtureCli


@pytest.fixture
def store():
    if os.environ.get('TW_V2_ALLOW_DESTRUCTIVE_TEST_DB') != '1' or not os.environ.get('TW_V2_DATABASE_URL'):
        pytest.skip('requires explicitly disposable PostgreSQL fixture')
    item = PostgresStore(os.environ['TW_V2_DATABASE_URL'], pool_size=3)
    item.initialize()
    yield item
    item.close()


def job(workspace=None):
    return {'workspace_id': workspace or 'download-fixture-'+uuid4().hex, 'job_id': uuid4().hex,
            'instrument_id':'EURUSD','from_date':'2026-01-01','to_date':'2026-01-02',
            'parent_dataset_id':None,'full_from_date':None,'status':'paused','error':None,
            'created_at_utc':datetime.now(timezone.utc).isoformat(),'transferred_bytes':None}


def snapshot(item):
    return {key:value for key,value in item.items() if key not in {'workspace_id','retry_at'}}


def test_snapshot_keeps_unknown_sensitive_fields_private():
    assert public_download_snapshot({'job_id':'public','provider_credentials':'secret','lease_token':'secret',
        'local_path':'private','workspace_id':'private'})=={'job_id':'public'}
    with pytest.raises(ValueError,match='invalid_download_snapshot'):
        public_download_snapshot({'error':{'secret':'hidden'}})


def test_revision_scope_and_legacy_adoption_never_overwrite(store):
    repository = DownloadJobStore(store,'fixture-'+uuid4().hex)
    item = job()
    assert repository.save(item,snapshot(item),123)
    stale = deepcopy(item)
    item.update(completed_days=2)
    repository.save(item,snapshot(item),123)
    with pytest.raises(DownloadRevisionConflict):
        repository.save(stale,snapshot(stale),123)
    assert not repository.save(stale,snapshot(stale),123,adopt=True)
    assert repository.read(item['workspace_id'],item['job_id'])['completed_days']==2
    assert repository.list('other')==[]
    with pytest.raises(ValueError,match='download_not_found'):
        repository.read('other',item['job_id'])
    assert repository.matching(item['workspace_id'],'EURUSD','2026-01-01','2026-01-02',None,None)[0]['job_id']==item['job_id']


def test_physical_owner_crash_and_qdm_unknown_units(store):
    repository = DownloadJobStore(store,'fixture-'+uuid4().hex)
    item = job()
    item.update(status='running',supports_pause=False,supports_cancel=False,progress_percent=50,progress_scope='phase')
    key = -1234567
    with store.dedicated_connection() as owner:
        owner.execute('SELECT pg_advisory_lock(%s)',(key,))
        repository.save(item,snapshot(item),key)
        running = repository.list(item['workspace_id'])[0]
        assert running['status']=='running' and running['transferred_bytes'] is None
        assert running['progress_percent']==50 and not running['supports_pause']
    interrupted = repository.list(item['workspace_id'])[0]
    assert interrupted['status']=='paused' and interrupted['error']=='download_interrupted'
    assert interrupted['revision']==running['revision']


def test_queued_grace_expiry_and_source_cooldown(store):
    repository = DownloadJobStore(store,'fixture-'+uuid4().hex)
    item = job()
    item.update(status='queued')
    repository.save(item,snapshot(item),123)
    assert repository.list(item['workspace_id'])[0]['status']=='queued'
    with store.connect() as conn:
        conn.execute("UPDATE download_jobs SET updated_at_utc=CURRENT_TIMESTAMP-interval '1 minute' WHERE job_id=%s",(item['job_id'],))
    assert repository.list(item['workspace_id'])[0]['status']=='paused'
    item.update(status='paused')
    repository.save(item,snapshot(item),123)
    repository.source({'available':True,'cooldown_until':datetime.now(timezone.utc).timestamp()+60})
    assert 58 <= repository.list(item['workspace_id'])[0]['retry_after_seconds'] <= 61


def test_atomic_completion_rolls_back_job_and_dataset_together(store,tmp_path,monkeypatch):
    cli = FixtureCli(tmp_path/'cli')
    service = QdmDownloads(store,ArtifactStore(tmp_path/'artifacts'),QdmCatalog(cli),SimpleNamespace(authorize=lambda _:None))
    service._start = lambda item: setattr(service,'active',(item['workspace_id'],item['job_id']))
    workspace = 'a'+uuid4().hex[:8]
    created = service.request(workspace,'EUR/USD','2026-01-01','2026-01-01')
    save = service.jobs.save
    def fail_completion(item,*args,**kwargs):
        if item['status']=='completed':
            raise DownloadRevisionConflict()
        return save(item,*args,**kwargs)
    monkeypatch.setattr(service.jobs,'save',fail_completion)
    service._run(service._read(workspace,created['job_id']))
    assert service._read(workspace,created['job_id'])['status']=='failed'
    with store.connect() as conn:
        assert conn.execute('SELECT count(*) AS n FROM datasets WHERE workspace_id=%s',(workspace,)).fetchone()['n']==0
    monkeypatch.setattr(service.jobs,'save',save)
    resumed = service.resume(workspace,created['job_id'])
    complete = service._complete
    caught = []
    def recording_complete(*args):
        try:
            return complete(*args)
        except Exception as exc:
            caught.append(traceback.format_exc())
            raise
    monkeypatch.setattr(service,'_complete',recording_complete)
    service._run(service._read(workspace,resumed['job_id']))
    completed = service.jobs.list(workspace)[0]
    assert completed['status']=='completed', (completed,caught)
    assert store.get_dataset(workspace,completed['dataset_id']) is not None


def test_explicit_legacy_import_is_idempotent_and_checkpoint_cannot_override_db(store,tmp_path):
    cli = FixtureCli(tmp_path/'cli')
    service = QdmDownloads(store,ArtifactStore(tmp_path/'artifacts'),QdmCatalog(cli),SimpleNamespace(authorize=lambda _:None))
    item = job()
    item.update(status='running')
    folder = service._folder(item['workspace_id'],item['job_id'])
    folder.mkdir(parents=True)
    (folder/'job.json').write_text(json.dumps(item),encoding='utf-8')
    assert service.list_jobs(item['workspace_id'])['items']==[]
    assert service.adopt_legacy(item['workspace_id'])==1
    assert service._read(item['workspace_id'],item['job_id'])['status']=='paused'
    item.update(status='completed',dataset_id='fake')
    (folder/'job.json').write_text(json.dumps(item),encoding='utf-8')
    assert service.adopt_legacy(item['workspace_id'])==0
    assert service._read(item['workspace_id'],item['job_id'])['status']=='paused'
    with store.dedicated_connection() as owner:
        owner.execute('SELECT pg_advisory_lock(%s)',(service.advisory_key,))
        with pytest.raises(RuntimeError,match='download_busy'):
            service.adopt_legacy(item['workspace_id'])


def test_losing_source_executor_cannot_overwrite_existing_remote_owner(store,tmp_path):
    cli = FixtureCli(tmp_path/'cli')
    service = QdmDownloads(store,ArtifactStore(tmp_path/'artifacts'),QdmCatalog(cli),SimpleNamespace(authorize=lambda _:None))
    item = job()
    item['instrument_id']='EUR/USD'
    service._save(item)
    with store.dedicated_connection() as owner:
        owner.execute('SELECT pg_advisory_lock(%s)',(service.advisory_key,))
        owner.execute('SELECT pg_advisory_lock(%s)',(service._job_key(item),))
        latest = service._read(item['workspace_id'],item['job_id'])
        latest.update(status='running',progress_percent=75)
        service._save(latest)
        service._run(item)
        remaining = service._read(item['workspace_id'],item['job_id'])
        assert remaining['status']=='running' and remaining['progress_percent']==75
        assert remaining['revision']==latest['revision']
