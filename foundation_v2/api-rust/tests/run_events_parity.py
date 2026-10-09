"""Native jobs/SSE acceptance on an owned disposable cluster; never a user's DB."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from uuid import uuid4

API_RUST = Path(__file__).resolve().parents[1]
V2 = API_RUST.parent
sys.path[:0] = [str(V2.parent), str(V2), str(V2 / 'tests')]
import psycopg
from fastapi.testclient import TestClient
from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.contracts import DatasetManifest, DatasetSource
from trading_workspace_v2.download_job_store import DownloadJobStore, public_download_snapshot
from trading_workspace_v2.store import PostgresStore

def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]

def fixtures(store, artifacts):
    for workspace in ['tenant-a', 'tenant-b', *(f'limit-{n}' for n in range(9))]:
        store.ensure_workspace(workspace)
    source = DatasetSource(source_id='fixture', provider='fixture', instrument_mapping={'EURUSD':'EURUSD'}, license_use='qa-only', retrieved_at_utc='2026-10-09T00:00:00Z', export_settings='fixture')
    for workspace in ['tenant-a','tenant-b']:
        store.put_dataset(DatasetManifest(dataset_id='data', workspace_id=workspace, source=source, instrument_id='EURUSD', timeframe='M1', row_count=2, first_timestamp=60, last_timestamp=120, artifact_path='fixture.parquet', artifact_sha256='0'*64, created_at_utc='2026-10-09T00:00:00Z', timeframe_seconds=60))
    active = store.create_job('tenant-a','data','close-delta-v1',10000)
    completed = store.create_job('tenant-a','data','close-delta-v1',10000)
    empty = store.create_job('tenant-a','data','close-delta-v1',10000)
    isolated = store.create_job('tenant-b','data','close-delta-v1',10000)
    checkpoint={'schema':'research-job-checkpoint-v1','phase':'read','attempt_no':0,'holdout_access':False,'trial_outcomes':[{'trial_id':'trial-1','status':'completed','future':'ignored'}],'future':'ignored'}
    progress={'phase_index':1,'phase_count':2,'trial_index':0,'trial_count':1,'future':True}
    path, digest = artifacts.write_result('tenant-a',completed.job_id, {'fixture':'result','metrics':{'net_pnl':12},'workspace_id':'tenant-a'})
    with store.connect() as conn:
        conn.execute("UPDATE research_jobs SET status='running',checkpoint_json=%s::jsonb,progress_json=%s::jsonb WHERE workspace_id='tenant-a' AND job_id=%s",(json.dumps(checkpoint),json.dumps(progress),active.job_id))
        conn.execute("UPDATE research_jobs SET status='completed',result_path=%s,result_sha256=%s WHERE workspace_id='tenant-a' AND job_id=%s",(path,digest,completed.job_id))
        conn.commit()
    downloads=DownloadJobStore(store,'QuantDataManager')
    downloads.source({'available':True,'supports_pause':False,'supports_cancel':False,'cooldown_until':0})
    payload={'workspace_id':'tenant-a','job_id':'a'*32,'instrument_id':'EURUSD','from_date':'2026-01-01','to_date':'2026-01-02','status':'running','error':None,'completed_days':0,'total_days':2,'provider':'QuantDataManager','transferred_bytes':None,'created_at_utc':'2026-10-09T00:00:00Z','provider_credentials':'private-secret'}
    downloads.save(payload,public_download_snapshot(payload),987654321)
    return active,completed,empty,isolated,checkpoint

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--pg-bin',required=True,type=Path);parser.add_argument('--output',type=Path);args=parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='tw-events-parity-') as folder:
        runtime=Path(folder);pgdata=runtime/'pgdata';port=free_port();
        subprocess.run([str(args.pg_bin/'initdb.exe'),'-D',str(pgdata),'--auth=trust','--username=postgres','--no-locale','--encoding=UTF8'],check=True,capture_output=True)
        log=(runtime/'postgres.log').open('w');postgres=subprocess.Popen([str(args.pg_bin/'postgres.exe'),'-D',str(pgdata),'-h','127.0.0.1','-p',str(port),'-c','max_connections=32'],stdout=log,stderr=log)
        try:
            base=f'host=127.0.0.1 port={port} user=postgres dbname=postgres'
            for _ in range(100):
                try:
                    with psycopg.connect(base,autocommit=True) as conn:
                        database='events_parity_'+uuid4().hex;conn.execute(f'CREATE DATABASE {database}')
                    break
                except psycopg.OperationalError:
                    if postgres.poll() is not None:raise RuntimeError('fixture PostgreSQL exited')
                    time.sleep(.1)
            else:raise RuntimeError('fixture PostgreSQL readiness timeout')
            dsn=f'host=127.0.0.1 port={port} user=postgres dbname={database}'
            store=PostgresStore(dsn);store.initialize();artifacts=ArtifactStore(runtime/'artifacts')
            active,completed,empty,isolated,checkpoint=fixtures(store,artifacts)
            cases=[]
            with TestClient(create_app(dsn=dsn,artifact_root=runtime/'artifacts',authorization=LocalWorkspaceAuthorization.for_local_owner(['tenant-a','tenant-b']))) as client:
                def capture(path,workspace='tenant-a',checkpoint=None):
                    response=client.get(path,headers={'x-workspace-id':workspace} if workspace is not None else {})
                    cases.append({'path':path,'workspace':workspace,'status':response.status_code,'body':response.json(),'checkpoint':checkpoint,'job_id':active.job_id})
                for job in [active,completed,empty]:capture('/api/v2/research/jobs/'+job.job_id)
                capture('/api/v2/research/jobs/'+isolated.job_id,'tenant-b')
                capture('/api/v2/research/jobs/'+isolated.job_id)
                capture('/api/v2/research/jobs/absent')
                for workspace in [None,'','not-allowed']:capture('/api/v2/research/jobs/'+active.job_id,workspace)
                capture('/api/v2/research/jobs/'+active.job_id+'/checkpoint')
                capture('/api/v2/research/jobs/'+empty.job_id+'/checkpoint')
                capture('/api/v2/research/jobs/absent/checkpoint')
                for corrupt in [{**checkpoint,'future':{'lease_token':'private-secret'}},{**checkpoint,'attempt_no':True},{**checkpoint,'holdout_access':True},{**checkpoint,'trial_status_counts':{'completed':-1}}]:
                    with store.connect() as conn:conn.execute('UPDATE research_jobs SET checkpoint_json=%s::jsonb WHERE workspace_id=%s AND job_id=%s',(json.dumps(corrupt),'tenant-a',active.job_id));conn.commit()
                    capture('/api/v2/research/jobs/'+active.job_id+'/checkpoint',checkpoint=corrupt)
            golden=runtime/'golden.json';golden.write_text(json.dumps({'cases':cases,'active_id':active.job_id,'completed_id':completed.job_id}),encoding='utf-8')
            with store.connect() as conn:conn.execute('UPDATE research_jobs SET checkpoint_json=%s::jsonb WHERE workspace_id=%s AND job_id=%s',(json.dumps(checkpoint),'tenant-a',active.job_id));conn.commit()
            env={**os.environ,'TW_V2_DATABASE_URL':dsn,'TW_V2_ARTIFACT_ROOT':str(runtime/'artifacts'),'TW_V2_LOCAL_IDENTITY':'local-owner','TW_V2_LOCAL_WORKSPACES':','.join(['tenant-a','tenant-b',*(f'limit-{n}' for n in range(9))]),'TW_V2_RUST_REQUESTS_PER_MINUTE':'2000','TW_EVENTS_GOLDEN':str(golden)}
            result=subprocess.run(['cargo','test','--test','events_pg','--','--ignored','--nocapture'],cwd=API_RUST,env=env,text=True,capture_output=True,timeout=240)
            print(result.stdout);print(result.stderr,file=sys.stderr)
            if args.output:
                args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps({'cases':len(cases),'exit_code':result.returncode,'output':result.stdout+result.stderr,'user_database_touched':False,'real_socket_http':True},indent=2),encoding='utf-8')
            if result.returncode:raise SystemExit(result.returncode)
        finally:
            subprocess.run([str(args.pg_bin/'pg_ctl.exe'),'-D',str(pgdata),'-m','fast','stop'],capture_output=True,timeout=20);postgres.wait(timeout=20);log.close()

if __name__=='__main__':main()
