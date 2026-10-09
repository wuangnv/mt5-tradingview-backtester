# Replay runtime stalls

Root cause: step, asset switching, execution initialization and portfolio analytics still decoded full immutable histories. Actual user queue showed dashboard/overview deadlines and analytics command expiry while these operations were expensive. WebSocket transport would not remove this work.

Replay now reads verified timestamp/index windows, processes every underlying execution bar, and batches ledger timestamp lookups under one full SHA check per dataset. Cutoff, shared clock, revisions, financial results and corruption checks remain intact.

- `actual-artifact-probe.json`: actual EUR/USD (8,755,235 rows) and XAU/USD (7,966,491 rows), isolated in-memory sessions; no user DB writes. Three samples per operation. Full OHLC history reads forbidden. Diagnostic timings exclude HTTP/PG queue cost.
- `actual-browser.json`: real local GET-only dashboard, existing session chart and analytics after guarded runtime restart. Two visible bars at the session's preserved cursor 1; no future candles exposed. Analytics returned 200 in 486 ms.
- `isolated-http.json`, `isolated-browser.json`: real Axum/workers/PostgreSQL/React against disposable synthetic data. Create, automatic chart navigation, a toolbar replay step and return to dashboard passed; no API mocking.

Limitation: inactive assets crossing large time gaps still verify each 1,000-bar execution chunk. This bounds decoded memory but is not a capacity benchmark for every timeframe/gap. Existing session start/progress is unchanged; starting at the first data row intentionally has only one historical candle.
