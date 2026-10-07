"""Scoped real-data download/API/replay checks on a UUID disposable loopback DB."""
import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path
from uuid import uuid4

import httpx
import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from fastapi.testclient import TestClient
import uvicorn

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'foundation_v2'), str(ROOT)]
from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
from trading_workspace_v2.dukascopy_catalog import DukascopyCatalog
from trading_workspace_v2.dukascopy_downloads import DukascopyDownloads
from trading_workspace_v2.data_ingest import preview_csv


def main():
    out = ROOT / 'foundation_v2/evidence/dukascopy-integration-20261008'
    out.mkdir(parents=True, exist_ok=True)
    config = conninfo_to_dict(os.environ['TW_V2_DATABASE_URL'])
    assert config.get('host') in {'localhost','127.0.0.1','::1'}
    name = 'dukascopy_qa_' + uuid4().hex
    admin = make_conninfo(**{**config,'dbname':'postgres'})
    dsn = make_conninfo(**{**config,'dbname':name})
    report = {'scope':'UUID disposable DB, one real anonymous EUR/USD M1/Bid day, no MT5', 'checks':[]}
    server = None
    with psycopg.connect(admin,autocommit=True) as conn:
        conn.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
    try:
        with tempfile.TemporaryDirectory(prefix='dukascopy-qa-') as temporary:
            catalog = DukascopyCatalog(Path(temporary)/'catalog.json')
            catalog.refresh()
            assert catalog.status()['status'] == 'cached', catalog.status()
            auth = LocalWorkspaceAuthorization.for_local_owner(['tenant-a','tenant-b'])
            app = create_app(dsn=dsn,artifact_root=temporary,authorization=auth,instrument_catalog=catalog,dukascopy_downloads_factory=DukascopyDownloads)
            with TestClient(app) as client:
                headers={'X-Workspace-Id':'tenant-a'}
                other={'X-Workspace-Id':'tenant-b'}
                payload=client.get('/api/v2/data/datasets',headers=headers).json()
                assert payload['items'] == [] and payload['download_state']['available']
                report['catalog_count']=len(payload['catalog_items'])
                request={'instrument_id':'EUR/USD','from_date':'2026-10-05','to_date':'2026-10-05'}
                assert client.post('/api/v2/data/downloads',headers={'X-Workspace-Id':'denied'},json=request).status_code == 403
                for change in [{'to_date':'2099-01-01'},{'from_date':'2020-01-01'},{'instrument_id':'../../bad'}]:
                    assert client.post('/api/v2/data/downloads',headers=headers,json={**request,**change}).status_code == 422
                started=client.post('/api/v2/data/downloads',headers=headers,json=request)
                assert started.status_code == 202, started.text
                job_id=started.json()['job_id']
                assert client.post(f'/api/v2/data/downloads/{job_id}/resume',headers=other).status_code == 404
                assert client.get('/api/v2/data/downloads',headers=other).json()['items'] == []
                deadline=time.monotonic()+45
                while time.monotonic()<deadline:
                    job=client.get('/api/v2/data/downloads',headers=headers).json()['items'][0]
                    if job['status'] not in {'running','queued'}: break
                    time.sleep(.15)
                assert job['status']=='completed', job
                report['real_job']=job
                data=client.get('/api/v2/data/datasets',headers=headers).json()['items']
                assert len(data)==1 and data[0]['row_count']>1000 and data[0]['instrument_spec'] is None
                assert data[0]['source']['provider']=='Dukascopy' and data[0]['asset_class']=='fx'
                assert data[0]['quality']['coverage']['trailing_missing_intervals']==1
                report['checks'].append('requested range edges remain unknown and require review when absent')
                assert client.post('/api/v2/data/downloads',headers=headers,json=request).json()['job_id']==job_id
                assert len(client.get('/api/v2/data/datasets',headers=headers).json()['items'])==1
                session=client.post('/api/v2/replay/sessions',headers=headers,json={'dataset_id':job['dataset_id'],'start_index':10})
                assert session.is_success,session.text
                report['replay_created']=True
                raw=app.state.downloads._folder('tenant-a',job_id)/'raw'
                assert len(list(raw.glob('*.json')))==1
                report['checks'] += ['keyless real catalog','date/support validation','auth and cross-workspace denial', 'real price-only immutable ingest', 'no synthetic timestamps','duplicate request idempotency','replay session created']
                # Corrupt OHLC and duplicate timestamps must not become approved imports.
                bad=Path(temporary)/'bad.csv'
                bad.write_text('time,open,high,low,close\n1,2,1,2,2\n2,2,2,2,2\n')
                try: preview_csv(bad,data[0]['source'],'EUR/USD',60)
                except ValueError: pass
                else: raise AssertionError('invalid OHLC accepted')
                restarted=DukascopyDownloads(app.state.store,app.state.downloads.artifacts,catalog,auth)
                assert restarted.list_jobs('tenant-a')['items'][0]['status']=='completed'
                restarted.stop()
                report['checks'].append('restart reads saved jobs without upstream request')
                # Labeled fault injection: no requests to Dukascopy for failure/cancel checks.
                runtime = app.state.downloads
                original_worker = runtime.worker
                fake = Path(temporary) / 'fault-worker.mjs'
                fake.write_text("console.log(JSON.stringify({event:'error',error:'source_rate_limited',retry_after_seconds:600}));process.exitCode=1")
                runtime.worker = fake
                paused_id = client.post('/api/v2/data/downloads',headers=headers,json={**request,'from_date':'2026-10-06','to_date':'2026-10-06'}).json()['job_id']
                while runtime.active: time.sleep(.05)
                paused = next(i for i in runtime.list_jobs('tenant-a')['items'] if i['job_id']==paused_id)
                assert paused['status']=='paused' and paused['error']=='source_rate_limited' and paused['retry_after_seconds']>500
                assert client.post(f'/api/v2/data/downloads/{paused_id}/resume',headers=headers).status_code==409
                runtime.cancel('tenant-a',paused_id)
                (runtime.root/'cooldown.json').unlink()
                fake.write_text("console.log(JSON.stringify({event:'progress',completed_days:0}));setTimeout(()=>{},30000)")
                cancel_id = client.post('/api/v2/data/downloads',headers=headers,json={**request,'from_date':'2026-10-04','to_date':'2026-10-04'}).json()['job_id']
                deadline=time.monotonic()+5
                while runtime._read('tenant-a',cancel_id)['status']!='running' and time.monotonic()<deadline: time.sleep(.05)
                remote=DukascopyDownloads(app.state.store,runtime.artifacts,catalog,auth)
                assert next(i for i in remote.list_jobs('tenant-a')['items'] if i['job_id']==cancel_id)['status']=='running'
                try: remote.resume('tenant-a',cancel_id)
                except RuntimeError as exc: assert str(exc)=='download_busy'
                else: raise AssertionError('second process stole running job')
                remote.stop()
                assert client.post(f'/api/v2/data/downloads/{cancel_id}/cancel',headers=headers).json()['status']=='cancelled'
                while runtime.active: time.sleep(.05)
                assert len(client.get('/api/v2/data/datasets',headers=headers).json()['items'])==1
                orphan=runtime._read('tenant-a',paused_id)
                orphan.update(status='running',retry_at=0)
                runtime._save(orphan)
                assert next(i for i in runtime.list_jobs('tenant-a')['items'] if i['job_id']==paused_id)['status']=='paused'
                runtime.cancel('tenant-a',paused_id)
                runtime.worker=original_worker
                report['checks'].append('fault-injected 429 cooldown, no phantom dataset, cancel, orphan recovery, remote-owner resume denied')
                if '--serve' in sys.argv:
                    server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=8031,log_level='warning'))
                    threading.Thread(target=server.run,daemon=True).start()
                    report['qa_url']='http://127.0.0.1:8031'
                    (out/'integration-running.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
                    print('QA_READY http://127.0.0.1:8031',flush=True)
                    while not (out/'STOP_QA').exists(): time.sleep(.5)
                    server.should_exit=True
                report['pass']=True
    finally:
        if server: server.should_exit=True
        with psycopg.connect(admin,autocommit=True) as conn:
            conn.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))
    (out/'integration.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report),flush=True)


if __name__ == '__main__': main()
