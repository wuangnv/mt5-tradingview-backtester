"""Isolated read-only MT5 collector. No credentials or broker execution APIs."""

import argparse
import csv
import gzip
import hashlib
import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import MetaTrader5 as mt5
import numpy as np


def account_key(account):
    return hashlib.sha256(f'{account.server}:{account.login}'.encode()).hexdigest()


def group(symbol):
    path = symbol.path.lower()
    if symbol.name.startswith(('XAU', 'XAG', 'XPT', 'XPD', 'XAL', 'XCU', 'XNI', 'XPB', 'XZN')):
        return 'Metals CFD'
    if 'forex' in path:
        return 'Forex'
    if 'metal' in path:
        return 'Metals CFD'
    if 'indice' in path or 'index' in path:
        return 'Indices CFD'
    if 'crypto' in path:
        return 'Crypto CFD'
    if 'stock' in path:
        return 'Stocks CFD'
    if 'energ' in path:
        return 'Energy CFD'
    return 'Other CFD'


def metadata(symbol, account, captured):
    fx = group(symbol) == 'Forex'
    return {
        'symbol': symbol.name, 'description': symbol.description, 'group': group(symbol),
        'product_type': 'fx' if fx else 'cfd', 'digits': symbol.digits,
        'trade_mode': symbol.trade_mode,
        'instrument': {
            'instrument_id': symbol.name, 'asset_class': 'fx' if fx else 'cfd',
            'base_ccy': symbol.currency_base, 'quote_ccy': symbol.currency_profit,
            'account_ccy': account.currency, 'tick_size': str(symbol.trade_tick_size),
            'pip_size': str(symbol.point * (10 if fx and symbol.digits in (3, 5) else 1)),
            'contract_size': str(symbol.trade_contract_size),
            'quantity_min': str(symbol.volume_min), 'quantity_step': str(symbol.volume_step),
            'effective_from_utc': captured, 'effective_to_utc': '',
        },
    }


def collect(args):
    account = mt5.account_info()
    terminal = mt5.terminal_info()
    if not account or not terminal or not terminal.connected:
        raise RuntimeError('mt5_disconnected')
    if account.server != args.server or account.trade_mode != 0:
        raise RuntimeError('mt5_account_scope_denied')
    key = account_key(account)
    if args.account_key and key != args.account_key:
        raise RuntimeError('mt5_account_changed')
    now = datetime.now(timezone.utc)
    captured = now.isoformat()
    base = {'account_key': key, 'server': account.server, 'mode': 'demo',
            'captured_at_utc': captured, 'execution_capability': False}
    if args.command == 'snapshot':
        symbols = mt5.symbols_get()
        positions = mt5.positions_get()
        orders = mt5.orders_get()
        deals = mt5.history_deals_get(now - timedelta(days=90), now)
        if any(value is None for value in (symbols, positions, orders, deals)):
            raise RuntimeError('mt5_snapshot_incomplete')
        # Only selected fields leave the SDK process; login and credentials never do.
        base.update({
            'account': {'account_ref': f'…{str(account.login)[-4:]}', 'currency': account.currency,
                        'balance': account.balance, 'equity': account.equity, 'profit': account.profit,
                        'margin': account.margin, 'margin_free': account.margin_free,
                        'leverage': account.leverage},
            'symbols': [metadata(s, account, captured) for s in symbols if s.name.endswith('m')],
            'positions': [{k: getattr(p, k) for k in ('ticket', 'symbol', 'type', 'volume', 'price_open', 'price_current', 'sl', 'tp', 'profit', 'swap', 'time')} for p in positions],
            'orders': [{k: getattr(o, k) for k in ('ticket', 'symbol', 'type', 'volume_current', 'price_open', 'sl', 'tp', 'time_setup')} for o in orders],
            'deals': [{k: getattr(d, k) for k in ('ticket', 'order', 'position_id', 'symbol', 'type', 'entry', 'volume', 'price', 'profit', 'commission', 'swap', 'fee', 'time_msc')} for d in deals],
            'history_from_utc': (now - timedelta(days=90)).isoformat(),
        })
        quotes = []
        for name in ('EURUSDm', 'GBPUSDm', 'USDJPYm', 'XAUUSDm', 'US500m', 'BTCUSDm'):
            tick = mt5.symbol_info_tick(name)
            if tick and tick.bid > 0 and tick.ask > 0:
                quotes.append({'symbol': name, 'bid': tick.bid, 'ask': tick.ask, 'time_msc': tick.time_msc})
        base['quotes'] = quotes
        checked = mt5.account_info()
        if not checked or account_key(checked) != key or checked.trade_mode != 0:
            raise RuntimeError('mt5_account_changed')
        return base

    if not re.fullmatch(r'[A-Za-z0-9_]+', args.symbol or ''):
        raise ValueError('invalid_symbol')
    symbol = mt5.symbol_info(args.symbol)
    if not symbol or not args.symbol.endswith('m') or not mt5.symbol_select(args.symbol, True):
        raise ValueError('symbol_unavailable')
    start = datetime.fromtimestamp(args.start, timezone.utc)
    end = datetime.fromtimestamp(args.end, timezone.utc)
    if end <= start or end - start > timedelta(days=1827) or end > now:
        raise ValueError('invalid_history_range')
    if args.command == 'ticks':
        if end - start > timedelta(days=1):
            raise ValueError('invalid_tick_chunk_range')
        started = time.perf_counter()
        ticks = mt5.copy_ticks_range(args.symbol, start, end, mt5.COPY_TICKS_ALL)
        if ticks is None:
            raise RuntimeError('mt5_ticks_read_failed')
        ticks = ticks[(ticks['time_msc'] >= args.start * 1000) & (ticks['time_msc'] < args.end * 1000)]
        # Stable sorting retains broker order for repeated timestamps; no dedup.
        ticks = ticks[np.argsort(ticks['time_msc'], kind='stable')]
        checked = mt5.account_info()
        if not checked or account_key(checked) != key or checked.trade_mode != 0:
            raise RuntimeError('mt5_account_changed')
        folder = Path(args.output)
        folder.mkdir(parents=True, exist_ok=True)
        raw = folder / 'ticks.csv.gz'
        with gzip.open(raw, 'wt', newline='', encoding='utf-8', compresslevel=3) as handle:
            writer = csv.writer(handle)
            writer.writerow(['time_msc', 'bid', 'ask', 'last', 'volume', 'flags', 'volume_real'])
            writer.writerows((int(t['time_msc']), repr(float(t['bid'])), repr(float(t['ask'])),
                repr(float(t['last'])), int(t['volume']), int(t['flags']), repr(float(t['volume_real']))) for t in ticks)
        base.update(symbol=args.symbol, metadata=metadata(symbol, account, captured),
            requested_from_msc=args.start * 1000, requested_to_msc=args.end * 1000,
            row_count=len(ticks), status='downloaded' if len(ticks) else 'unavailable',
            tick_file='ticks.csv.gz', raw_sha256=hashlib.sha256(raw.read_bytes()).hexdigest(),
            first_tick_msc=int(ticks[0]['time_msc']) if len(ticks) else None,
            last_tick_msc=int(ticks[-1]['time_msc']) if len(ticks) else None,
            compressed_bytes=raw.stat().st_size, elapsed_seconds=time.perf_counter() - started)
        (folder / 'receipt.json').write_text(json.dumps(base, indent=2), encoding='utf-8')
        return base
    chunks, cursor = [], start
    while cursor < end:
        boundary = min(cursor + timedelta(days=7), end)
        chunk = mt5.copy_rates_range(args.symbol, mt5.TIMEFRAME_M1, cursor, boundary)
        if chunk is None:
            raise RuntimeError('mt5_history_read_failed')
        if len(chunk):
            chunks.append(chunk)
        cursor = boundary
    rates = np.concatenate(chunks) if chunks else np.array([], dtype=[])
    if len(rates):
        _, indexes = np.unique(rates['time'], return_index=True)
        rates = rates[indexes]
        rates = rates[(rates['time'] >= args.start) & (rates['time'] < args.end)]
    # Recheck identity after the potentially long download before publishing any data.
    checked = mt5.account_info()
    if not checked or account_key(checked) != key or checked.trade_mode != 0:
        raise RuntimeError('mt5_account_changed')
    folder = Path(args.output)
    folder.mkdir(parents=True, exist_ok=True)
    raw = folder / 'broker-rates.csv'
    normalized = folder / 'bars.csv'
    with raw.open('w', newline='', encoding='utf-8') as handle:
        writer = csv.writer(handle)
        writer.writerow(['time', 'open', 'high', 'low', 'close', 'tick_volume', 'spread', 'real_volume'])
        writer.writerows(tuple(row) for row in rates)
    with normalized.open('w', newline='', encoding='utf-8') as handle:
        writer = csv.writer(handle)
        writer.writerow(['time', 'open', 'high', 'low', 'close', 'volume'])
        writer.writerows((int(r['time']), *[format(float(r[k]), f'.{symbol.digits}f') for k in ('open', 'high', 'low', 'close')], int(r['tick_volume'])) for r in rates)
    base.update({'symbol': args.symbol, 'metadata': metadata(symbol, account, captured),
                 'row_count': len(rates), 'requested_from': args.start, 'requested_to': args.end,
                 'raw_sha256': hashlib.sha256(raw.read_bytes()).hexdigest(),
                 'csv_sha256': hashlib.sha256(normalized.read_bytes()).hexdigest()})
    (folder / 'receipt.json').write_text(json.dumps(base, indent=2), encoding='utf-8')
    return base


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('snapshot', 'history', 'ticks'))
    parser.add_argument('--terminal', required=True)
    parser.add_argument('--server', default='Exness-MT5Trial14')
    parser.add_argument('--account-key')
    parser.add_argument('--symbol')
    parser.add_argument('--start', type=int)
    parser.add_argument('--end', type=int)
    parser.add_argument('--output')
    args = parser.parse_args()
    if not mt5.initialize(args.terminal, timeout=15000):
        raise RuntimeError('mt5_initialize_failed')
    try:
        print(json.dumps(collect(args), allow_nan=False))
    finally:
        mt5.shutdown()


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # Avoid leaking SDK/account internals through process logs.
        print(json.dumps({'error': str(exc) if str(exc).startswith(('mt5_', 'invalid_', 'symbol_')) else 'collector_failed'}), file=sys.stderr)
        sys.exit(1)
