"""Serve imported Exness history, optionally enabling read-only MT5 synchronization."""

import argparse
import os
import sys
from pathlib import Path

from psycopg.conninfo import conninfo_to_dict, make_conninfo
import uvicorn

repo = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(repo / 'foundation_v2'), str(repo)]
from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
from trading_workspace_v2.market_sync import MarketRuntime


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8010)
    parser.add_argument('--mt5-python', type=Path, help='Python environment containing the audited MetaTrader5 SDK; enables read-only sync.')
    parser.add_argument('--terminal', type=Path, default=Path('C:/Program Files/MetaTrader 5/terminal64.exe'))
    args = parser.parse_args()
    config = conninfo_to_dict(os.environ['TW_V2_DATABASE_URL'])
    if config.get('host') not in {'127.0.0.1', 'localhost', '::1'}:
        raise ValueError('Exness history launcher requires a loopback database.')
    config['dbname'] = 'trading_workspace_v2_exness_history'
    artifacts = repo / 'foundation_v2/.runtime/exness-market-data'
    if not artifacts.is_dir():
        raise FileNotFoundError('Imported Exness market-data directory is missing; restore it before launching.')
    if args.mt5_python and (not args.mt5_python.is_file() or not args.terminal.is_file()):
        raise FileNotFoundError('Configured MT5 Python/terminal executable is missing.')
    runtime = None
    if args.mt5_python:
        runtime = lambda store, artifacts: MarketRuntime(store, artifacts, workspace='tenant-a',
            python=args.mt5_python.resolve(), worker=repo / 'foundation_v2/scripts/mt5_read_worker.py', terminal=args.terminal)
    app = create_app(
        dsn=make_conninfo(**config), artifact_root=artifacts,
        authorization=LocalWorkspaceAuthorization.for_local_owner(['tenant-a'], identity_id='local-owner'),
        learn_roots={'tenant-a': repo.parent.parent / 'education'},
        market_runtime_factory=runtime,
    )
    print(f'Exness imported-history API: loopback port {args.port}; paper execution only.', flush=True)
    uvicorn.run(app, host='127.0.0.1', port=args.port)


if __name__ == '__main__':
    main()
