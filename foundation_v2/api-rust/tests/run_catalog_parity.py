"""Compare native Axum catalogs with the Python API on an owned disposable DB."""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
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
from trading_workspace_v2.contracts import DatasetManifest, DatasetSource
from trading_workspace_v2.store import PostgresStore
from trading_workspace_v2.prop_session import PropSessionSnapshot, ChallengeAttemptSnapshot, PhaseStateSnapshot
from test_ps01_prop_persistence import profile


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def populate(store):
    tombstones={}
    for workspace in ['tenant-a', 'tenant-b']:
        store.ensure_workspace(workspace)
        source = DatasetSource(source_id='fixture', provider='fixture', instrument_mapping={'EURUSD':'EURUSD'}, license_use='qa-only', retrieved_at_utc='2026-10-09T00:00:00Z', export_settings='fixture')
        for key, instrument in [('a','EURUSD'), ('b','XAUUSD')]:
            store.put_dataset(DatasetManifest(dataset_id=key, workspace_id=workspace, source=source, instrument_id=instrument, timeframe='M1', row_count=2, first_timestamp=60, last_timestamp=120, artifact_path='does-not-exist.parquet', artifact_sha256='0'*64, created_at_utc='2026-10-09T00:00:00Z', timeframe_seconds=60))
        for kind in ['playbook','journal','annotation']:
            one=store.create_record(workspace,kind,{'fixture':workspace,'name':kind},source_key=kind+'-source')
            store.update_record(workspace,kind,one['record_id'],1,{'fixture':workspace,'revision':2})
            deleted=store.create_record(workspace,kind,{'fixture':'tombstone'})
            with store.connect() as conn:
                conn.execute("UPDATE workspace_record_revisions SET deleted=true WHERE workspace_id=%s AND kind=%s AND record_id=%s",(workspace,kind,deleted['record_id']))
                conn.commit()
            tombstones[workspace,kind]=deleted['record_id']
        replay=store.create_record(workspace,'replay',{'dataset_id':'a','dataset_ids':['b','a','b'],'cursor_index':0,'name':'EUR / Gold','execution':{},'asset_states':{'a':{'execution':{}}}})
        unavailable=store.create_record(workspace,'replay',{'dataset_id':'a','cursor_index':1,'name':'Unavailable'})
        with store.connect() as conn:
            conn.execute("UPDATE workspace_record_revisions SET payload_json=jsonb_set(payload_json,'{dataset_id}','\"missing\"'::jsonb) WHERE workspace_id=%s AND kind='replay' AND record_id=%s",(workspace,unavailable['record_id']))
            conn.commit()
        session=PropSessionSnapshot(workspace_id=workspace,session_id='prop-1',profile=profile(),status='running')
        store.create_prop_session(session)
        store.create_prop_session(PropSessionSnapshot(workspace_id=workspace,session_id='empty-prop',profile=profile()))
        start=datetime(2026,9,1,tzinfo=timezone.utc)
        attempt=ChallengeAttemptSnapshot(workspace_id=workspace,session_id=session.session_id,attempt_id='attempt-1',profile_id=session.profile.profile_id,terms_version=session.profile.terms_version,profile_hash=session.profile.profile_hash,data_version='qa-data',cost_version='qa-cost',engine_version='qa-engine',status='running',virtual_start_utc=start,virtual_cutoff_utc=start+timedelta(days=30))
        phase=PhaseStateSnapshot(workspace_id=workspace,session_id=session.session_id,attempt_id=attempt.attempt_id,profile_hash=session.profile.profile_hash,phase_index=1,initial_balance=Decimal('100000'),balance=Decimal('100250.00'),floating_pl=Decimal('-50.00'),equity=Decimal('100200.00'),high_water_mark=Decimal('100400'),daily_anchor=Decimal('100100'),virtual_time_utc=start,evaluation_quality='full_for_declared_model')
        store.create_prop_attempt(attempt,phase,resume_state={'cursor':{'bar_index':412},'unknown':None})
    return tombstones


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--pg-bin',required=True,type=Path)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='tw-catalog-parity-') as folder:
        runtime=Path(folder);pgdata=runtime/'pgdata';port=free_port()
        subprocess.run([str(args.pg_bin/'initdb.exe'),'-D',str(pgdata),'--auth=trust','--username=postgres','--no-locale','--encoding=UTF8'],check=True,capture_output=True)
        log=(runtime/'postgres.log').open('w')
        postgres=subprocess.Popen([str(args.pg_bin/'postgres.exe'),'-D',str(pgdata),'-h','127.0.0.1','-p',str(port),'-c','max_connections=32'],stdout=log,stderr=log)
        try:
            base=f'host=127.0.0.1 port={port} user=postgres dbname=postgres'
            for _ in range(100):
                try:
                    with psycopg.connect(base,autocommit=True) as conn:
                        database='catalog_parity_'+uuid4().hex
                        conn.execute(f'CREATE DATABASE {database}')
                    break
                except psycopg.OperationalError:
                    if postgres.poll() is not None:raise RuntimeError('fixture PostgreSQL exited')
                    time.sleep(.1)
            else:raise RuntimeError('fixture PostgreSQL readiness timeout')
            dsn=f'host=127.0.0.1 port={port} user=postgres dbname={database}'
            store=PostgresStore(dsn);store.initialize();tombstones=populate(store)
            cases=[]
            with TestClient(create_app(dsn=dsn,artifact_root=runtime/'artifacts',authorization=LocalWorkspaceAuthorization.for_local_owner(['tenant-a','tenant-b']))) as client:
                def capture(path,workspace='tenant-a',method='GET',corrupt=None):
                    headers={'x-workspace-id':workspace} if workspace is not None else {}
                    response=client.request(method,path,headers=headers)
                    item={'path':path,'workspace':workspace,'method':method,'status':response.status_code,'body':response.json()}
                    if corrupt:item['corrupt_record_id']=corrupt
                    cases.append(item)
                for path in ['/api/v2/replay/sessions','/api/v2/prop/sessions','/api/v2/prop/sessions/prop-1','/api/v2/prop/sessions/prop-1/attempts','/api/v2/prop/sessions/prop-1/attempts/attempt-1','/api/v2/prop/sessions/empty-prop/attempts','/api/v2/prop/sessions/absent','/api/v2/prop/sessions/absent/attempts','/api/v2/prop/sessions/prop-1/attempts/absent','/api/v2/chart/annotations','/api/v2/execution/capabilities','/api/v2/session/status']:
                    capture(path)
                for kind,path in [('playbook','playbooks'),('journal','journal')]:
                    record=store.list_records('tenant-a',kind)[0]
                    for suffix in ['', '/'+record['record_id'], '/'+record['record_id']+'/revisions','/absent','/absent/revisions']:
                        capture('/api/v2/'+path+suffix)
                    capture('/api/v2/'+path+'/'+tombstones['tenant-a',kind])
                    capture('/api/v2/'+path+'/'+tombstones['tenant-a',kind]+'/revisions')
                capture('/api/v2/execution/intents',method='POST')
                for target,column,table in [('session','snapshot_json','prop_sessions'),('attempt','snapshot_json','prop_attempts'),('phase','phase_json','prop_attempts')]:
                    with store.connect() as conn:
                        original=conn.execute(f"SELECT {column} FROM {table} WHERE workspace_id='tenant-a' AND session_id='prop-1'").fetchone()[column]
                    mutations=[('workspace_id','tenant-b'),('session_id','other'),('workspace_id',None)]
                    if target!='phase':mutations += [('status','invalid'),('status',None),('revision',0),('revision',1.0)]
                    if target=='attempt':mutations += [('attempt_id','other'),('virtual_cutoff_utc','2020-01-01T00:00:00Z'),('virtual_start_utc','2026-01-01T00:00:00')]
                    if target=='phase':mutations += [('attempt_id','other'),('equity','0'),('balance','NaN'),('equity',None),('evaluation_quality','invalid')]
                    for key,value in mutations+[('workspace_id','__remove__')]:
                        altered=deepcopy(original)
                        if value=='__remove__':altered.pop(key)
                        else:altered[key]=value
                        with store.connect() as conn:
                            conn.execute(f"UPDATE {table} SET {column}=%s::jsonb WHERE workspace_id='tenant-a' AND session_id='prop-1'",(json.dumps(altered),));conn.commit()
                        path='/api/v2/prop/sessions/prop-1' if target=='session' else '/api/v2/prop/sessions/prop-1/attempts/attempt-1'
                        capture(path)
                        cases[-1]['mutation']={'target':target,'value':altered,'restore':original}
                        with store.connect() as conn:
                            conn.execute(f"UPDATE {table} SET {column}=%s::jsonb WHERE workspace_id='tenant-a' AND session_id='prop-1'",(json.dumps(original),));conn.commit()
                for workspace in ['tenant-b','not-allowed',None,'']:
                    capture('/api/v2/replay/sessions',workspace)
                record=store.list_records('tenant-a','replay')[0]
                with store.connect() as conn:
                    conn.execute("UPDATE workspace_record_revisions SET payload_json=jsonb_set(payload_json,'{cursor_index}','-1'::jsonb) WHERE workspace_id='tenant-a' AND kind='replay' AND record_id=%s",(record['record_id'],));conn.commit()
                capture('/api/v2/replay/sessions',corrupt=record['record_id'])
                with store.connect() as conn:
                    conn.execute("UPDATE workspace_record_revisions SET payload_json=jsonb_set(payload_json,'{cursor_index}',%s::jsonb) WHERE workspace_id='tenant-a' AND kind='replay' AND record_id=%s",(json.dumps(record['payload'].get('cursor_index',0)),record['record_id']));conn.commit()
            golden=runtime/'golden.json';golden.write_text(json.dumps(cases),encoding='utf-8')
            env={**os.environ,'TW_V2_DATABASE_URL':dsn,'TW_V2_ARTIFACT_ROOT':str(runtime/'artifacts'),'TW_V2_LOCAL_IDENTITY':'local-owner','TW_V2_LOCAL_WORKSPACES':'tenant-a,tenant-b','TW_CATALOG_PARITY_GOLDEN':str(golden)}
            result=subprocess.run(['cargo','test','--test','catalog_parity','--','--ignored','--nocapture'],cwd=API_RUST,env=env,text=True,capture_output=True)
            print(result.stdout);print(result.stderr,file=sys.stderr)
            if args.output:
                args.output.parent.mkdir(parents=True,exist_ok=True)
                args.output.write_text(json.dumps({'cases':len(cases),'exit_code':result.returncode,'output':result.stdout+result.stderr,'user_database_touched':False},indent=2),encoding='utf-8')
            if result.returncode:raise SystemExit(result.returncode)
        finally:
            subprocess.run([str(args.pg_bin/'pg_ctl.exe'),'-D',str(pgdata),'-m','fast','stop'],capture_output=True,timeout=20)
            postgres.wait(timeout=20);log.close()


if __name__=='__main__':main()
