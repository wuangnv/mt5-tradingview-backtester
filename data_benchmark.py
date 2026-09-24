"""Small reproducible performance harness for U2 data preview workloads."""

import platform
import time
import tracemalloc

from data_import import preview_csv


def benchmark_preview(path, source, instrument, timeframe_seconds, workload_label):
    timings = []
    peak_bytes = []
    results = []
    for cache_state in ("cold", "warm"):
        tracemalloc.start()
        started = time.perf_counter()
        result = preview_csv(path, source, instrument, timeframe_seconds)
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        timings.append(elapsed_ms)
        peak_bytes.append(peak)
        results.append(result)

    if results[0]["dataset_id"] != results[1]["dataset_id"]:
        raise RuntimeError("benchmark changed dataset identity between cold and warm runs")
    return {
        "benchmark_version": "u2-data-preview-benchmark-v1",
        "hardware": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "processor": platform.processor(),
            "python": platform.python_version(),
        },
        "workload": {
            "label": str(workload_label),
            "rows": results[0]["row_count"],
            "raw_sha256": results[0]["raw_sha256"],
            "dataset_id": results[0]["dataset_id"],
        },
        "cold": {"elapsed_ms": round(timings[0], 3), "python_peak_bytes": peak_bytes[0]},
        "warm": {"elapsed_ms": round(timings[1], 3), "python_peak_bytes": peak_bytes[1]},
        "semantic_identity_preserved": True,
    }

