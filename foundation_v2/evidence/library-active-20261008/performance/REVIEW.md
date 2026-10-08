# Dukascopy worker performance review

Scope: worker optimization in `efe87fe609fdb2874b8a4a491722c5207971b565`, against original source in `fa52a806bce492f1cb46626cb6a6a894f94d5971`. No real download/import/catalog changes, broker actions, public probes, or runtime restart were performed by this reviewer. The owner's existing EUR/USD download was left running unchanged.

## Findings and change

The original worker fetched one UTC-day bucket at a time, waited 1 second after every uncached day, awaited a file write per candle, and emitted a journal event for every body chunk. These are application bottlenecks independent of connection bandwidth.

The optimized worker allows 3 concurrent buckets, then commits CSV in date order and waits 1 second between batches. Each successful bucket is validated and receives its atomic hash receipt before the batch is committed. CSV writes are batched per day. Byte-progress events are limited to one per 250 ms, while every committed day and completion are forced events. A failed batch drains all in-flight promises and launches no later batch; 429 takes precedence over competing transient failures, retaining the existing cooldown contract.

[Upstream batching guidance](https://www.dukascopy-node.app/custom-batching) documents a default of 10 requests per batch with a 1,000 ms inter-batch pause; long ranges should use smaller batches. The pinned installed `dukascopy-node` 1.50.0 source also confirms those defaults. Our batch of 3 is deliberately conservative. Upstream retry options are bypassed by `fetcherFn`, so changing `retryCount` alone would not make this project's custom fetcher retry. Automatic retries were not added.

For the observed 8,558-day EUR/USD range, old inter-day sleeps alone total 8,557 seconds; new batch sleeps alone total 2,852 seconds. Neither figure predicts overall completion time: request latency, provider limits, disk work, decoding and final ingestion also contribute.

## Reproduce and measured result

From the product repository root, with the locked data-worker dependencies installed:

```powershell
node foundation_v2/evidence/library-active-20261008/performance/benchmark.mjs
node --test foundation_v2/data_worker/tests/worker.test.mjs
foundation_v2/.venv/Scripts/python.exe -m pytest foundation_v2/tests/test_dukascopy_full_downloads.py -q
```

The benchmark reads both exact source revisions with `git show`, binds them to the installed pinned decoder, uses generated responses, and removes only its own verified OS-temp directory. It makes zero network requests. It compares 30 days with 1,440 original candles/day, a simulated 15 ms response latency and a shortened 25 ms pause to keep the local experiment bounded. It also repeats each download against its completed cache with network requests forbidden. The benchmark checks exact CSV hash, byte count, request count and maximum concurrency; it does not assert timing thresholds.

Original measurement is retained in `results.json`:

| Fixture path | Original | Optimized |
| --- | ---: | ---: |
| Cold | 4,295 ms | 744 ms |
| All buckets cached | 2,573 ms | 130 ms |

A rerun of the saved script at 2026-10-08 06:20:31 UTC on Node v24.19.0 measured 4,500/2,566 ms original versus 726/102 ms optimized (cold/cache). Both comparisons produced the same CSV SHA256 `3bcf5003538311a798df81d59cd71e65b5ba11ae6b291e2a8280d47c7b2a19c5`, 523,440 response bytes and 30 requests. Maximum in-flight requests changed from 1 to 3. These timings demonstrate local fixture improvement, not measured Internet throughput or a guaranteed live speedup.

Worker tests: **10/10 PASS**. Existing source timestamp, invalid-data, cooldown, tamper, long-range and interrupted-cache tests remain. New cases prove bounded concurrency with out-of-order network completion but ordered CSV, cache reuse, failed-batch drainage and durable successful receipts, no later scheduling after failure, 429 priority and exact byte counters under throttling.

## Read-only backend pause review

Reviewed the root agent's uncommitted pause changes in `dukascopy_downloads.py`, `api.py` and `test_dukascopy_full_downloads.py`. Focused suite: **16 tests + 2 subtests PASS**. This review is a source/test snapshot, not live runtime acceptance of the new pause endpoint.

Normal pause/publication ordering is sound: interruption state is journaled under the same lock as final publication; stream processing ignores events after pausing; parsing/ingestion checks the journal; completed/cancelled jobs are not resurrected; remote-owner journal writes require the advisory job lock. Final processing preserves saved counters and converts `pausing` to `paused` after the child exits.

Additional tests recommended to the root owner: pause during a deliberately blocked long parse, and rollback of newly created artifacts when publication is rejected because of pause. Existing equivalent tests target cancellation. Cleanup robustness remains a concern shared with the pre-existing code: a failed `process.wait(timeout=5)` can prevent cleanup, and new final `_read`/`_save` errors could prevent `active=None`. Clearing lifecycle fields in a nested `finally` would harden these exceptional paths; no normal-path failure was observed.

## Limits

An already-running Node process retains the old implementation; a new worker created on a later download/resume loads the optimized file. No running process was replaced. Cache integrity and publication protections remain; total download bytes and normalized storage bytes cannot be known exactly from the instrument catalog. A future independent Internet benchmark should be short and scheduled when the user's download is idle, retaining 429/cooldown behavior rather than increasing concurrency blindly.
