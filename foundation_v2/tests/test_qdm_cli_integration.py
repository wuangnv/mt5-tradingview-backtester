"""Opt-in licensed CLI/API smoke; QDM update may populate its full local history."""
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from fastapi.testclient import TestClient

sys.path[:0] = [str(Path(__file__).resolve().parents[1]), str(Path(__file__).resolve().parents[2])]
from trading_workspace_v2.api import create_app
from trading_workspace_v2.auth import LocalWorkspaceAuthorization
from trading_workspace_v2.qdm_cli import QdmCatalog, QdmCli
from trading_workspace_v2.qdm_downloads import QdmDownloads


@unittest.skipUnless(os.getenv('TW_V2_QDM_HOME') and os.getenv('TW_V2_DATABASE_URL'), 'opt-in licensed QDM and loopback DB required')
class RealQdmApiTests(unittest.TestCase):
    def test_real_cli_export_and_api_publication_in_disposable_database(self):
        config = conninfo_to_dict(os.environ['TW_V2_DATABASE_URL'])
        self.assertIn(config.get('host'), {'127.0.0.1', 'localhost', '::1'})
        name = 'qdm_qa_' + uuid4().hex
        admin = make_conninfo(**{**config, 'dbname':'postgres'})
        with psycopg.connect(admin, autocommit=True) as conn:
            conn.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
        try:
            with tempfile.TemporaryDirectory() as temp:
                app = create_app(dsn=make_conninfo(**{**config, 'dbname':name}), artifact_root=temp,
                    authorization=LocalWorkspaceAuthorization.for_local_owner(['qdm-qa']),
                    instrument_catalog=QdmCatalog(QdmCli(os.environ['TW_V2_QDM_HOME'])),
                    dukascopy_downloads_factory=QdmDownloads)
                headers = {'X-Workspace-Id':'qdm-qa'}
                with TestClient(app) as client:
                    catalog = client.get('/api/v2/data/datasets', headers=headers).json()
                    self.assertTrue(catalog['download_state']['available'], catalog['download_state'].get('error'))
                    self.assertEqual(catalog['catalog_items'][0]['provider'], 'QuantDataManager')
                    self.assertEqual(catalog['catalog_items'][0]['data_source'], 'Dukascopy')
                    self.assertEqual(catalog['download_state']['download_engine'], 'QuantDataManager')
                    assets = {row['instrument_id']: row for row in catalog['catalog_items']}
                    self.assertGreater(len(assets), 1)
                    for symbol, category, start in [('EUR/USD','fx','2003-05-05'), ('XAU/USD','metal','2003-05-05'),
                            ('AAPLUSUSD','stock','2017-01-26'), ('USATECHIDXUSD','index','2011-09-30')]:
                        self.assertEqual(assets[symbol]['asset_class'], category)
                        self.assertEqual(catalog['download_state']['earliest_dates'][symbol], start)
                    refreshed = client.post('/api/v2/data/catalog/refresh', headers=headers).json()
                    self.assertEqual(refreshed['catalog_items'], catalog['catalog_items'])
                    for symbol in ['USATECHIDXUSD', 'AAPLUSUSD']:
                        self.assertEqual(app.state.downloads._ensure_symbol(symbol), symbol+'_TW')
                    if os.getenv('TW_V2_QDM_CATALOG_QA') == '1':
                        path = Path(__file__).resolve().parents[1] / '.runtime/qdm-catalog-qa.json'
                        path.write_text(json.dumps(catalog), encoding='utf-8')
                    self.assertEqual(client.get('/api/v2/data/datasets', headers={'X-Workspace-Id':'other'}).status_code, 403)
                    response = client.post('/api/v2/data/downloads', headers=headers,
                        json={'instrument_id':'EUR/USD', 'from_date':'2026-10-05', 'to_date':'2026-10-05'})
                    self.assertEqual(response.status_code, 202, response.text)
                    job_id = response.json()['job_id']
                    deadline = time.monotonic() + 900
                    while True:
                        jobs = client.get('/api/v2/data/downloads', headers=headers).json()['items']
                        job = next(item for item in jobs if item['job_id'] == job_id)
                        if job['status'] not in {'queued','running','pausing'}:
                            break
                        self.assertLess(time.monotonic(), deadline, 'QDM smoke timeout; CLI is not force-terminated')
                        time.sleep(.5)
                    self.assertEqual(job['status'], 'completed', job.get('error'))
                    manifest = app.state.store.get_dataset('qdm-qa', job['dataset_id'])
                    self.assertGreater(manifest.row_count, 1000)
                    self.assertEqual(manifest.source.provider, 'QuantDataManager')
                    settings = json.loads(manifest.source.export_settings)
                    self.assertEqual(settings['timezone'], 'UTC')
                    self.assertEqual(settings['upstream_provider'], 'Dukascopy')
                    self.assertEqual(settings['download_engine'], 'QuantDataManager')
                    saved = client.get('/api/v2/data/datasets', headers=headers).json()['items']
                    self.assertEqual(len(saved), 1)
                    self.assertEqual(saved[0]['asset_class'], 'fx')
                    self.assertGreater(saved[0]['size_bytes'], 0)
                    self.assertEqual(client.post(f'/api/v2/data/downloads/{job_id}/pause', headers=headers).json()['detail'], 'qdm_control_unsupported')
                    print(json.dumps({'scope':'real CLI + disposable PostgreSQL + API', 'rows':manifest.row_count,
                        'catalog_assets':len(assets), 'non_fx_symbols_validated':['USATECHIDXUSD_TW','AAPLUSUSD_TW'],
                        'provider':manifest.source.provider, 'qdm_version':settings['qdm_version'],
                        'raw_sha256':manifest.raw_sha256, 'quality':job['quality']}))
        finally:
            with psycopg.connect(admin, autocommit=True) as conn:
                conn.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))


if __name__ == '__main__':
    unittest.main()
