"""Owned PostgreSQL correctness + alternating synthetic projection benchmarks."""
from __future__ import annotations
import argparse
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import platform
import socket
import statistics
import subprocess
import sys
import tempfile
import time

V2 = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(V2), str(V2 / 'tests'), str(V2.parent)]
from trading_workspace_v2.store import PostgresStore
from trading_workspace_v2.replay_read_projection import ReplayReadProjectionService, BoundedProjectionCache
SOURCE_SHA256 = hashlib.sha256((V2 / 'trading_workspace_v2/replay_read_projection.py').read_bytes()).hexdigest()
from trading_workspace_v2.trades_page import prepare_trades_projection, slice_trades_projection
from trading_workspace_v2.dashboard_read_model import build_dashboard_performance
from test_trades_page import row, report, journal
from test_replay_analytics import two_trade_record, closed_trade_record

PG = Path('D:/ANNAM/TradingWorkspace/planning/mt5-tradingview-backtester/research/foundation-validation/20260921T115933Z-315e8ddd/pg-dist/pgsql/bin')


def distribution(samples):
    return {'sample_count': len(samples), 'samples_ms': samples, 'median_ms': statistics.median(samples),
            'sample_p95_ms': sorted(samples)[math.ceil(.95 * len(samples)) - 1]}


def postgres_fixture():
    with tempfile.TemporaryDirectory(prefix='tw-replay-projection-') as directory:
        work = Path(directory); data = work / 'pg'
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
        def run(name, *args):
            subprocess.run([str(PG / (name + '.exe')), *args], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=45, creationflags=subprocess.CREATE_NO_WINDOW)
        run('initdb', '-D', str(data), '-U', 'projection_fixture', '-A', 'trust', '--locale=C', '--encoding=UTF8')
        run('pg_ctl', '-D', str(data), '-l', str(work / 'pg.log'), '-o', f'-h 127.0.0.1 -p {port} -c shared_buffers=32MB', '-w', 'start')
        store = PostgresStore(f'host=127.0.0.1 port={port} user=projection_fixture dbname=postgres connect_timeout=5')
        try:
            store.initialize()
            store.ensure_workspace('tenant-a'); store.ensure_workspace('tenant-b')
            # SQL-only dataset identity fixture; no artifact is read in this service.
            with store.connect() as conn:
                conn.execute("INSERT INTO datasets(workspace_id,dataset_id,manifest_json,artifact_sha256,created_at_utc) VALUES(%s,%s,'{}'::jsonb,%s,%s)",
                             ('tenant-a', 'dataset-fixture', 'd' * 64, '2026-10-10T00:00:00Z'))
            source = two_trade_record()
            created = store.create_record('tenant-a', 'replay', source['payload'])
            source['payload']['execution']['replay_session_id'] = created['record_id']
            for event in source['payload']['execution']['ledger']:
                event['replay_session_id'] = created['record_id']
            created = store.update_record('tenant-a', 'replay', created['record_id'], 1, source['payload'])
            trade = build_dashboard_performance([created], 'tenant-a', include_ledger=True)['ledger'][0]['trade_id']
            local = store.create_record('tenant-a', 'journal', {'source': {'replay_session_id': created['record_id'], 'id': trade}, 'tags': ['local']})
            foreign = store.create_record('tenant-a', 'journal', {'source': {'session_id': 'different', 'trade_id': 'other'}, 'tags': ['foreign']})
            store.create_record('tenant-b', 'journal', local['payload'])
            assert [r['record_id'] for r in store.list_journal_records('tenant-a', session_ids=[created['record_id']])] == [local['record_id']]
            assert [r['record_id'] for r in store.list_journal_records('tenant-a', trade_ids=[trade])] == [local['record_id']]
            assert store.list_journal_records('tenant-a', session_ids=[]) == []
            assert store.list_journal_records('tenant-a', session_ids=['different'], trade_ids=[trade]) == []
            captured = store.list_record_heads('tenant-a', 'replay')
            newer_payload = {**created['payload'], 'name': 'newer'}
            newer = store.update_record('tenant-a', 'replay', created['record_id'], created['revision'], newer_payload)
            old = store.records_at_heads('tenant-a', 'replay', captured)[0]
            assert old['revision'] == created['revision'] and old['payload'] == created['payload']
            service = ReplayReadProjectionService(store)
            current = store.list_records('tenant-a', 'replay')
            journals = store.list_records('tenant-a', 'journal')
            full = build_dashboard_performance(current, 'tenant-a', include_ledger=True)
            # Baseline oracle includes the full journal revision snapshot.
            from trading_workspace_v2.trades_page import build_trades_page
            for page in (1, 2, 999):
                options = dict(page=page, page_size=1, sort_key='close_time_utc', sort_direction='desc')
                assert service.trades('tenant-a', **options) == build_trades_page(full, journals, **options)
            assert service.trades('tenant-b', page=1)['pagination']['filtered_count'] == 0
            assert service.trades('tenant-a')['sources'][0]['revision'] == newer['revision']
            return {'status': 'passed', 'cases': ['journal aliases/session+trade intersection/empty selection', 'workspace isolation',
                    'captured immutable revision survives concurrent head advance', 'current finance/page/provenance parity',
                    'foreign journal revision identity preserved'], 'cache': service.cache.statistics(),
                    'scope': 'owned disposable loopback PostgreSQL initialized here; no inherited DSN/user data/provider'}
        finally:
            store.close()
            run('pg_ctl', '-D', str(data), '-m', 'fast', '-w', 'stop')


def benchmark(repeats):
    # Installed indexed source before materialized query paging, kept verbatim.
    frozen = V2 / 'scripts/fixtures/trades_page_indexed_20261010.py'
    source = frozen.read_text(encoding='utf-8')
    namespace = {'__name__': 'trading_workspace_v2._indexed_projection_baseline', '__package__': 'trading_workspace_v2'}
    exec(compile(source, str(frozen), 'exec'), namespace)
    baseline = namespace['build_trades_page']
    results = []
    for count, journal_count in [(100, 10), (10000, 1000), (100000, 10000)]:
        payload = report([row(i) for i in range(count)])
        journals = [journal(i, ['planned', f'tag-{i % 7}']) for i in range(journal_count)]
        options = dict(sort_key='close_time_utc', sort_direction='desc', extra_filters='{}')
        started = time.perf_counter()
        prepared = prepare_trades_projection(payload, journals, **options)
        prepare_ms = (time.perf_counter() - started) * 1000
        cache = BoundedProjectionCache()
        start = time.perf_counter(); retained = cache.get_or_build('fixed-revision-and-query', lambda: prepared)
        admission_ms = (time.perf_counter() - start) * 1000
        timings = {'baseline_rebuild': [], 'warm_ordered_slice': []}
        for iteration in range(repeats):
            page = iteration % max(1, math.ceil(count / 10)) + 1
            expected = baseline(payload, journals, page=page, page_size=10, **options)
            names = list(timings) if iteration % 2 == 0 else list(reversed(timings))
            for name in names:
                started = time.perf_counter()
                if name == 'baseline_rebuild':
                    value = baseline(payload, journals, page=page, page_size=10, **options)
                else:
                    # Match service response ownership: copy only visible page.
                    value = deepcopy(slice_trades_projection(retained, page=page, page_size=10))
                timings[name].append((time.perf_counter() - started) * 1000)
                assert value == expected
        distributions = {name: distribution(values) for name, values in timings.items()}
        before = distributions['baseline_rebuild']['median_ms']; after = distributions['warm_ordered_slice']['median_ms']
        results.append({'trades': count, 'journals': journal_count, 'cold_ordered_prepare_ms': prepare_ms,
                        'memory_admission_ms': admission_ms, **distributions,
                        'warm_slice_latency_reduction_pct': (before - after) / before * 100,
                        'full_ledger_json_bytes': len(json.dumps(payload).encode()),
                        'page_json_bytes': len(json.dumps(expected).encode()), 'cache': cache.statistics(),
                        'default_cache_eligible': cache.statistics()['entries'] > 0})
    return {'scope': 'synthetic ordered-table phase only; excludes DB/HTTP and full finance cold evaluation; retained object slicing is measured even where default cache rejects large projection, so not claimed service warm speed at that size',
            'baseline_sha256_lf': hashlib.sha256(source.encode()).hexdigest(), 'results': results}


def financial_fixture(count):
    source = closed_trade_record(); execution = source['payload']['execution']
    templates = deepcopy(execution['ledger']); events = []
    for index in range(count):
        for template in templates:
            event = deepcopy(template)
            event.update(sequence=len(events) + 1, cursor_index=index + 1,
                         virtual_time_utc=template['virtual_time_utc'] + index * 120,
                         balance=str(float(template['balance']) + 17 * index),
                         equity=str(float(template['equity']) + 17 * index))
            if 'operation_id' in event['details']:
                event['details']['operation_id'] = f'open-{index}'
            if 'position_id' in event['details']:
                event['details']['position_id'] = f'position-{index}'
            events.append(event)
    execution.update(ledger=events, event_sequence=len(events), cursor_index=count,
                     balance=str(100000 + 17 * count), equity=str(100000 + 17 * count))
    source['payload']['cursor_index'] = count
    return source


def finance_benchmark(repeats, counts=(10000, 100000)):
    from trading_workspace_v2.trades_page import build_trades_page
    results = []
    for count in counts:
        source = financial_fixture(count)
        class FrozenStore:
            reads = 0
            def list_record_heads(self, workspace, kind):
                return [{'record_id': source['record_id'], 'revision': source['revision'], 'payload': {}}] if kind == 'replay' else []
            def records_at_heads(self, workspace, kind, heads, **kwargs):
                self.reads += 1
                return [source] if kind == 'replay' else []
            def list_replay_activity(self, workspace):
                return []
        store = FrozenStore(); service = ReplayReadProjectionService(store)
        start = time.perf_counter(); first = service.trades('tenant-a', page=1)
        cold = (time.perf_counter() - start) * 1000
        assert first['pagination']['filtered_count'] == count
        expected_report = build_dashboard_performance([source], 'tenant-a', include_ledger=True)
        samples = {'baseline_full_finance_and_page': [], 'candidate_service': []}
        # Oversize snapshots intentionally bypass cache. Rebuilding a 300k
        # execution-event oracle 60 times gives no useful warm-cache evidence.
        reads_before = store.reads
        service.trades('tenant-a', page=2)
        admitted = store.reads == reads_before
        repeated_page_samples = []
        for _ in range(repeats):
            start = time.perf_counter(); same_page = service.trades('tenant-a', page=2)
            repeated_page_samples.append((time.perf_counter() - start) * 1000)
        assert same_page == build_trades_page(expected_report, [], page=2, page_size=10,
                                              sort_key='close_time_utc', sort_direction='desc')
        sample_count = repeats if admitted else min(3, repeats)
        for iteration in range(sample_count):
            page = iteration + 1 if admitted else iteration + 3
            expected = build_trades_page(expected_report, [], page=page, page_size=10,
                         sort_key='close_time_utc', sort_direction='desc')
            names = list(samples) if iteration % 2 == 0 else list(reversed(samples))
            for name in names:
                start = time.perf_counter()
                if name == 'candidate_service':
                    value = service.trades('tenant-a', page=page)
                else:
                    report = build_dashboard_performance([source], 'tenant-a', include_ledger=True)
                    value = build_trades_page(report, [], page=page, page_size=10,
                             sort_key='close_time_utc', sort_direction='desc')
                samples[name].append((time.perf_counter() - start) * 1000)
                assert value == expected
        distributions = {name: distribution(values) for name, values in samples.items()}
        before = distributions['baseline_full_finance_and_page']['median_ms']
        after = distributions['candidate_service']['median_ms']
        results.append({'trades': count, 'execution_events': 3 * count,
                        'first_candidate_cold_ms': cold, 'default_warm_cache_eligible': admitted,
                        'candidate_phase': 'warm ordered projection' if admitted else 'new uncached page; full oracle cold',
                        'repeat_same_page': distribution(repeated_page_samples),
                        **distributions, 'latency_reduction_pct': (before - after) / before * 100,
                        'cache': service.cache.statistics(), 'payload_reads': store.reads})
    return {'scope': 'full valid synthetic replay financial oracle + page service; memory store, no DB/HTTP, same immutable source and output, alternating order; large bypass diagnostic has only 3 samples', 'results': results}


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--repeats', type=int, default=30)
    parser.add_argument('--finance-only', action='store_true', help='Rerun finance/cache/PG checks without repeating the unchanged ordered-table phase')
    parser.add_argument('--finance-counts', type=int, nargs='+', default=[10000, 100000])
    args = parser.parse_args()
    if not 1 <= args.repeats <= 100:
        raise ValueError('repeats must be bounded')
    if any(count not in (100, 10000, 100000) for count in args.finance_counts):
        raise ValueError('finance counts must use the representative fixture sizes')
    value = {'machine': platform.platform(), 'python': sys.version, 'candidate_source_sha256': SOURCE_SHA256, 'postgres': postgres_fixture(),
             'projection_phase': None if args.finance_only else benchmark(args.repeats), 'finance_service': finance_benchmark(args.repeats, args.finance_counts)}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(value, indent=2), encoding='utf-8')
    print(json.dumps({'postgres': value['postgres'], 'benchmarks': [{k: r[k] for k in ('trades', 'cold_ordered_prepare_ms', 'warm_slice_latency_reduction_pct', 'default_cache_eligible')} for r in (value['projection_phase']['results'] if value['projection_phase'] else [])]}))

if __name__ == '__main__':
    main()
