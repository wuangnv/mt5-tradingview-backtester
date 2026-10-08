import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.qdm_cli import QdmCatalog, QdmCli, cli_error
from trading_workspace_v2.qdm_downloads import QdmDownloads, normalize_export
from test_dukascopy_full_downloads import MemoryStore


class FixtureCli:
    def __init__(self, root):
        self.home = root
        definitions = root / 'internal/plugins/DataSourceDukascopy/dukascopy.csv'
        definitions.parent.mkdir(parents=True)
        definitions.write_text('EURUSD;EURUSD;Forex;Majors;05.05.2003;05.05.2003;5;100000;3;0.0001;0.00001;3\n')
        self.executable = root / 'qdmcli.exe'
        self.executable.touch()
        self.version = '125.2692'
        self.calls = []
        self.source = 'Dukascopy'
        self.failure = None

    def probe(self):
        return self.version

    def symbols(self):
        return [{'Symbol': 'EURUSD_TW', 'Instrument': 'EURUSD', 'Timeframe': 'M1', 'Source': self.source,
                 'Timezone': '(UTC) Coordinated Universal Time, DST: No'}]

    def run(self, args, on_line=None, **kwargs):
        self.calls.append(args)
        if self.failure:
            raise RuntimeError(self.failure)
        if 'action=update' in args and on_line:
            on_line('EURUSD_TW, Writing  2026.10.05, 50%\n')
        if 'action=export' in args:
            output = Path(next(item.split('=', 1)[1] for item in args if item.startswith('outputdir=')))
            start = next(item.split('=', 1)[1] for item in args if item.startswith('datefrom='))
            (output / 'EURUSD.csv').write_text('Date,Time,Open,High,Low,Close,Volume\n'
                f'{start},00:00:00,1.1,1.3,1,1.2,4\n{start},00:01:00,1.2,1.4,1.1,1.3,5\n')
        return 'Exit app - ok'


class QdmTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cli = FixtureCli(self.root)
        self.catalog = QdmCatalog(self.cli)
        self.store = MemoryStore()
        self.artifacts = ArtifactStore(self.root / 'artifacts')
        self.service = QdmDownloads(self.store, self.artifacts, self.catalog, SimpleNamespace(authorize=lambda workspace: None))
        self.service._start = lambda job: setattr(self.service, 'active', (job['workspace_id'], job['job_id']))

    def test_cli_zero_exit_is_not_enough_for_busy_or_failed_command(self):
        for output, error in [('Exit app - Another instance of QuantDataManager is running.', 'qdm_busy'),
                              ('Exit app - Missing license.', 'qdm_license_required'),
                              ('ERROR Export failed\nExit app - ok', 'qdm_command_failed')]:
            self.assertEqual(cli_error(output), error)
            real = QdmCli(self.root)
            with patch('trading_workspace_v2.qdm_cli.subprocess.run', return_value=SimpleNamespace(stdout=output, returncode=0)):
                with self.assertRaisesRegex(RuntimeError, error):
                    real.run(['-h'], timeout=2)

    def test_catalog_and_jobs_use_qdm_name_and_truthful_capabilities(self):
        self.assertEqual(self.catalog.list_instruments('a')[0]['provider'], 'QuantDataManager')
        self.assertEqual(self.service.availability()['provider'], 'QuantDataManager')
        self.assertFalse(self.service.list_jobs('a')['supports_pause'])
        self.assertFalse(self.service.list_jobs('a')['supports_cancel'])
        with self.assertRaisesRegex(RuntimeError, 'qdm_control_unsupported'):
            self.service.pause('a', 'unused')

    def test_early_cli_error_is_not_lost_in_bounded_progress_output(self):
        process = MagicMock()
        process.__enter__.return_value = process
        process.stdout = iter(['ERROR Update failed\n', *['EURUSD_TW, Writing, 50%\n'] * 600, 'Exit app - ok\n'])
        process.wait.return_value = 0
        with patch('trading_workspace_v2.qdm_cli.subprocess.Popen', return_value=process):
            with self.assertRaisesRegex(RuntimeError, 'qdm_command_failed'):
                QdmCli(self.root).run(['-data', 'action=update'])

    def test_actual_executor_validates_and_publishes_immutable_qdm_artifact(self):
        job = self.service.request('a', 'EUR/USD', '2026-10-05', '2026-10-05')
        self.service._run(self.service._read('a', job['job_id']))
        result = self.service._read('a', job['job_id'])
        self.assertEqual(result['status'], 'completed')
        self.assertIsNone(result['transferred_bytes'])
        manifest = self.store.get_dataset('a', result['dataset_id'])
        self.assertEqual(manifest.source.provider, 'QuantDataManager')
        self.assertEqual(manifest.row_count, 2)
        settings = json.loads(manifest.source.export_settings)
        self.assertEqual(settings['upstream_provider'], 'Dukascopy')
        self.assertEqual(settings['timezone'], 'UTC')
        self.assertEqual(settings['qdm_version'], '125.2692')
        original = (self.artifacts.root / manifest.raw_artifact_path).read_bytes()
        update = self.service._request('a', 'EUR/USD', '2026-10-06', '2026-10-06',
                    parent_dataset_id=manifest.dataset_id, full_from_date='2026-10-05')
        self.service._run(self.service._read('a', update['job_id']))
        latest = self.service._read('a', update['job_id'])
        self.assertEqual(latest['status'], 'completed')
        self.assertNotEqual(latest['dataset_id'], manifest.dataset_id)
        self.assertEqual(self.store.get_dataset('a', latest['dataset_id']).row_count, 4)
        self.assertEqual((self.artifacts.root / manifest.raw_artifact_path).read_bytes(), original)
        self.assertIn('timezone=UTC', self.cli.calls[-1])

    def test_busy_and_wrong_existing_source_do_not_publish(self):
        for error in ['qdm_busy', 'qdm_license_required']:
            self.cli.failure = error
            job = self.service.request('a', 'EUR/USD', '2026-10-05', '2026-10-05')
            self.service._run(self.service._read('a', job['job_id']))
            self.assertEqual(self.service._read('a', job['job_id'])['error'], error)
            self.assertEqual(self.store.datasets, {})
        self.cli.failure = None
        self.cli.source = 'Yahoo'
        job = self.service.request('a', 'EUR/USD', '2026-10-06', '2026-10-06')
        self.service._run(self.service._read('a', job['job_id']))
        self.assertEqual(self.service._read('a', job['job_id'])['error'], 'qdm_symbol_mismatch')
        self.assertEqual(self.store.datasets, {})

    def test_normalization_rejects_missing_header_invalid_time_and_outside_range(self):
        for content in ['not,a,qdm,export\n', 'Date,Time,Open,High,Low,Close,Volume\n2026.10.05,25:00:00,1,1,1,1,0\n',
                        'Date,Time,Open,High,Low,Close,Volume\n2026.10.04,00:00:00,1,1,1,1,0\n']:
            path = self.root / 'input.csv'
            path.write_text(content)
            with self.assertRaisesRegex(RuntimeError, 'invalid_source_data'):
                normalize_export(path, self.root / 'out.csv', '2026-10-05', '2026-10-05')

    def test_stop_during_export_never_publishes_and_retry_can_complete(self):
        original_run = self.cli.run
        def stop_at_export(args, **kwargs):
            result = original_run(args, **kwargs)
            if 'action=export' in args:
                self.service.stop()
            return result
        self.cli.run = stop_at_export
        job = self.service.request('a', 'EUR/USD', '2026-10-05', '2026-10-05')
        self.service._run(self.service._read('a', job['job_id']))
        self.assertEqual(self.service._read('a', job['job_id'])['error'], 'download_interrupted')
        self.assertEqual(self.store.datasets, {})
        self.service.stopping = False
        self.cli.run = original_run
        self.service.resume('a', job['job_id'])
        self.service._run(self.service._read('a', job['job_id']))
        self.assertEqual(self.service._read('a', job['job_id'])['status'], 'completed')

    def test_reused_symbol_in_other_timezone_is_rejected(self):
        self.cli.symbols = lambda: [{'Symbol':'EURUSD_TW', 'Timeframe':'M1', 'Source':'Dukascopy', 'Timezone':'New York'}]
        with self.assertRaisesRegex(RuntimeError, 'qdm_symbol_mismatch'):
            self.service._ensure_symbol('EUR/USD')

    def test_new_symbol_parameters_are_explicit_without_broker_cost_assumptions(self):
        listing = self.cli.symbols()
        with patch.object(self.cli, 'symbols', side_effect=[[], listing]):
            self.assertEqual(self.service._ensure_symbol('EUR/USD'), 'EURUSD_TW')
        self.assertEqual(self.cli.calls[-1], ['-symbol','action=add','symbols=EURUSD',
            'datasource=dukascopy','datatype=M1','bartype=startofbar','postfix=_TW'])


if __name__ == '__main__':
    unittest.main()
