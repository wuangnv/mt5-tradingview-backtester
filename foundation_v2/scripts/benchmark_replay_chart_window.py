"""Offline immutable Parquet fixture; no database, provider or broker is accessed."""
from argparse import ArgumentParser
import json
from pathlib import Path
import platform
import math
from statistics import median
import sys
from tempfile import TemporaryDirectory
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trading_workspace_v2.artifacts import ArtifactStore


def native_rows(count):
    for n in range(count):
        price = 1 + n / 1000000
        yield {'timestamp': 1704067200 + n * 60, 'open': price, 'high': price + .02,
               'low': price - .01, 'close': price + .01, 'volume': n % 10}


def main():
    parser = ArgumentParser()
    parser.add_argument('--samples', type=int, default=30)
    parser.add_argument('--sizes', type=int, nargs='+', default=[20000, 100000, 1000000])
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = {'scope': 'Offline Python native replay view read, warm filesystem, full SHA for both; not HTTP or whole-app speed',
              'python': platform.python_version(), 'platform': platform.platform(), 'samples_per_candidate': args.samples, 'fixtures': []}
    with TemporaryDirectory(prefix='replay-window-benchmark-') as root:
        store = ArtifactStore(root)
        for count in args.sizes:
            path, digest = store.write_dataset_iter('fixture', str(count), native_rows(count))
            cursor = int(count * .9) - 1
            start = max(0, cursor - 1999)
            def baseline():
                rows = store.read_dataset(path, digest)
                return rows[:cursor + 1][-2000:]
            def candidate():
                return store.read_dataset_indices(path, digest, start_index=start, end_index=cursor + 1)
            assert baseline() == candidate()
            samples = {'full_decode_prefix_ms': [], 'indexed_window_ms': []}
            for index in range(args.samples):
                choices = [('full_decode_prefix_ms', baseline), ('indexed_window_ms', candidate)]
                if index % 2:
                    choices.reverse()
                for key, call in choices:
                    then = perf_counter(); output = call(); elapsed = (perf_counter() - then) * 1000
                    assert len(output) == 2000
                    samples[key].append(elapsed)
            before, after = median(samples['full_decode_prefix_ms']), median(samples['indexed_window_ms'])
            item = {'native_rows': count, 'canonical_cursor': cursor, 'old_visible_rows': cursor + 1, 'new_visible_rows': 2000,
                    'correctness': 'last 2000 native rows exact, every stored column including volume',
                    'artifact_bytes': (Path(root) / path).stat().st_size, 'samples': samples,
                    'median_before_ms': before, 'median_after_ms': after,
                    'sample_p95_before_ms': sorted(samples['full_decode_prefix_ms'])[math.ceil(args.samples * .95) - 1],
                    'sample_p95_after_ms': sorted(samples['indexed_window_ms'])[math.ceil(args.samples * .95) - 1],
                    'latency_reduction_pct': (before - after) / before * 100}
            result['fixtures'].append(item)
            print(json.dumps({key: value for key, value in item.items() if key != 'samples'}), flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
