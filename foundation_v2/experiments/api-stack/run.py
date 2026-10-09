"""Bounded, isolated Windows comparison. Never accepts a user database DSN."""
import argparse
from collections import defaultdict
import hashlib
import json
import os
from pathlib import Path
import platform
import random
import socket
import statistics
import subprocess
import sys
import time
import uuid

import httpx
import psutil
import psycopg

ROOT = Path(__file__).resolve().parent
PYTHON = ROOT / '.runtime/python/Scripts/python.exe'
SERVER_CORES, CLIENT_CORES = [0, 1, 2, 3], [4, 5]
AFFINITY = {}
DATA = [{'id': i, 'symbol': 'EURUSD' if i % 3 == 0 else 'XAUUSD', 'pnl_cents': (i * 17) % 20001 - 10000}
        for i in range(1, 100001) if i % 2 == 1]


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def processes(pid):
    try:
        p = psutil.Process(pid)
        return [p, *p.children(recursive=True)]
    except psutil.NoSuchProcess:
        return []


def sample(pid, cores):
    cpu, rss = 0, 0
    for p in processes(pid):
        try:
            if p.cpu_affinity() != cores:
                p.cpu_affinity(cores)
            actual = p.cpu_affinity()
            assert actual == cores, (p.pid, actual, cores)
            AFFINITY[str(p.pid)] = {'name':p.name(), 'cores':actual}
            times = p.cpu_times()
            cpu += times.user + times.system
            rss += p.memory_info().rss
        except psutil.NoSuchProcess:
            pass
    return cpu, rss


def stop(process):
    children = processes(process.pid)[1:]
    for p in reversed(children):
        try:
            p.terminate()
        except psutil.NoSuchProcess:
            pass
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
    for p in children:
        try:
            p.wait(timeout=2)
        except psutil.TimeoutExpired:
            p.kill()
        except psutil.NoSuchProcess:
            pass


def expected(rows, page):
    selected = sorted((t for t in DATA if t['id'] <= rows and t['symbol'] == 'EURUSD'), key=lambda t: (-t['pnl_cents'], t['id']))
    return {'total': len(selected), 'items': selected[(page-1)*25:page*25]}


def parity(url):
    count = 0
    with httpx.Client(base_url=url, timeout=20, trust_env=False) as client:
        for endpoint in ['/json', '/trades', '/db']:
            for workspace in ['', 'tenant-b']:
                assert client.get(endpoint, headers={'X-Workspace-Id': workspace}).status_code == 403
                count += 1
        result = client.get('/json', headers={'X-Workspace-Id':'tenant-a'})
        assert result.status_code == 200 and result.json() == {'ok': True, 'scope':'tenant-a'}
        count += 1
        for endpoint in ['/trades', '/db']:
            for rows in [10000, 100000]:
                for page in [1, 2, 17, 100]:
                    result=client.get(endpoint,params={'rows':rows,'page':page},headers={'X-Workspace-Id':'tenant-a'})
                    assert result.status_code==200 and result.json()==expected(rows,page), (endpoint, rows, page, result.text[:160])
                    count += 1
            for query in ['rows=0','page=0','page=101','rows=10001']:
                assert client.get(endpoint+'?'+query,headers={'X-Workspace-Id':'tenant-a'}).status_code==400
                count += 1
    return count


def load(url, connections, seconds, process, db, output):
    command=['node',str(ROOT/'load.mjs'),url,str(connections),str(seconds)]
    with output.open('w') as stdout:
        generator=subprocess.Popen(command,cwd=ROOT,stdout=stdout,stderr=subprocess.PIPE,text=True)
        sample(generator.pid,CLIENT_CORES)
        start=time.monotonic()
        first, _=sample(process.pid,SERVER_CORES)
        db_first, _=sample(db.pid,SERVER_CORES)
        peaks={'server':0,'generator':0,'db':0}
        resource_samples=[]
        cpu={'server':first,'generator':0,'db':db_first}
        try:
            while generator.poll() is None:
                for name,p,cores in [('server',process,SERVER_CORES),('generator',generator,CLIENT_CORES),('db',db,SERVER_CORES)]:
                    value,memory=sample(p.pid,cores)
                    cpu[name]=max(cpu[name],value)
                    peaks[name]=max(peaks[name],memory)
                    if name=='server': resource_samples.append({'elapsed_s':round(time.monotonic()-start,2),'working_set_MB':round(memory/1e6,2)})
                if time.monotonic()-start > seconds+25:
                    raise TimeoutError('load generator exceeded bound')
                time.sleep(.15)
            if generator.returncode:
                raise RuntimeError(generator.stderr.read()[-1000:])
        finally:
            if generator.poll() is None:
                stop(generator)
        elapsed=time.monotonic()-start
    raw=json.loads(output.read_text())
    return {'rps':raw['2xx']/raw['duration'], 'requests':raw['2xx'],
            'latency_ms':raw['latency'], 'errors':raw['errors'], 'timeouts':raw['timeouts'], 'non2xx':raw['non2xx'],
            'server_cpu_seconds':max(0,cpu['server']-first), 'db_cpu_seconds':max(0,cpu['db']-db_first),
            'generator_cpu_pct_of_2_cores':cpu['generator']/elapsed/2*100,
            'peak_working_set_MB':{name:round(value/1e6,2) for name,value in peaks.items()},
            'server_resource_samples':resource_samples,
            'elapsed_with_generator_startup_seconds':elapsed}


def commands():
    java=next((ROOT/'.runtime/java').glob('*/bin/java.exe'))
    return {
        'fastapi': [str(PYTHON),'-m','uvicorn','python_server:app','--host','127.0.0.1','--port','{port}','--workers','4','--no-access-log','--log-level','error'],
        'axum':[str(ROOT/'rust/target/release/api-stack-axum.exe')],
        'gin':[str(ROOT/'go/server.exe')], 'fiber':[str(ROOT/'go/server.exe')],
        'fastify':['node',str(ROOT/'node_server.mjs')],
        'dotnet':['dotnet',str(ROOT/'.runtime/dotnet-server/Benchmark.dll')],
        'spring':[str(java),'-XX:ActiveProcessorCount=4','-Xms128m','-Xmx1024m','-jar',str(ROOT/'java/target/api-stack-spring-1.0.0.jar')],
    }


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--pg-bin',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--seconds',type=int,default=4,choices=range(2,16))
    parser.add_argument('--repeats',type=int,default=2,choices=range(1,4))
    parser.add_argument('--only',default='')
    parser.add_argument('--soak-seconds',type=int,default=0,choices=range(0,121))
    parser.add_argument('--soak-only',default='')
    parser.add_argument('--headline',action='store_true')
    args=parser.parse_args()
    output=args.output.resolve();output.mkdir(parents=True,exist_ok=True)
    pg_bin=args.pg_bin.resolve()
    pgdata=ROOT/'.runtime'/('pg-'+uuid.uuid4().hex[:10])
    assert pgdata.is_relative_to((ROOT/'.runtime').resolve())
    subprocess.run([str(pg_bin/'initdb.exe'),'-D',str(pgdata),'--auth=trust','--username=postgres','--no-locale','--encoding=UTF8'],check=True,capture_output=True)
    db_port=free_port()
    db_log=(output/'postgres.log').open('w')
    db=subprocess.Popen([str(pg_bin/'postgres.exe'),'-D',str(pgdata),'-h','127.0.0.1','-p',str(db_port),'-c','max_connections=32','-c','shared_buffers=128MB'],stdout=db_log,stderr=db_log)
    sample(db.pid,SERVER_CORES)
    process=None
    receipt={'machine':{'platform':platform.platform(),'cores':psutil.cpu_count(),'logical_cores':psutil.cpu_count(),'memory_bytes':psutil.virtual_memory().total},
             'server_cores':SERVER_CORES,'generator_cores':CLIENT_CORES,'db_shared_server_cores':True,'repeats':args.repeats,'seconds':args.seconds,'results':[], 'parity':{}}
    cases=[('/json',1),('/json',128),('/trades?rows=10000',1),('/trades?rows=10000',128),('/trades?rows=100000',1),('/trades?rows=100000',32),('/trades?rows=100000',128),('/db?rows=100000',1),('/db?rows=100000',128)]
    if args.headline:
        cases=[case for case in cases if (case[1]==128 and 'rows=10000&' not in case[0] and case[0]!='/trades?rows=10000') or case==('/trades?rows=100000',1)]
    receipt['cases']=cases
    receipt['soak_seconds']=args.soak_seconds
    receipt['soak_only']=args.soak_only
    def checkpoint():
        receipt['observed_affinity'] = AFFINITY
        (output/'results.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    try:
        for attempt in range(100):
            if db.poll() is not None: raise RuntimeError('fixture PostgreSQL failed')
            try:
                conn=psycopg.connect(host='127.0.0.1',port=db_port,user='postgres',dbname='postgres',autocommit=True)
                break
            except psycopg.OperationalError:
                time.sleep(.1)
        else: raise TimeoutError('fixture PostgreSQL not ready')
        with conn:
            conn.execute("CREATE TABLE trades AS SELECT i::int AS id, CASE WHEN i%2=1 THEN 'tenant-a' ELSE 'tenant-b' END AS workspace, CASE WHEN i%3=0 THEN 'EURUSD' ELSE 'XAUUSD' END AS symbol, ((i*17)%20001-10000)::int AS pnl_cents FROM generate_series(1,100000) AS i")
            conn.execute('CREATE INDEX trades_lookup ON trades(workspace,symbol,pnl_cents DESC,id ASC)')
            conn.execute('VACUUM ANALYZE trades')
            conn.execute("CREATE ROLE bench LOGIN; GRANT SELECT ON trades TO bench; ALTER ROLE bench SET default_transaction_read_only=on")
            receipt['db_version']=conn.execute('SELECT version()').fetchone()[0]
            sql=(ROOT/'query.sql').read_text().format(rows=100000,offset=0)
            receipt['query_plan']=conn.execute('EXPLAIN (FORMAT JSON) '+sql).fetchone()[0]
        suites=commands()
        selected=args.only.split(',') if args.only else list(suites)
        for repeat in range(args.repeats):
            order=list(selected);random.Random(20261009+repeat).shuffle(order)
            for name in order:
                port=free_port();url=f'http://127.0.0.1:{port}'
                env=os.environ.copy();env.update(PORT=str(port),DB_PORT=str(db_port),FRAMEWORK=name,GOMAXPROCS='4',DOTNET_PROCESSOR_COUNT='4',DOTNET_CLI_TELEMETRY_OPTOUT='1')
                log=(output/f'{repeat}-{name}.log').open('w')
                process=subprocess.Popen([s.replace('{port}',str(port)) for s in suites[name]],cwd=ROOT,env=env,stdout=log,stderr=log)
                sample(process.pid,SERVER_CORES)
                try:
                    with httpx.Client(timeout=1,trust_env=False) as client:
                        for attempt in range(200):
                            if process.poll() is not None:raise RuntimeError(name+' failed to start')
                            try:
                                if client.get(url+'/json',headers={'X-Workspace-Id':'tenant-a'}).status_code==200:break
                            except httpx.HTTPError:pass
                            time.sleep(.1)
                        else:raise TimeoutError(name+' not ready')
                    receipt['parity'][f'{repeat}-{name}']=parity(url)
                    checkpoint()
                    # Warm all code paths/pools before the first measured case.
                    for index,path in enumerate(['/json','/trades?rows=100000','/db?rows=100000']):
                        load(url+path,32,3,process,db,output/f'{repeat}-{name}-warm-{index}.json')
                    paths=list(cases);random.Random(30+repeat).shuffle(paths)
                    for index,(path,concurrency) in enumerate(paths):
                        result=load(url+path,concurrency,args.seconds,process,db,output/f'{repeat}-{name}-{index}.json')
                        receipt['results'].append({'framework':name,'repeat':repeat,'path':path,'connections':concurrency,**result})
                        checkpoint()
                        print(name,repeat,path,concurrency,round(result['rps']),result['latency_ms']['p99'],'ms p99',flush=True)
                    if args.soak_seconds and repeat==0 and (not args.soak_only or name in args.soak_only.split(',')):
                        result=load(url+'/trades?rows=100000',128,args.soak_seconds,process,db,output/f'{repeat}-{name}-soak.json')
                        receipt['results'].append({'framework':name,'repeat':repeat,'path':'/trades?rows=100000','connections':128,'soak_seconds':args.soak_seconds,**result})
                    receipt['parity'][f'{repeat}-{name}-after']=parity(url)
                    checkpoint()
                finally:
                    stop(process);process=None;log.close()
    finally:
        if process is not None:stop(process)
        subprocess.run([str(pg_bin/'pg_ctl.exe'),'-D',str(pgdata),'-m','fast','stop'],capture_output=True,timeout=20)
        if db.poll() is None:stop(db)
        db_log.close()
        checkpoint()
    print('Evidence:',output,flush=True)

if __name__=='__main__':main()
