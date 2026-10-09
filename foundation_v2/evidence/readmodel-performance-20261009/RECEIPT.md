# Installed Trades page projection optimization — 2026-10-09

The production `build_trades_page` now indexes journal tags by the exact session/trade alias combinations instead of rescanning every journal for every trade. The index retains only ledger keys, preserves journal/tag order and deduplication, and honors both source aliases. Close timestamps/local dates, invariant filter inputs and sort values are calculated once per row/request; the existing comparator retains unknown-last and stable-tie semantics.

## Verification

```powershell
.venv\Scripts\python.exe -m pytest tests/test_trades_page.py tests/test_trades_page_performance.py tests/test_dashboard_read_model.py -q --tb=short
.venv\Scripts\python.exe scripts/api_performance_probe.py --output evidence/readmodel-performance-20261009/measurements.json --repeats 5
```

84 tests passed, including 2,016 exact full-output comparisons against frozen pre-change source across every sort/direction, 16 filters and three page selections. Comparisons include tags, facets, counts, scope, provenance and snapshot keys, with input immutability. Alias-order and bounded journal traversal tests guard the original behavior and quadratic regression. Existing HTTP auth/date-boundary test passed after its fake store gained the newly required `close()` lifecycle method.

Before the passing run, test fixture corrections were necessary: the HTTP fake store lacked `close()` after the concurrent pool-lifecycle change, and a new filter fixture mistakenly used uppercase `SELL` instead of the existing lowercase `sell` contract. Neither failed run was a demonstrated projection regression.

The original source is preserved at `scripts/fixtures/trades_page_baseline_20261009.py`, guarded by an LF-normalized SHA256. The probe compares that frozen implementation with the installed current implementation; it no longer claims the optimized implementation is an uninstalled prototype. It alternates timing order, warms both functions, checks exact output/input parity and stores five raw timing samples per case plus source hashes/runtime/machine context in `measurements.json`.

| Synthetic scope | Original median | Installed median | Projection latency reduction |
|---|---:|---:|---:|
| 100 trades / 10 journals | 2.15 ms | 1.18 ms | 45.0% |
| 1,000 trades / 0 journals | 22.14 ms | 15.88 ms | 28.3% |
| 1,000 trades / 100 journals | 75.27 ms | 16.97 ms | 77.5% |
| 5,000 trades / 1,000 journals | 2,377.97 ms | 89.29 ms | 96.2% |

These are bounded function-fixture timings under active local development, not deployed API latency, production capacity or a stable tail-latency benchmark. They include the full page projection and use the same original fixture sizes as the earlier assessment. No user DB or historical provider data was read by this benchmark.

## Remaining source costs

`api.py` still calls `build_dashboard_performance` with the full stored replay scope, then `build_trades_page` with workspace journals. Page payload size is bounded, but the financial reconstruction, lineage deduplication, exact facets/counts and sort still operate on full input. This change does **not** implement SQL-source Trades pagination. Doing that correctly requires a revision-aware persisted projection retaining the current provenance/lineage/cutoff semantics.

Dashboard strategy filtering/profit sorting still requests per-session analytics across the catalog from `web/src/DashboardSessions.jsx`. Eliminating that fanout requires a scoped session-summary query/endpoint with truthful unknown currency/profit states, rather than changing the aggregate summary function alone. That contract is left explicit for the integration owner; no unrelated dashboard rewrite or behavior weakening was performed in this slice.
