# Bounded replay chart history

Scope: offline synthetic fixtures and chart adapter tests on Windows, 09/10/2026. No provider, broker, user database or existing dataset mutations. Chart engine/style/vendor remain unchanged.

## Change and ownership

- `ReplayService.view` now returns at most 2,000 native rows with their absolute `visible_row_start`, preserving every stored field. Current reads use indexed Parquet row groups; financial execution still uses the existing native-bar evaluator. Historical checkpoint reconstruction is unchanged.
- `ReplayService.chart_window` validates workspace/session, active dataset, immutable hash, canonical cursor and countBack (1–2,000). Aggregation supports native/intraday and UTC day/Monday week/calendar month boundaries. It completes the earliest returned aggregate bucket across row-group boundaries and preserves unknown volume semantics.
- The reader skips decoding row groups newer than a backfill request using timestamp statistics. It verifies full-file SHA-256 on every request, including corruption outside the selected range, and checks identity after decoding. No weakened checksum cache was introduced.
- Existing view accepts mutually exclusive `cutoff_timestamp` for date/native-chart selection. Timestamp-only lookup chooses the first native bar at or after the requested UTC time, rejects future time and never mutates canonical state.
- Browser reader is per chart instance, scope/hash/cursor/cutoff/resolution aware; at most eight cached windows and eight pending requests, independent candle copies, abort/reset/dispose. Chart adapter caches local aggregation once per resolution/update, deduplicates remote subscription reads and fetches only changed buckets. Rewinds invalidate callbacks. Jumps larger than the window reset chart data.
- Opt-in `chart-history` timings wrap actual deduplicated requests/validation only. Unknown bytes remain absent; no URL/session/hash/content enters metric records.

Root integrates the public HTTP route and ReplayWorkspace props/navigation. This receipt alone does not establish public Axum or actual vendor/browser journey acceptance.

## Verification

Commands from product root:

```powershell
.\foundation_v2\.venv\Scripts\python.exe -m pytest foundation_v2/tests/test_replay_chart_window.py foundation_v2/tests/test_replay_portfolio.py foundation_v2/tests/test_replay_intervals.py foundation_v2/tests/test_replay_protection.py foundation_v2/tests/test_replay_analytics.py foundation_v2/tests/test_replay_tick_service.py foundation_v2/tests/test_replay_margin_v2_service.py -q
```

**117 passed**; two existing dependency deprecation warnings. Cases cover exact full-history aggregation oracle, partial/calendar buckets, unknown volume, old backfill, forbidden future/scope/hash/budget, row-group pruning, full checksum corruption and single/multiasset/tick/margin/historical execution regressions. The shared in-memory FakeStore gained a no-op `close()` matching the existing production lifespan contract.

From `foundation_v2/web`:

```powershell
node --test tests/advancedChart.test.mjs tests/replayChartWindow.test.mjs
```

**13 passed**: legacy aggregation/cutoff, scoped remote windows, cache eviction/dedup, clone isolation, stale response/dispose, monthly history outside native window, subscription race and metric privacy.

## Measured offline read cost

[Raw samples and fixture/machine metadata](chart-window-benchmark.json). Each candidate has 30 samples, alternated order, warm filesystem; both perform full SHA verification. Frozen native rows, window OHLCV exactly equal to the tail of the original full decode. The baseline decodes the full file, then selects the prefix/tail; candidate decodes only intersecting groups.

| Native rows | Median full decode | Median indexed window | Sample p95 before/after | Measured read latency reduction |
|---:|---:|---:|---:|---:|
| 20,000 | 81.82 ms | 13.25 ms | 89.50 / 14.27 ms | 83.80% |
| 100,000 | 422.52 ms | 20.12 ms | 495.41 / 23.76 ms | 95.24% |
| 1,000,000 | 4,409.96 ms | 77.07 ms | 5,317.08 / 91.70 ms | 98.25% |

These percentages describe this immutable-artifact read fixture only, **not HTTP latency, chart frame time or whole-app speed**. Payload rows change from 18k/90k/900k native prefix to 2k; no fabricated future total download estimate is involved.

Reproduce:

```powershell
.\foundation_v2\.venv\Scripts\python.exe foundation_v2/scripts/benchmark_replay_chart_window.py --samples 30 --output foundation_v2/.runtime/chart-window-benchmark.json
```

## Limits and remaining acceptance

- Full SHA remains proportional to file bytes; immutable identity-cache promotion would require a separate security/integrity contract. Python buffers at most 4,096 decoded native row dictionaries, but Arrow may hold the checkpoint and a history row group; extremely large external row groups still cost memory.
- A coarse monthly/year-spanning request may scan many row groups to complete 2,000 aggregate candles. CPU is not constant in countBack; output/Python dictionary buffering are bounded. Pre-aggregated immutable levels are a future workload-driven option.
- Interval advancement and historical financial checkpoints deliberately retain the existing full-data/oracle path where it defines behavior. Financial execution and full ledger carried in replay payload are separate performance work; this chart change does not claim to eliminate them.
- Root must verify native-chart pan/backfill, timeframe switch, replay advance/rewind, historical GoTo and multiasset switching through public Axum on a representative immutable fixture. Lightweight fallback and custom annotations consume the bounded local native window; retained native chart drawings remain vendor-owned. Older timestamp navigation is available through the new view cutoff parameter.
