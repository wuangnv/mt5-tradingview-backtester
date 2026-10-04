"""Real UI/API/Postgres journey in a unique disposable loopback database."""
from pathlib import Path
import json
import math
import os
import socket
import subprocess
import sys
import threading
import time
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from fastapi.testclient import TestClient
import uvicorn

REPO = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(REPO), str(REPO / 'foundation_v2')]
from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
from foundation_v2.tests.test_replay_execution_core import initial_state


def main():
    out = REPO.parent.parent / ('.artifacts/chart-workbench-20261004/integration-' + uuid4().hex[:8])
    out.mkdir(parents=True, exist_ok=True)
    connection = conninfo_to_dict(os.environ['TW_V2_DATABASE_URL'])
    if connection.get('host') not in {'127.0.0.1', 'localhost', '::1'}:
        raise RuntimeError('Only local PostgreSQL is allowed')
    database = 'tw_chart_qa_' + uuid4().hex
    admin_dsn = make_conninfo(**{**connection, 'dbname': 'postgres'})
    own_dsn = make_conninfo(**{**connection, 'dbname': database})
    server = None
    worker = None
    with psycopg.connect(admin_dsn, autocommit=True) as admin:
        admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(database)))
    try:
        app = create_app(dsn=own_dsn, artifact_root=out / 'data',
            authorization=LocalWorkspaceAuthorization.for_local_owner(['tenant-a'], identity_id='chart-test-owner'))
        fixture = initial_state()
        csv = ['time,open,high,low,close,volume']
        for index in range(160):
            close = 1.1 + math.sin(index * .23) * .0025
            open_price = close + (.0005 if index % 2 else -.0005)
            csv.append(f'{1704067200 + index * 60},{open_price:.5f},{max(open_price, close) + .0004:.5f},{min(open_price, close) - .0004:.5f},{close:.5f},{80 + index % 11 * 20}')
        headers = {'X-Workspace-Id': 'tenant-a'}
        with TestClient(app) as client:
            imported = client.post('/api/v2/data/csv/import', headers=headers, json={
                'csv_text': '\n'.join(csv), 'instrument': fixture.instrument_spec, 'timeframe_seconds': 60,
                'source': {'source_id': 'chart-disposable-mixed-ohlc', 'provider': 'local-synthetic-qa',
                    'instrument_mapping': {'EURUSD': 'EURUSD'}, 'license_use': 'generated test data only',
                    'retrieved_at_utc': '2026-10-04T00:00:00Z', 'export_settings': 'mixed OHLC, synthetic test only'},
            })
            assert imported.is_success, imported.text
            dataset = imported.json().get('dataset_id') or imported.json()['dataset']['dataset_id']
            response = client.post('/api/v2/replay/sessions', headers=headers, json={'dataset_id': dataset, 'start_index': 60})
            assert response.is_success, response.text
            sid = response.json()['record_id']
            renamed = client.patch('/api/v2/replay/sessions/' + sid, headers=headers,
                json={'expected_revision': response.json()['revision'], 'name': 'QA · Mixed OHLC', 'description': 'Synthetic, isolated database'})
            assert renamed.is_success, renamed.text
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, log_level='warning'))
        worker = threading.Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True)
        worker.start()
        for _ in range(100):
            if server.started: break
            time.sleep(.05)
        assert server.started, 'Temporary API did not start'
        api = f'http://127.0.0.1:{port}'
        receipt = {'scope': 'synthetic data, real UI/API/Postgres in unique temporary database',
            'database': database, 'api': api, 'session': sid, 'cleanup': 'pending'}
        (out / 'environment.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
        result = subprocess.run(['node', 'tests/chartWorkbench.browser.mjs', '--disposable=true', '--api=' + api,
            '--session=' + sid, '--out=' + str(out)], cwd=REPO / 'foundation_v2/web', check=False)
        if result.returncode:
            raise RuntimeError('Chart browser integration failed; preserve screenshots and attempt evidence')
        with TestClient(app) as client:
            before = client.get('/api/v2/replay/sessions/' + sid, headers=headers).json()
            active = before['payload']['execution']['position']
            body = {'expected_revision': before['revision'], 'target_id': active['position_id'],
                'operation_id': 'denied-scope-probe', 'stop_loss': '1.09', 'take_profit': '1.12'}
            denied = client.post(f'/api/v2/replay/sessions/{sid}/orders/protection', headers={'X-Workspace-Id': 'other'}, json=body)
            assert denied.status_code == 403, denied.text
            stale = client.post(f'/api/v2/replay/sessions/{sid}/orders/protection', headers=headers, json={**body, 'expected_revision': before['revision'] - 1})
            assert stale.status_code == 409, stale.text
            assert client.get('/api/v2/replay/sessions/' + sid, headers=headers).json() == before
        print(json.dumps({'result': 'PASS', 'scope': 'real-disposable', 'out': str(out)}), flush=True)
    finally:
        if server:
            server.should_exit = True
        if worker:
            worker.join(timeout=10)
        # Only the exact database generated by this invocation may be deleted.
        assert database.startswith('tw_chart_qa_') and len(database) == len('tw_chart_qa_') + 32
        with psycopg.connect(admin_dsn, autocommit=True) as admin:
            admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(database)))
        if (out / 'environment.json').exists():
            receipt['cleanup'] = 'own temporary database dropped; artifact evidence retained'
            (out / 'environment.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
