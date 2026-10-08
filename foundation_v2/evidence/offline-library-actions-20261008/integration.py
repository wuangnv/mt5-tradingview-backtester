"""Actual API/store/artifacts on a UUID disposable DB; synthetic offline worker only."""
import json
import io
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from fastapi.testclient import TestClient
import uvicorn

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT / 'foundation_v2'), str(ROOT)]
from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
from trading_workspace_v2.data_ingest import DataIngestService
from trading_workspace_v2.dukascopy_downloads import DukascopyDownloads

OUT = Path(__file__).parent
REPORT = {'scope':'UUID disposable loopback PostgreSQL, real API/artifact writes with synthetic worker; no provider/broker/user-data actions','checks':[]}

class FixtureCatalog:
    provider_id = 'dukascopy-fixture'
    capabilities = {'read_metadata':True}
    def list_datasets(self, workspace): return []
    def list_instruments(self, workspace):
        return [{'instrument_id':symbol,'provider':'Dukascopy','provider_code':symbol.replace('/','-'),'asset_class':'fx'} for symbol in ['EUR/USD','GBP/USD']]
    def status(self): return {'configured':True,'status':'cached','item_count':2,'retrieved_at_utc':'2026-10-07T00:00:00Z','refresh_available':False}

WORKER = """
import {readFile,writeFile} from 'node:fs/promises';import {dirname,join} from 'node:path';
const request=JSON.parse(await readFile(process.argv[2],'utf8')),folder=dirname(process.argv[2]),day=86400000;
const start=Date.parse(request.from_date+'T00:00:00Z'),end=Date.parse(request.to_date+'T00:00:00Z'),total=(end-start)/day+1;
let csv='time,open,high,low,close,volume\\n';
for(let i=0;i<total;i++){const ts=(start+i*day)/1000;csv+=`${ts},1,2,1,1,0\\n${ts+60},1,2,1,1,1\\n`;
console.log(JSON.stringify({event:'progress',completed_days:i+1,total_days:total,transferred_bytes:(request.transferred_bytes||0)+(i+1)*1048576,stage:'downloading'}));await new Promise(r=>setTimeout(r,700));}
await writeFile(join(folder,'candles.csv'),csv);console.log(JSON.stringify({event:'complete',buckets_sha256:'a'.repeat(64)}));
"""

def wait_job(runtime, job_id):
    deadline=time.monotonic()+15
    while time.monotonic()<deadline:
        job=next(item for item in runtime.list_jobs('tenant-a')['items'] if item['job_id']==job_id)
        if job['status'] not in {'queued','running'} and runtime.active is None: return job
        time.sleep(.05)
    raise AssertionError('fixture job timeout')

def main():
    config=conninfo_to_dict(os.environ['TW_V2_DATABASE_URL'])
    assert config.get('host') in {'127.0.0.1','localhost','::1'}
    name='offline_actions_qa_'+uuid4().hex
    admin=make_conninfo(**{**config,'dbname':'postgres'})
    dsn=make_conninfo(**{**config,'dbname':name})
    with psycopg.connect(admin,autocommit=True) as conn: conn.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
    server=None; thread=None
    try:
        with tempfile.TemporaryDirectory(prefix='tw-offline-actions-') as temporary:
            directory=Path(temporary); worker=directory/'fixture-worker.mjs';worker.write_text(WORKER)
            end=datetime.now(timezone.utc).date()-timedelta(days=1); start=end-timedelta(days=2)
            def factory(store,artifacts,catalog,authorization):
                runtime=DukascopyDownloads(store,artifacts,catalog,authorization)
                runtime.meta={symbol:{'name':symbol,'code':symbol.replace('/','-'),'startDayForMinuteCandles':start.isoformat()+'T00:00:00Z'} for symbol in ['EUR/USD','GBP/USD']}
                runtime.worker=worker
                return runtime
            app=create_app(dsn=dsn,artifact_root=directory,authorization=LocalWorkspaceAuthorization.for_local_owner(['tenant-a','tenant-b']),instrument_catalog=FixtureCatalog(),dukascopy_downloads_factory=factory)
            runtime=app.state.downloads
            csv=directory/'seed.csv';stamp=int(datetime.combine(start,datetime.min.time(),tzinfo=timezone.utc).timestamp())
            csv.write_text(f'time,open,high,low,close,volume\n{stamp},1,2,1,1,0\n{stamp+60},1,2,1,1,1\n')
            settings={'library':'dukascopy-node@1.50.0','price':'bid','timeframe':'m1','requested_from':start.isoformat(),'requested_to':start.isoformat()}
            source={'source_id':'qa-duka','provider':'Dukascopy','license_use':'qa-only','instrument_mapping':{'EUR-USD':'EUR/USD'},'retrieved_at_utc':datetime.now(timezone.utc).isoformat(),'export_settings':json.dumps(settings)}
            partial=DataIngestService(app.state.store,runtime.artifacts).import_csv(workspace_id='tenant-a',path=csv,source=source,instrument='EUR/USD',timeframe_seconds=60)
            with TestClient(app) as client:
                headers={'X-Workspace-Id':'tenant-a'}
                data=client.get('/api/v2/data/datasets',headers=headers).json();saved=data['items'][0]
                assert saved['size_bytes']==(directory/partial.artifact_path).stat().st_size
                assert saved['update_available'] and data['download_state']['supports_full']
                assert client.post('/api/v2/data/downloads/full',headers={'X-Workspace-Id':'denied'},json={'instrument_id':'EUR/USD'}).status_code==403
                assert client.post('/api/v2/data/downloads/full',headers={'X-Workspace-Id':'tenant-b'},json={'instrument_id':'EUR/USD','dataset_id':partial.dataset_id}).status_code==422
                assert client.post('/api/v2/data/downloads/full',headers=headers,json={'instrument_id':'EUR/USD','from_date':start.isoformat()}).status_code==422
                started=client.post('/api/v2/data/downloads/full',headers=headers,json={'instrument_id':'EUR/USD','dataset_id':partial.dataset_id})
                assert started.status_code==202,started.text
                assert client.delete(f'/api/v2/data/datasets/{partial.dataset_id}',headers=headers).status_code==409
                job=wait_job(runtime,started.json()['job_id']);assert job['status']=='completed',job
                data=client.get('/api/v2/data/datasets',headers=headers).json()
                full=next(item for item in data['items'] if item['dataset_id']==job['dataset_id'])
                assert full['full_history'] and not full['update_available'] and full['row_count']==6
                assert full['coverage_from_date']==start.isoformat() and full['coverage_to_date']==end.isoformat()
                assert app.state.store.get_dataset('tenant-a',partial.dataset_id) is not None
                assert client.post('/api/v2/data/downloads/full',headers=headers,json={'instrument_id':'EUR/USD','dataset_id':full['dataset_id']}).json()['detail']=='already_current'
                assert client.delete(f"/api/v2/data/datasets/{full['dataset_id']}",headers={'X-Workspace-Id':'tenant-b'}).status_code==404
                assert client.delete(f"/api/v2/data/datasets/{full['dataset_id']}",headers=headers).status_code==200
                assert not (directory/full['artifact_path']).exists() and not (directory/full['raw_artifact_path']).exists()
                assert len(client.get('/api/v2/data/datasets',headers=headers).json()['catalog_items'])==2
                recreated=client.post('/api/v2/data/downloads/full',headers=headers,json={'instrument_id':'EUR/USD'}).json()
                assert recreated['job_id']!=job['job_id'];assert wait_job(runtime,recreated['job_id'])['status']=='completed'
                replay=client.post('/api/v2/replay/sessions',headers=headers,json={'dataset_id':partial.dataset_id,'start_index':0})
                assert replay.is_success,replay.text
                assert client.delete(f'/api/v2/data/datasets/{partial.dataset_id}',headers=headers).json()['detail']=='dataset_in_use'
                REPORT['checks'] += ['actual Parquet size','full request authorization/date override denied','partial backfill immutable','worker mutation guard','already-current disabled contract','cross-workspace delete denied','exact file delete/catalog retained','deleted completed job redownload','session pin deletion conflict']
                server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=8032,log_level='warning'))
                thread=threading.Thread(target=server.run,daemon=True);thread.start()
                deadline=time.monotonic()+5
                while not server.started and time.monotonic()<deadline: time.sleep(.05)
                assert server.started
                result=subprocess.run(['node',str(OUT/'integration-ui.mjs')],env={**os.environ,'TW_OFFLINE_QA_BACKEND':'http://127.0.0.1:8032'},timeout=60,capture_output=True,text=True)
                assert result.returncode==0,result.stdout+result.stderr
                REPORT['checks'].append('actual fixture-service browser journey PASS')
                server.should_exit=True;thread.join(timeout=5)
            # These legacy tests TRUNCATE, so run only after services stop and
            # explicitly bind them to this UUID database, never the owner DSN.
            previous_dsn=os.environ['TW_V2_DATABASE_URL']
            os.environ['TW_V2_DATABASE_URL']=dsn
            try:
                output=io.StringIO()
                suite=unittest.defaultTestLoader.discover(str(ROOT/'foundation_v2/tests'),pattern='test_u2_data_ingest.py')
                results=unittest.TextTestRunner(stream=output,verbosity=2).run(suite)
                (OUT/'ingest-regression.txt').write_text(output.getvalue(),encoding='utf-8')
                assert results.wasSuccessful(),output.getvalue()
                REPORT['checks'].append(f'existing U2 ingest regressions {results.testsRun} PASS on disposable DB')
            finally:os.environ['TW_V2_DATABASE_URL']=previous_dsn
            REPORT['pass']=True
    finally:
        if server: server.should_exit=True
        if thread: thread.join(timeout=5)
        with psycopg.connect(admin,autocommit=True) as conn: conn.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))
        (OUT/'integration-results.json').write_text(json.dumps(REPORT,indent=2),encoding='utf-8')
    print(json.dumps(REPORT))

if __name__=='__main__':main()
