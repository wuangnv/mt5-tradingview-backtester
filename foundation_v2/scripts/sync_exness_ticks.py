"""Bounded owner-authorized Exness demo tick backfill; no broker execution."""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

repo = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(repo / 'foundation_v2'), str(repo)]

from trading_workspace_v2.artifacts import ArtifactStore
from trading_workspace_v2.market_sync import MarketRuntime, atomic_json
from trading_workspace_v2.tick_history import TickHistoryStore


def sync(runtime, tick_store, days, *, symbols=('EURUSDm', 'XAUUSDm')):
    end = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    progress_path = runtime.root / 'tick-backfill-progress.json'
    report = {'status': 'running', 'days': days, 'requested_to_utc': end.isoformat(),
              'symbols': {}, 'execution_capability': False}
    atomic_json(progress_path, report)
    for symbol in symbols:
        started = time.perf_counter()
        result = {'downloaded_days': 0, 'unavailable_days': 0, 'errors': [], 'row_count': 0,
                  'compressed_bytes': 0, 'elapsed_seconds': 0}
        report['symbols'][symbol] = result
        latest = tick_store.latest(runtime.workspace, symbol)
        for offset in range(days, 0, -1):
            start = end - timedelta(days=offset)
            stop = start + timedelta(days=1)
            # Resume already captured complete UTC days, including empty replies.
            previous = next((p for p in (latest or {}).get('partitions', [])
                if p.get('requested_from_msc') == int(start.timestamp()) * 1000
                and p.get('requested_to_msc') == int(stop.timestamp()) * 1000), None)
            if previous:
                result['downloaded_days' if previous['row_count'] else 'unavailable_days'] += 1
                result['row_count'] += previous['row_count']
                continue
            folder = runtime.root / 'tick-captures' / f'{symbol}-{start.date()}-{uuid4().hex}'
            try:
                receipt = runtime._collect('ticks', '--symbol', symbol, '--start', str(int(start.timestamp())),
                    '--end', str(int(stop.timestamp())), '--output', str(folder))
                latest = tick_store.ingest_capture(runtime.workspace, folder / 'receipt.json')
                result['downloaded_days' if receipt['row_count'] else 'unavailable_days'] += 1
                result['row_count'] += receipt['row_count']
                result['compressed_bytes'] += receipt['compressed_bytes']
                result['snapshot_id'] = latest['snapshot_id']
            except Exception as exc:
                result['errors'].append({'date': str(start.date()), 'error': str(exc) if str(exc).startswith('mt5_') else type(exc).__name__})
            result['elapsed_seconds'] = time.perf_counter() - started
            atomic_json(progress_path, report)
        result['elapsed_seconds'] = time.perf_counter() - started
        atomic_json(progress_path, report)
        print(json.dumps({'symbol': symbol, **result}), flush=True)
    report['status'] = 'partial' if any(s['errors'] or not s['downloaded_days'] for s in report['symbols'].values()) else 'completed_with_unverified_gaps'
    atomic_json(progress_path, report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--days', type=int, choices=(7, 90), default=7)
    parser.add_argument('--mt5-python', type=Path, required=True)
    parser.add_argument('--terminal', default='C:/Program Files/MetaTrader 5/terminal64.exe')
    args = parser.parse_args()
    artifacts = ArtifactStore(repo / 'foundation_v2/.runtime/exness-market-data')
    runtime = MarketRuntime(None, artifacts, workspace='tenant-a', python=args.mt5_python.resolve(),
        worker=repo / 'foundation_v2/scripts/mt5_read_worker.py', terminal=args.terminal)
    if not runtime.pin:
        raise RuntimeError('mt5_authorized_account_pin_missing')
    tick_store = TickHistoryStore(artifacts.root)
    sync(runtime, tick_store, args.days)


if __name__ == '__main__':
    main()
