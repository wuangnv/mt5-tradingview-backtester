import importlib.util
import csv
import gzip
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

try:
    import numpy as np
except ImportError:
    np = None


@unittest.skipIf(np is None, 'Run collector tests in the isolated MT5 SDK environment')
class MT5ReadWorkerTests(unittest.TestCase):
    def setUp(self):
        self.sdk = Mock()
        path = Path(__file__).resolve().parents[1] / 'scripts/mt5_read_worker.py'
        spec = importlib.util.spec_from_file_location('read_worker_test', path)
        self.worker = importlib.util.module_from_spec(spec)
        with patch.dict('sys.modules', {'MetaTrader5': self.sdk}):
            spec.loader.exec_module(self.worker)
        self.account = SimpleNamespace(server='Exness-MT5Trial14', login=1234567, trade_mode=0,
            currency='USD', balance=10, equity=10, profit=0, margin=0, margin_free=10, leverage=100)
        self.sdk.account_info.return_value = self.account
        self.sdk.terminal_info.return_value = SimpleNamespace(connected=True)
        self.symbol = SimpleNamespace(name='EURUSDm', path='Forex', description='Euro vs US Dollar', digits=5,
            point=.00001, trade_mode=4, currency_base='EUR', currency_profit='USD', trade_tick_size=.00001,
            trade_contract_size=100000, volume_min=.01, volume_step=.01)
        self.sdk.symbols_get.return_value = (self.symbol,)
        self.sdk.positions_get.return_value = ()
        self.sdk.orders_get.return_value = ()
        self.sdk.history_deals_get.return_value = ()
        self.sdk.symbol_info_tick.return_value = None
        self.sdk.symbol_info.return_value = self.symbol
        self.args = SimpleNamespace(command='snapshot', server=self.account.server, account_key=None)

    def test_empty_broker_snapshot_is_real_empty_without_login_or_execution_calls(self):
        payload = self.worker.collect(self.args)
        self.assertEqual(payload['positions'], [])
        self.assertEqual(payload['orders'], [])
        self.assertEqual(payload['deals'], [])
        self.assertEqual(payload['account']['account_ref'], '…4567')
        self.assertNotIn('login', payload['account'])
        self.assertFalse(payload['execution_capability'])
        self.assertFalse(self.sdk.order_send.called)
        self.assertFalse(self.sdk.order_check.called)

    def test_incomplete_is_error_not_empty(self):
        for method in ('symbols_get', 'positions_get', 'orders_get', 'history_deals_get'):
            with self.subTest(method=method):
                read = getattr(self.sdk, method)
                saved = read.return_value
                read.return_value = None
                with self.assertRaisesRegex(RuntimeError, 'snapshot_incomplete'):
                    self.worker.collect(self.args)
                read.return_value = saved

    def test_scope_and_identity_rechecked_after_read(self):
        self.account.trade_mode = 2
        with self.assertRaisesRegex(RuntimeError, 'scope_denied'):
            self.worker.collect(self.args)
        self.account.trade_mode = 0
        changed = SimpleNamespace(server=self.account.server, login=7654321, trade_mode=0)
        self.sdk.account_info.side_effect = [self.account, changed]
        with self.assertRaisesRegex(RuntimeError, 'account_changed'):
            self.worker.collect(self.args)

    def test_metal_in_forex_folder_is_cfd(self):
        for symbol in ('XAUUSDm', 'XAGUSDm', 'XCUUSDm', 'XZNUSDm'):
            self.symbol.name = symbol
            self.assertEqual(self.worker.metadata(self.symbol, self.account, 'now')['product_type'], 'cfd')

    def test_history_dedups_week_boundaries_and_excludes_forming_bar(self):
        dtype = [('time', 'i8'), ('open', 'f8'), ('high', 'f8'), ('low', 'f8'), ('close', 'f8'),
            ('tick_volume', 'i8'), ('spread', 'i8'), ('real_volume', 'i8')]
        end = int(datetime.now(timezone.utc).timestamp()) // 60 * 60
        start = end - 8 * 86400
        boundary = start + 7 * 86400
        row = lambda t: (t, 1, 2, 1, 1.5, 10, 12, 0)
        self.sdk.copy_rates_range.side_effect = [np.array([row(start), row(boundary)], dtype=dtype),
            np.array([row(boundary), row(end - 60), row(end)], dtype=dtype)]
        with tempfile.TemporaryDirectory() as folder:
            self.args.command, self.args.symbol = 'history', 'EURUSDm'
            self.args.start, self.args.end, self.args.output = start, end, folder
            payload = self.worker.collect(self.args)
            self.assertEqual(payload['row_count'], 3)
            self.assertEqual(len((Path(folder) / 'broker-rates.csv').read_text().splitlines()), 4)
            self.assertEqual(len((Path(folder) / 'bars.csv').read_text().splitlines()), 4)
            self.assertTrue((Path(folder) / 'receipt.json').exists())
        self.assertFalse(self.sdk.order_send.called)

    def tick_args(self, folder):
        start = int(datetime(2026, 9, 1, tzinfo=timezone.utc).timestamp())
        return SimpleNamespace(command='ticks', server=self.account.server, account_key=None,
            symbol='EURUSDm', start=start, end=start + 86400, output=folder)

    def tick_array(self, rows):
        return np.array(rows, dtype=[('time_msc', 'i8'), ('bid', 'f8'), ('ask', 'f8'),
            ('last', 'f8'), ('volume', 'i8'), ('flags', 'i8'), ('volume_real', 'f8')])

    def test_ticks_keep_same_ms_order_and_duplicates_exclude_end(self):
        with tempfile.TemporaryDirectory() as folder:
            args = self.tick_args(folder)
            start = args.start * 1000
            row = lambda t, b: (t, b, b + .0002, 0, 0, 6, 0)
            self.sdk.copy_ticks_range.return_value = self.tick_array([
                row(start + 2, 1.2), row(start, 1.1), row(start, 1.11),
                row(start, 1.11), row(args.end * 1000, 1.3), row(start - 1, 1.0)])
            payload = self.worker.collect(args)
            self.assertEqual(payload['row_count'], 4)
            with gzip.open(Path(folder) / 'ticks.csv.gz', 'rt', newline='') as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual([float(r['bid']) for r in rows], [1.1, 1.11, 1.11, 1.2])
            self.assertEqual(payload['requested_to_msc'], args.end * 1000)
            self.assertFalse(self.sdk.order_send.called)
            self.assertFalse(self.sdk.order_check.called)

    def test_empty_ticks_are_unavailable_read_failure_is_error(self):
        with tempfile.TemporaryDirectory() as folder:
            args = self.tick_args(folder)
            self.sdk.copy_ticks_range.return_value = self.tick_array([])
            self.assertEqual(self.worker.collect(args)['status'], 'unavailable')
            self.sdk.copy_ticks_range.return_value = None
            with self.assertRaisesRegex(RuntimeError, 'ticks_read_failed'):
                self.worker.collect(args)
            args.end += 1
            with self.assertRaisesRegex(ValueError, 'tick_chunk_range'):
                self.worker.collect(args)

    def test_ticks_account_drift_rejected_before_receipt_write(self):
        with tempfile.TemporaryDirectory() as folder:
            self.sdk.copy_ticks_range.return_value = self.tick_array([])
            self.sdk.account_info.side_effect = [self.account,
                SimpleNamespace(server=self.account.server, login=7654321, trade_mode=0)]
            with self.assertRaisesRegex(RuntimeError, 'account_changed'):
                self.worker.collect(self.tick_args(folder))
            self.assertFalse((Path(folder) / 'receipt.json').exists())


if __name__ == '__main__':
    unittest.main()
