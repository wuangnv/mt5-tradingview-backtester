# Historical Bid/Ask tick replay — 05/10/2026

Owner-authorized scope: EURUSDm/XAUUSDm seven-day sample, then90days after
measurement; local tick fills and daily catch-up. Existing M1 Testing catalog
and read-only Live snapshots continue separately. This is not whole-product,
broker-execution or complete Prop risk acceptance.

## Actual history and storage

Exness-MT5Trial14 demo, official MetaTrader5 SDK5.0.6231,
`copy_ticks_range(COPY_TICKS_ALL)`. Account/server/demo identity checked before
and after reads; no order-send/check, login, EA deployment or terminal settings
change. Historical FTMO folder naming does not identify the actual source.

| Capture | EURUSDm | XAUUSDm |
| --- | ---: | ---: |
| Seven-day ticks | 261,837 | 1,515,798 |
| Seven-day CSV.gz bytes | 1,901,422 | 15,175,925 |
| Seven-day elapsed seconds | 5.88 | 24.01 |
| Latest 90-day ticks | 2,464,842 | 19,014,116 |
| Latest Parquet object bytes | 21,803,187 | 260,449,342 |
| Days with ticks | 77 | 76 |
| Broker returned empty | 13 | 14 |

Requested interval `[2026-07-07 00:00, 2026-10-05 00:00)` UTC. This does not
certify complete history; `quality=review`,
`coverage=broker_returned_unverified`. No synthetic ticks fill gaps. First
EURUSD returned tick July7, gold July8. Exact sanitized metrics/snapshot IDs
are in `metrics.json` beside this receipt.

Current retained tick objects/manifests:286,942,007bytes; original captures:
208,643,142bytes. Combined **495,585,149bytes (472.6MiB)**, additional to M1.
Latest Parquet objects alone269.2MiB. Changed daily versions grow storage;
automatic garbage collection is not implemented. Preserve raw captures and
pinned objects as persistent user data.

## Data/state flow and decisions

`MT5 read-only day capture -> checked CSV.gz -> immutable Parquet Zstd day
objects -> tenant-scoped hashed manifest -> pinned replay -> local ledger ->
chart/Analytics`.

The chart displays M1 and aggregated larger candles. One replay step consumes
the next minute's ticks, not per-tick chart navigation. Duplicate/same-ms quotes
retain source order/sequence. Reads materialize matching row groups and verify
the entire partition checksum.

- BUY enters Ask, SELL enters Bid at the first tick of the next candle. Long
  liquidation uses Bid, short uses Ask; first SL/TP touch wins, gap fills use the
  observed price. Static spread must0 because actual spread is embedded.
- Fees/slippage/financing/conversion remain explicit frozen assumptions. Tick
  history does not establish historical broker fees or historical contract specs.
- Missing/invalid ticks stop before record mutation. Selected tick execution
  cannot silently become OHLC. Sessions pin both M1 dataset and tick snapshot;
  latest updates leave old sessions unchanged. History/branch restores old quotes.
- Data Desk “Luyện tick” starts at the first covered M1 candle. Both native chart
  order panel and Trade draft use scoped abortable tick availability, explicit
  simulation leverage, actual cutoff Bid/Ask, and fail-closed initialization.
- Prop attempts can declare `replay-tick-v1`; binding checks data/cost/engine
  and branch tick pins. Equity exposure within a minute remains `insufficient`
  because evaluation consumes close checkpoints. UI states this limitation.
- OHLC research parity rejects tick snapshots until a tick oracle exists;
  no implied Nautilus/strategy parity certification.

## Run/update

Product repo, existing local database environment:

```powershell
.\foundation_v2\.venv\Scripts\python.exe foundation_v2/scripts/serve_exness_history.py --mt5-python .artifacts/ftmo-history-20261005/.venv/Scripts/python.exe --ticks
```

`--ticks`: closed UTC days for EURUSDm/XAUUSDm, two-day overlap, durable failed-day
debt and same PostgreSQL advisory owner as M1/Live. Downtime catches up from
last requested end; failure retries after60seconds; empty refresh cannot destroy
retained ticks. API and MT5 must run for updates; cached replay works offline.
No Windows auto-start service. Without SDK argument serves saved data only;
without `--ticks` M1/Live still work. Live is five-second read polling, separate
from historical tick snapshots, `execution_capability=false`.

Persistent root: `foundation_v2/.runtime/exness-market-data/tenant-a/` with
`ticks/`, `market-sync/tick-captures/`, `tick-backfill-progress.json`,
`history-state.json` and account pin. Do not delete/reset as test cleanup.

## Verification

- Focused offline backend:154tests +15subtests PASS (storage/core/service, old
  v1/v2/margin, Analytics/protection/contracts/Prop binding). Temporary artifact
  roots/in-memory stores; no owner-database truncation.
- Market runtime/API:16tests PASS including once/restart, downtime/debt recovery,
  disconnect/stop, account/owner/workspace isolation.
- Collector:8fake-SDK tests PASS in isolated SDK Python: same-ms repeats/order,
  half-open end, empty vs error, one-day bound, account drift before write. Main
  Python lacks NumPy; skipped runs are not counted as passes.
- Frontend:11focused tests PASS; Vite108-module build PASS, existing large-chunk
  advisory retained.
- Actual API/new named QA sessions: EURUSD BUY first Ask; gold SELL first Bid and
  first SL touch/sequence/net P/L against actual immutable ticks; cutoff quotes
  and historical restoration. Oracle fees/slippage/financing0, USD conversion1
  explicitly modeled, not broker fees. EURUSD sampled minute had no SL/TP touch;
  it was not counted as protective-fill proof.
- Original replay `476f4b498e1a49ed9d48a75719f4d270`: identical full GET hash,
  revision2/cursor500/original dataset before/after verification.
- Actual Chromium: Data Desk -> Luyện tick -> fresh replay -> native tick init
  -> simulated BUY -> step -> reload -> Analytics:5checks PASS/no page errors.
  Attempt1 had wrong `main` Analytics selector; corrected to actual test ID.
  Attempt2 hit stopped transient servers; both failed reports preserved locally.
- Owner API one-minute steps about1.08seconds for29EURUSD/402gold ticks. Separate
  real flat-minute trace benchmark0.43/0.45seconds including checksum; Python
  allocation peak4.06MiB excluding Arrow native, whole process working set
  approximately44->58->59MiB. Small sample, not sustained/maximum-load proof.

Detailed private reports/scripts/screenshots: `.artifacts/tick-20261005/`.
Independent [review](INDEPENDENT-REVIEW.md): scoped PASS,30responsive dark/light
cases at360/768/1440px, axe0/reflow0; vendor iframe a11y excluded. Reviewer used
GET-only actual journeys and labeled fixtures, separate from root fill oracles.
After review, root archived the five task-owned QA sessions, retaining their
data/ledgers and keeping them out of default session selection. The uninitialized
review session was unchanged during review; its later archive is intentional.
No broker trade populated a test. Advanced Charts
vendor untouched; Chromium works while Codex blob iframe limitation remains.
