import unittest
from collections import Counter
from unittest.mock import patch

import test_qdm_downloads as fixtures
from trading_workspace_v2.qdm_cli import CATALOG_PATH, QdmCatalog, parse_catalog


def definition(code='EURUSD', name='EURUSD', category='Forex', group='Majors', start='05.05.2003'):
    return f'{code};{name};{category};{group};01.05.2003;{start};5;100000;3;0.0001;0.00001;3\n'


class CatalogParserTests(unittest.TestCase):
    def test_encoding_categories_dates_and_identity(self):
        raw = '\n'.join([definition(), definition('XAUUSD', category='Forex', group='Metals'),
            definition('AAPLUSUSD', 'Apple®', ' Stocks', ' US ', '6.12.2017'),
            definition('USA30IDXUSD', 'USA 30', 'Indices', 'America'),
            definition('OIL', category='Commodities', group='Energy'),
            definition('COFFEE', category='Commodities', group='Soft'),
            definition('BUND', category='Bond', group='common'),
            definition('BTCUSD', category='Crypto', group='Majors')])
        for encoding in ['cp1252', 'utf-8-sig']:
            items = parse_catalog(raw.encode(encoding))
            self.assertEqual(len(items), 8)
            self.assertEqual(items['EUR/USD']['code'], 'EURUSD')
            self.assertEqual(items['XAU/USD']['asset_class'], 'metal')
            self.assertEqual(items['AAPLUSUSD']['name'], 'Apple®')
            self.assertEqual(items['AAPLUSUSD']['startDayForMinuteCandles'], '2017-12-06')
            self.assertEqual(Counter(i['asset_class'] for i in items.values()),
                             Counter(['fx','metal','stock','index','energy','agriculture','bond','crypto']))

    def test_rejects_empty_duplicate_malformed_and_unsafe_definitions(self):
        for raw in ['', 'bad;row', definition()+definition(), definition('X/../../Y'),
                    definition(start='31.02.2020'), definition(category='Unknown')]:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                parse_catalog(raw.encode())


class CatalogLifecycleTests(unittest.TestCase):
    setUp = fixtures.QdmTests.setUp

    def test_refresh_addition_reaches_downloader_without_restart(self):
        path = self.cli.home / CATALOG_PATH
        path.write_text(definition()+definition('AAPLUSUSD', 'Apple', 'Stocks', 'US', '26.01.2017'))
        with patch.object(self.cli, 'probe', side_effect=AssertionError('catalog must not launch CLI')):
            self.catalog.refresh()
        self.assertEqual(self.catalog.status()['asset_count'], 2)
        self.assertIn('AAPLUSUSD', self.service.availability()['supported_instruments'])
        self.assertEqual(self.service.availability()['earliest_dates']['AAPLUSUSD'], '2017-01-26')
        job = self.service.request_full('a', 'AAPLUSUSD')
        self.assertEqual(job['provider_code'], 'AAPLUSUSD')
        self.assertEqual(job['from_date'], '2017-01-26')
        self.assertEqual(job['catalog_sha256'], self.catalog.source_sha256)
        reloaded = QdmCatalog(self.cli)
        reloaded.refresh()
        self.assertEqual(reloaded.list_instruments('b'), self.catalog.list_instruments('a'))

    def test_invalid_or_missing_refresh_retains_good_catalog(self):
        previous = self.catalog.list_instruments('a')
        stamp, digest = self.catalog.updated_at, self.catalog.source_sha256
        path = self.cli.home / CATALOG_PATH
        path.write_text('invalid')
        self.catalog.refresh()
        self.assertEqual(self.catalog.error, 'qdm_catalog_invalid')
        self.assertTrue(self.catalog.status()['stale'])
        self.assertEqual(self.catalog.list_instruments('a'), previous)
        self.assertEqual((self.catalog.updated_at, self.catalog.source_sha256), (stamp, digest))
        self.assertFalse(self.service.availability()['available'])
        with self.assertRaisesRegex(RuntimeError, 'qdm_catalog_invalid'):
            self.service.request_full('a', 'EUR/USD')
        with self.assertRaisesRegex(RuntimeError, 'qdm_catalog_invalid'):
            self.service.request('a', 'EUR/USD', '2026-10-05', '2026-10-05')
        with self.assertRaisesRegex(RuntimeError, 'qdm_catalog_invalid'):
            self.service.resume('a', 'unused')
        self.assertFalse(list(self.service.root.glob('**/job.json')))
        path.unlink()
        self.catalog.refresh()
        self.assertEqual(self.catalog.error, 'qdm_catalog_missing')
        missing = QdmCatalog(self.cli)
        missing.refresh()
        self.assertEqual(missing.list_instruments('a'), [])
        self.assertFalse(missing.status()['stale'])
        path.write_text(definition())
        self.catalog.refresh()
        self.assertIsNone(self.catalog.error)
        self.assertTrue(self.service.availability()['available'])

    def test_new_unpopulated_symbol_and_pinned_job_survive_catalog_refresh(self):
        job = self.service.request('a', 'EUR/USD', '2026-10-05', '2026-10-05')
        (self.cli.home / CATALOG_PATH).write_text(definition('GBPUSD'))
        self.catalog.refresh()
        self.service._run(self.service._read('a', job['job_id']))
        self.assertEqual(self.service._read('a', job['job_id'])['status'], 'completed')
        with patch.object(self.cli, 'symbols', return_value=[{'Symbol':'EURUSD_TW', 'Instrument':'EURUSD',
                'Source':'Dukascopy', 'Timeframe':'M1', 'Timezone':'', 'Total records':'0'}]):
            self.assertEqual(self.service._ensure_symbol('EUR/USD', 'EURUSD'), 'EURUSD_TW')
        with patch.object(self.cli, 'symbols', return_value=[{'Symbol':'EURUSD_TW', 'Instrument':'EURUSD',
                'Source':'Dukascopy', 'Timeframe':'M1', 'Timezone':'', 'Total records':'10'}]):
            with self.assertRaisesRegex(RuntimeError, 'qdm_symbol_mismatch'):
                self.service._ensure_symbol('EUR/USD', 'EURUSD')

    def test_non_forex_download_uses_catalog_code_and_publishes_price_only(self):
        (self.cli.home / CATALOG_PATH).write_text(definition('USA30IDXUSD', 'USA 30', 'Indices', 'America', '30.09.2013'))
        self.catalog.refresh()
        self.cli.symbols = lambda: [{'Symbol':'USA30IDXUSD_TW', 'Instrument':'USA30IDXUSD', 'Timeframe':'M1',
                'Source':'Dukascopy', 'Timezone':'(UTC) Coordinated Universal Time, DST: No'}]
        job = self.service.request('a', 'USA30IDXUSD', '2026-10-05', '2026-10-05')
        self.service._run(self.service._read('a', job['job_id']))
        result = self.service._read('a', job['job_id'])
        self.assertEqual(result['status'], 'completed')
        manifest = self.store.get_dataset('a', result['dataset_id'])
        self.assertEqual(manifest.source.instrument_mapping, {'USA30IDXUSD':'USA30IDXUSD'})
        self.assertIsNone(manifest.instrument_spec)


if __name__ == '__main__':
    unittest.main()
