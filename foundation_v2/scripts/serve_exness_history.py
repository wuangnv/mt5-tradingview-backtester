"""Run the owner's imported Exness history without reconnecting to MT5."""

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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8010)
    args = parser.parse_args()
    config = conninfo_to_dict(os.environ['TW_V2_DATABASE_URL'])
    if config.get('host') not in {'127.0.0.1', 'localhost', '::1'}:
        raise ValueError('Exness history launcher requires a loopback database.')
    config['dbname'] = 'trading_workspace_v2_exness_history'
    artifacts = repo / 'foundation_v2/.runtime/exness-market-data'
    if not artifacts.is_dir():
        raise FileNotFoundError('Imported Exness market-data directory is missing; restore it before launching.')
    app = create_app(
        dsn=make_conninfo(**config), artifact_root=artifacts,
        authorization=LocalWorkspaceAuthorization.for_local_owner(['tenant-a'], identity_id='local-owner'),
        learn_roots={'tenant-a': repo.parent.parent / 'education'},
    )
    print(f'Exness imported-history API: loopback port {args.port}; paper execution only.', flush=True)
    uvicorn.run(app, host='127.0.0.1', port=args.port)


if __name__ == '__main__':
    main()
