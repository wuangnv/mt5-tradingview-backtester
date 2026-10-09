"""Bounded read-only baseline versus installed projection; no app mutation."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'tests'), str(ROOT.parent)]
from trading_workspace_v2 import trades_page
from test_trades_page import row, report, journal


def stats(samples):
    ordered = sorted(samples)
    return {'samples_ms': samples, 'p50_ms': statistics.median(samples),
            'sample_p95_ms': ordered[math.ceil(len(ordered) * .95) - 1]}


def projection_baseline():
    path = ROOT / 'scripts' / 'fixtures' / 'trades_page_baseline_20261009.py'
    # Frozen pre-optimization source, not a reverse-generated slow candidate.
    # Normalize checkout line endings so this evidence runs on Windows/Linux.
    source = path.read_text(encoding='utf-8')
    digest = hashlib.sha256(source.encode()).hexdigest()
    assert digest == '426761d47c4e50d5ed51d1c0eacb16ab9ff199c424fe23d730f8f38f5b60f900', 'Baseline drift: review frozen source before rerunning'
    namespace = {'__name__': 'trading_workspace_v2._benchmark_baseline', '__package__': 'trading_workspace_v2'}
    exec(compile(source, str(path), 'exec'), namespace)
    return namespace['build_trades_page'], digest


def call(fn, payload, journals, filters=None, sort='close_time_utc'):
    return fn(payload, journals, page=1, page_size=10, sort_key=sort,
              sort_direction='desc', extra_filters=json.dumps(filters or {}))


def experiment(repeats):
    baseline_fn, digest = projection_baseline()
    candidate = trades_page.build_trades_page
    # Both source aliases may be present; preserve journal order and deduplicate tags.
    payload = report([row(i) for i in range(12)])
    notes = [journal(i, ['planned', 'same']) for i in range(12)]
    notes += [{'record_id': 'alias', 'revision': 1, 'payload': {'source': {
        'session_id': 'session-a', 'replay_session_id': 'session-a',
        'trade_id': 'trade-001', 'id': 'trade-002'}, 'tags': ['same', 'alias']}}]
    parity = 0
    for filters in [{}, {'tagInclude': '["alias"]'}, {'tagExclude': '["planned"]'},
                    {'timeStart': '23:30', 'timeEnd': '00:30'},
                    {'timezone': 'Asia/Ho_Chi_Minh', 'hours': '["5"]'},
                    {'reportKinds': '[]'}]:
        for sort in ['close_time_utc', 'net_pnl', 'rating', 'tags']:
            assert call(candidate, payload, notes, filters, sort) == call(baseline_fn, payload, notes, filters, sort)
            parity += 1
    results = []
    for count, journal_count in [(100, 10), (1000, 0), (1000, 100), (5000, 1000)]:
        payload = report([row(i) for i in range(count)])
        notes = [journal(i, ['planned', f'tag-{i % 7}']) for i in range(journal_count)]
        expected = call(baseline_fn, payload, notes)
        assert call(candidate, payload, notes) == expected
        before_digest = hashlib.sha256(json.dumps([payload, notes], sort_keys=True).encode()).hexdigest()
        for fn in [baseline_fn, candidate]:
            call(fn, payload, notes)
        timings = {'baseline': [], 'optimized_current': []}
        for i in range(repeats):
            names = ['baseline', 'optimized_current'] if i % 2 == 0 else ['optimized_current', 'baseline']
            for name in names:
                fn = baseline_fn if name == 'baseline' else candidate
                start = time.perf_counter()
                value = call(fn, payload, notes)
                timings[name].append((time.perf_counter() - start) * 1000)
                assert value == expected
        assert before_digest == hashlib.sha256(json.dumps([payload, notes], sort_keys=True).encode()).hexdigest()
        timings = {name: stats(samples) for name, samples in timings.items()}
        baseline = timings['baseline']['p50_ms']; indexed = timings['optimized_current']['p50_ms']
        results.append({'trades': count, 'journals': journal_count, **timings,
                        'latency_reduction_pct': (1 - indexed / baseline) * 100,
                        'speedup_x': baseline / indexed,
                        'full_report_json_bytes': len(json.dumps(payload).encode()),
                        'page_json_bytes': len(json.dumps(expected).encode())})
    return {'scope': 'Synthetic valid string identifiers; frozen pre-optimization source versus installed full projection function, no DB/HTTP; not DB-source pagination.',
            'baseline_source_sha256_lf': digest, 'current_source_sha256': hashlib.sha256(Path(trades_page.__file__).read_bytes()).hexdigest(), 'parity_cases': parity, 'results': results}


def live_baseline(base, workspace, repeats):
    import httpx
    url = urlsplit(base)
    if url.scheme != 'http' or url.hostname not in ('localhost', '127.0.0.1') or url.username or url.password or url.path not in ('', '/') or url.query or url.fragment:
        raise ValueError('Only local HTTP API roots are allowed')
    results = []
    with httpx.Client(base_url=base, timeout=20, trust_env=False, follow_redirects=False,
                      headers={'X-Workspace-Id': workspace}) as client:
        for path in ['/health', '/api/v2/replay/sessions', '/api/v2/replay/trades?page=1&page_size=10']:
            samples = []; statuses = []; sizes = []; first = None; shape = None
            for i in range(repeats + 1):
                start = time.perf_counter(); response = client.get(path)
                elapsed = (time.perf_counter() - start) * 1000
                statuses.append(response.status_code); sizes.append(len(response.content))
                if i == 0:
                    first = elapsed
                    if response.status_code == 200:
                        body = response.json()
                        shape = {'items': len(body['items'])} if 'items' in body else body.get('pagination')
                else:
                    samples.append(elapsed)
                if response.status_code != 200:
                    break
            results.append({'path': path, 'first_request_ms': first, 'status_codes': statuses,
                            'response_bytes': sizes, 'shape': shape, **(stats(samples) if samples else {})})
    return {'scope': 'Sequential local GETs, connection reuse, small sample; no production load or browser timing.', 'results': results}


def database_settings(dsn):
    from psycopg.conninfo import conninfo_to_dict
    settings = conninfo_to_dict(dsn)
    if settings.get('host') not in ('localhost', '127.0.0.1', '::1'):
        raise ValueError('Only loopback database probes are allowed')
    if settings.get('hostaddr') and settings['hostaddr'] not in ('127.0.0.1', '::1'):
        raise ValueError('Database hostaddr must also be loopback')
    # libpq hostaddr/env/service defaults can override the host's network target.
    settings['hostaddr'] = settings.get('hostaddr') or ('::1' if settings['host'] == '::1' else '127.0.0.1')
    settings.update(autocommit=True, connect_timeout=5,
                    options=(settings.get('options', '') + ' -c default_transaction_read_only=on').strip())
    return settings


def database_probe(repeats):
    import psycopg
    settings = database_settings(os.environ['TW_V2_DATABASE_URL'])
    samples = {'new_connection': [], 'reused_connection': []}
    with psycopg.connect(**settings) as reused:
        assert reused.execute('SELECT 1').fetchone() == (1,)
        with psycopg.connect(**settings) as warmup:
            assert warmup.execute('SELECT 1').fetchone() == (1,)
        for i in range(repeats):
            order = ['new_connection', 'reused_connection'] if i % 2 == 0 else ['reused_connection', 'new_connection']
            for name in order:
                start = time.perf_counter()
                if name == 'new_connection':
                    with psycopg.connect(**settings) as connection:
                        result = connection.execute('SELECT 1').fetchone()
                else:
                    result = reused.execute('SELECT 1').fetchone()
                elapsed = (time.perf_counter() - start) * 1000
                assert result == (1,)
                samples[name].append(elapsed)
    result = {name: stats(values) for name, values in samples.items()}
    old = result['new_connection']['p50_ms']; new = result['reused_connection']['p50_ms']
    return {'scope': 'Loopback SELECT 1: connect/query/close vs one reused read-only connection. Not a pool or API migration benchmark.',
            **result, 'latency_reduction_pct': (1 - new / old) * 100, 'speedup_x': old / new}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--repeats', type=int, default=15)
    parser.add_argument('--api-base')
    parser.add_argument('--db-probe', action='store_true')
    parser.add_argument('--workspace', default='tenant-a')
    args = parser.parse_args()
    if not 5 <= args.repeats <= 30:
        parser.error('repeats must be between 5 and 30')
    data = {'measured_at_utc': datetime.now(timezone.utc).isoformat(),
            'git_head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
            'python': platform.python_version(), 'platform': platform.platform(),
            'processor': platform.processor(), 'logical_cpus': os.cpu_count(),
            'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'source_sha256': {name: hashlib.sha256((ROOT / 'trading_workspace_v2' / name).read_bytes()).hexdigest()
                              for name in ['api.py', 'store.py', 'dashboard_read_model.py', 'trades_page.py']},
            'cache_note': 'One untimed fixture warmup per candidate; live first request separate; DB first connections warmed. Source hashes identify disk, not the running API process.',
            'repeats': args.repeats, 'experiment': experiment(args.repeats)}
    if args.api_base:
        data['live_baseline'] = live_baseline(args.api_base, args.workspace, args.repeats)
    if args.db_probe:
        data['database_probe'] = database_probe(args.repeats)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, indent=2), encoding='utf-8')
    for case in data['experiment']['results']:
        print(f"{case['trades']} trades/{case['journals']} journals: {case['baseline']['p50_ms']:.2f} -> {case['optimized_current']['p50_ms']:.2f} ms; latency reduction {case['latency_reduction_pct']:.1f}%; {case['speedup_x']:.2f}x (fixture only)")
    print('Saved:', args.output)


if __name__ == '__main__':
    main()
