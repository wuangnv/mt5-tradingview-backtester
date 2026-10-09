"""Disposable local PostgreSQL/API fixture for multi-asset replay QA."""

import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
import uvicorn

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'foundation_v2'), str(ROOT)]

from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
from foundation_v2.tests.test_ps02_replay_prop_connection import instrument_mapping


@contextmanager
def portfolio_qa_app():
    config = conninfo_to_dict(os.environ['TW_V2_DATABASE_URL'])
    if config.get('host') not in {'localhost', '127.0.0.1', '::1'}:
        raise ValueError('QA database must be local')
    database = 'tw_portfolio_qa_' + uuid4().hex
    admin = make_conninfo(**{**config, 'dbname': 'postgres'})
    with psycopg.connect(admin, autocommit=True) as connection:
        connection.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(database)))
    app = None
    try:
        with TemporaryDirectory(prefix='tw-portfolio-qa-') as folder:
            app = create_app(dsn=make_conninfo(**{**config, 'dbname':database}), artifact_root=folder,
                learn_roots={}, authorization=LocalWorkspaceAuthorization.for_local_owner(['tenant-a', 'tenant-other']))
            manifests = []
            for symbol, price in [('EURUSD',1.1), ('GBPUSD',1.2)]:
                path = Path(folder) / (symbol + '.csv')
                path.write_text('time,open,high,low,close,volume\n' + ''.join(
                    f'{1767225600 + i*60},{price},{price+.002},{price-.001},{price+.001},10\n' for i in range(40)), encoding='utf-8')
                spec = {**instrument_mapping(), 'instrument_id':symbol}
                manifest = app.state.ingest.import_csv(workspace_id='tenant-a', path=path,
                    source={'source_id':'portfolio-qa', 'provider':'Synthetic QA', 'license_use':'qa-only',
                        'instrument_mapping':{symbol:symbol}, 'retrieved_at_utc':'2026-01-01T00:00:00Z',
                        'export_settings':'disposable synthetic QA'}, instrument=spec, timeframe_seconds=60)
                manifests.append(manifest)
            yield app, manifests
    finally:
        if app is not None:
            app.state.store.close()
        with psycopg.connect(admin, autocommit=True) as connection:
            connection.execute(sql.SQL('DROP DATABASE {}').format(sql.Identifier(database)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8017)
    parser.add_argument('--receipt', type=Path)
    args = parser.parse_args()
    with portfolio_qa_app() as (app, manifests):
        if args.receipt:
            args.receipt.parent.mkdir(parents=True, exist_ok=True)
            args.receipt.write_text(json.dumps({'label':'Disposable synthetic PostgreSQL fixture',
                'dataset_ids':[item.dataset_id for item in manifests], 'port':args.port}), encoding='utf-8')
        uvicorn.run(app, host='127.0.0.1', port=args.port, log_level='warning')
