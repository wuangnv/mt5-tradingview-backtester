import csv
import hashlib
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.market_sync import MarketRuntime, merge_bars


class MemoryStore:
    def __init__(self):
        self.datasets = []

    def list_datasets(self, workspace):
        return list(reversed(self.datasets))

    def get_dataset(self, workspace, dataset_id):
        return next((d for d in self.datasets if d.dataset_id == dataset_id), None)

    def ensure_workspace(self, workspace):
        pass

    def put_dataset(self, dataset):
        self.datasets.append(dataset)


def bars(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', newline='', encoding='utf-8') as handle:
        writer = csv.writer(handle)
        writer.writerow(['time', 'open', 'high', 'low', 'close', 'volume'])
        writer.writerows(rows)


def metadata():
    return {'symbol': 'EURUSDm', 'group': 'Forex', 'instrument': {
        'instrument_id': 'EURUSDm', 'asset_class': 'fx', 'base_ccy': 'EUR', 'quote_ccy': 'USD',
        'account_ccy': 'USD', 'tick_size': '0.00001', 'pip_size': '0.0001', 'contract_size': '100000',
        'quantity_min': '0.01', 'quantity_step': '0.01', 'effective_from_utc': '2026-01-01T00:00:00Z',
        'effective_to_utc': ''}}


class MarketSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = MemoryStore()
        self.artifacts = ArtifactStore(self.root)
        self.runtime = self.make_runtime()
        self.runtime.owned = True
        self.runtime.error = None
        self.runtime.state['assets']['EURUSDm'] = {'metadata': metadata(), 'enabled': True,
            'dataset_id': None, 'status': 'not_downloaded'}

    def tearDown(self):
        self.temp.cleanup()

    def make_runtime(self):
        return MarketRuntime(self.store, self.artifacts, workspace='test-market', python='unused', worker='unused', terminal='unused')

    def test_merge_overlap_correction_keeps_gaps_and_closes_windows_file(self):
        old, new, result = (self.root / name for name in ('old.csv', 'new.csv', 'merged.csv'))
        bars(old, [(60, 1, 2, 1, 1, 10), (180, 1, 2, 1, 1, 20)])
        bars(new, [(180, 1, 3, 1, 2, 21), (240, 2, 3, 1, 2, 30)])
        digest = merge_bars([old, new], result)
        with result.open(newline='') as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual([r['time'] for r in rows], ['60', '180', '240'])
        self.assertEqual(rows[1]['close'], '2')
        self.assertEqual(digest, hashlib.sha256(result.read_bytes()).hexdigest())
        self.assertFalse(result.with_suffix('.sqlite').exists())
        self.assertEqual(merge_bars([result, new], self.root / 'repeat.csv'), digest)

    def test_merge_failure_removes_sqlite_so_next_attempt_can_work(self):
        bad, result = self.root / 'bad.csv', self.root / 'merged.csv'
        bars(bad, [('bad-time', 1, 2, 1, 1, 10)])
        with self.assertRaises(ValueError):
            merge_bars([bad], result)
        self.assertFalse(result.with_suffix('.sqlite').exists())
        bars(bad, [(60, 1, 2, 1, 1, 10)])
        merge_bars([bad], result)

    def test_daily_runs_once_per_utc_day_and_resumes_pending_on_restart(self):
        self.runtime._schedule_daily('2026-10-05')
        self.runtime._schedule_daily('2026-10-05')
        self.assertEqual(len(self.runtime.state['pending']), 1)
        self.assertFalse(self.runtime.state['pending'][0]['latest'])
        resumed = self.make_runtime()
        self.assertEqual(resumed.state['pending'], self.runtime.state['pending'])
        resumed.error = None
        resumed.state['pending'].clear()
        resumed._schedule_daily('2026-10-05')
        self.assertEqual(resumed.state['pending'], [])
        resumed._schedule_daily('2026-10-06')
        self.assertEqual(len(resumed.state['pending']), 1)

    def test_queue_dedup_scope_owner_and_bad_date(self):
        self.runtime.request('test-market', 'EURUSDm')
        self.runtime.request('test-market', 'EURUSDm')
        self.assertEqual(len(self.runtime.state['pending']), 1)
        with self.assertRaises(PermissionError):
            self.runtime.catalog('other')
        with self.assertRaises(PermissionError):
            self.runtime.live_status('other')
        with self.assertRaises(PermissionError):
            self.runtime.request('other')
        with self.assertRaisesRegex(ValueError, 'unknown_market_asset'):
            self.runtime.request('test-market', 'UNKNOWN')
        for date in ('2000-01-01', '2099-01-01', '2026-02-30'):
            with self.assertRaises(ValueError):
                self.runtime.request('test-market', start=date)
        self.runtime.owned = False
        with self.assertRaisesRegex(RuntimeError, 'owner_unavailable'):
            self.runtime.request('test-market')

    def test_collector_rejects_live_server_or_account_drift(self):
        base = {'server': 'Exness-MT5Trial14', 'mode': 'demo', 'execution_capability': False, 'account_key': 'pinned'}
        self.runtime.pin = 'pinned'
        for changed in ({'server': 'Other'}, {'mode': 'live'}, {'execution_capability': True}, {'account_key': 'different'}):
            with self.subTest(changed=changed), patch('trading_workspace_v2.market_sync.subprocess.run',
                return_value=SimpleNamespace(returncode=0, stdout=json.dumps({**base, **changed}))):
                with self.assertRaises(RuntimeError):
                    self.runtime._collect('snapshot')

    def test_queued_and_inflight_date_upgrade_is_not_lost(self):
        self.runtime.request('test-market', 'EURUSDm', '2026-09-01')
        self.runtime.request('test-market', 'EURUSDm', '2026-07-01')
        self.assertEqual(self.runtime.state['pending'][0]['from_date'], '2026-07-01')
        self.runtime.active = 'EURUSDm'
        self.runtime.request('test-market', 'EURUSDm', '2026-06-01')
        self.assertEqual([item['from_date'] for item in self.runtime.state['pending']], ['2026-07-01', '2026-06-01'])
        self.runtime.request('test-market', 'EURUSDm', '2026-05-01')
        self.assertEqual(len(self.runtime.state['pending']), 2)
        self.assertEqual(self.runtime.state['pending'][1]['from_date'], '2026-05-01')

    def test_bulk_retry_only_restores_failed_asset_date(self):
        self.runtime.state['assets']['EURUSDm']['failed_from_date'] = '2025-01-01'
        self.runtime.state['assets']['GBPUSDm'] = {'enabled': True, 'status': 'ready'}
        self.runtime.request('test-market')
        self.assertEqual([item['from_date'] for item in self.runtime.state['pending']], ['2025-01-01', None])

    def test_transient_error_retries_and_exhaustion_keeps_backfill_date(self):
        for always_fail in (False, True):
            with self.subTest(always_fail=always_fail):
                runtime = self.make_runtime()
                runtime.owned = True
                runtime.error = None
                runtime.state['assets']['EURUSDm'] = dict(self.runtime.state['assets']['EURUSDm'])
                runtime.state['pending'] = [{'symbol': 'EURUSDm', 'from_date': '2026-07-01', 'latest': True}]
                runtime.state['daily_attempt'] = datetime.now(timezone.utc).date().isoformat()
                calls, clock = [], [0]
                def sync(request):
                    calls.append(request)
                    if always_fail or len(calls) == 1:
                        raise RuntimeError('mt5_history_read_failed')
                def tick():
                    clock[0] += 100
                    return clock[0]
                runtime._sync_one = sync
                with patch('trading_workspace_v2.market_sync.time.time', side_effect=tick), patch.object(runtime.stop_event, 'wait', side_effect=lambda _: runtime.stop_event.set()):
                    runtime._history_loop()
                self.assertEqual(len(calls), 3 if always_fail else 2)
                self.assertEqual(runtime.state['pending'], [])
                self.assertTrue(all(item['from_date'] == '2026-07-01' for item in calls))
                if always_fail:
                    self.assertEqual(runtime.state['assets']['EURUSDm']['failed_from_date'], '2026-07-01')
                    resumed = self.make_runtime()
                    resumed.owned = True
                    resumed.request('test-market', 'EURUSDm')
                    self.assertEqual(resumed.state['pending'][0]['from_date'], '2026-07-01')

    def test_snapshot_dedups_persisted_deals_cashflows_and_stale(self):
        first = {'server': 'Exness-MT5Trial14', 'mode': 'demo', 'execution_capability': False,
            'account_key': 'same', 'captured_at_utc': datetime.now(timezone.utc).isoformat(),
            'history_from_utc': '2026-07-01T00:00:00Z', 'symbols': [], 'account': {'account_ref': 'masked'},
            'deals': [{'ticket': 1, 'type': 0, 'time_msc': 1}, {'ticket': 2, 'type': 2, 'time_msc': 2}],
            'positions': [], 'orders': [], 'quotes': []}
        self.runtime.live = first
        self.runtime._save()
        from trading_workspace_v2.market_sync import atomic_json
        atomic_json(self.runtime.live_path, first)
        resumed = self.make_runtime()
        updated = {**first, 'deals': [{'ticket': 1, 'type': 0, 'time_msc': 1}, {'ticket': 3, 'type': 1, 'time_msc': 3}]}
        def collect(*args):
            resumed.stop_event.set()
            return updated
        resumed._collect = collect
        resumed._snapshot_loop()
        status = resumed.live_status('test-market')
        self.assertEqual(status['deal_count'], 2)
        self.assertEqual(len(status['cashflows']), 1)
        self.assertEqual(status['positions'], [])
        self.assertFalse(status['stale'])
        resumed.error = 'mt5_disconnected'
        self.assertTrue(resumed.live_status('test-market')['stale'])
        resumed.error = None
        resumed.live['captured_at_utc'] = (datetime.now(timezone.utc) - timedelta(seconds=21)).isoformat()
        self.assertTrue(resumed.live_status('test-market')['stale'])

    def test_real_import_versions_immutable_artifacts_noop_and_recovery(self):
        rows = [(60, 1, 2, 1, 1, 10), (180, 1, 2, 1, 1, 20)]
        def collect(command, *arguments):
            folder = Path(arguments[arguments.index('--output') + 1])
            bars(folder / 'bars.csv', rows)
            return {'row_count': len(rows), 'captured_at_utc': '2026-10-05T00:00:00Z', 'metadata': metadata()}
        self.runtime._collect = collect
        self.runtime._sync_one({'symbol': 'EURUSDm', 'latest': False})
        original = self.store.datasets[0]
        original_bytes = (self.root / original.artifact_path).read_bytes()
        session_dataset_id = original.dataset_id
        self.runtime._sync_one({'symbol': 'EURUSDm', 'latest': False})
        self.assertEqual(len(self.store.datasets), 1)
        rows.append((240, 1, 2, 1, 1, 30))
        self.runtime._sync_one({'symbol': 'EURUSDm', 'latest': True})
        self.assertEqual(len(self.store.datasets), 2)
        latest = self.store.datasets[-1]
        self.assertNotEqual(latest.dataset_id, session_dataset_id)
        self.assertEqual((self.root / original.artifact_path).read_bytes(), original_bytes)
        self.assertEqual(original.row_count, 2)
        self.assertEqual(latest.row_count, 3)
        self.runtime.state['assets']['EURUSDm']['dataset_id'] = original.dataset_id
        self.runtime._discover({'symbols': [metadata()]})
        self.assertEqual(self.runtime.state['assets']['EURUSDm']['dataset_id'], latest.dataset_id)


if __name__ == '__main__':
    unittest.main()
