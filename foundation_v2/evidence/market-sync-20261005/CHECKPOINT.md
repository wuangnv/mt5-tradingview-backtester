# Testing history and Live broker snapshots — 05/10/2026

Scoped completion of the owner's request to implement both Testing daily updates
and Live synchronization. This does not close the full Product/WMREPLAY plans or
grant broker execution. User authorized the currently connected Exness demo after
switching from the initial FTMO choice. No new credentials, paid service, OAuth,
terminal restart, EA deployment or broker order operation.

## Behavior and data flow

- Testing and Prop **practice** share stored market history, independent of Live
  account/deals. `symbols_get` discovers 356 exact broker symbols; defaults enable
  35: 28 currency pairs, XAUUSDm/XAGUSDm, US30m/US500m/USTECm and BTCUSDm/ETHUSDm.
  Non-FX instruments are explicitly CFD, not underlying spot/futures assets.
- All 35 defaults downloaded successfully: **3,211,560 closed M1 bars** at the
  recorded acceptance snapshot. Initial request is 90 days; actual available
  ranges differ by symbol. Extra catalog assets and a date within five years can
  be requested from Data Desk; broker history availability is not guaranteed.
- Once per UTC date while the API/MT5 are running, queue downloads to the last
  closed UTC day. Restart catches up if today's attempt is missing. Explicit
  updates fetch to the current closed-minute boundary. Both overlap two days
  with existing history; later broker values replace matching timestamps.
  Gaps remain genuine gaps; no synthetic candles or interpolation.
- Isolated official MT5 SDK worker → raw broker CSV/receipt → merged CSV → existing
  DataIngestService/ArtifactStore → immutable PostgreSQL dataset → latest asset
  pointer. Unchanged CSV hash skips another version. Corrected/new bars create a
  new version; existing replay sessions remain pinned to their original dataset.
- Durable queue survives restart. Failed reads/imports retry up to three times
  with 30/60-second backoff. Exhausted failures remain visible; the next day's
  attempt or a manual retry retains the requested earlier date. Earlier-date
  requests merge into queued work or defer behind an in-flight download.
- Live separately reads account, positions, pending orders, quotes and a rolling
  90-day deal window approximately every five seconds. Previously collected deals
  persist and deduplicate by ticket for the pinned account. BUY/SELL deals and
  nontrade cashflow events stay separate; deals are not described as completed
  trades or used to invent account P/L. Account values come directly from MT5.
- Snapshot errors or age over 20 seconds mark retained data stale. UI transport
  failure preserves a visibly stale same-workspace snapshot; denied access clears
  account values. Requests do not overlap or leak the prior workspace's payload.
- Source is pinned to Exness-MT5Trial14, demo mode and a SHA256 account identity.
  Identity is checked before and after SDK reads. No raw login/password leaves
  the worker. Collector exposes no order-send/check functionality. App status and
  UI keep `execution_capability=false`; terminal algo settings are unchanged.
- PostgreSQL advisory lock gives one process worker ownership; nonowner update
  requests fail before queue writes. API workspace membership still applies.
  Ordinary create_app without a factory stays offline/unavailable.

## Verification

| Check | Result |
| --- | --- |
| History runtime offline tests | 10 PASS: overlap correction/gaps, Windows file release, idempotence, UTC daily scheduling, queue restart, date upgrades/asset isolation, retries, owner/account scope, immutable real artifact import/version/recovery, deal dedup/stale |
| API contracts without database/network | 3 PASS: default unavailable, lifespan start/stop, workspace isolation, strict request schema, 202/422/403/503 behavior |
| Isolated collector tests with fake SDK | 5 PASS under the SDK Python: true empty versus incomplete, identity recheck, metal classification, weekly boundary dedup/current bar exclusion, no execution calls |
| Actual collector/runtime | Exness demo live snapshots and all 35 successful real history imports; queue zero/errors zero; real account UI fields match API in memory |
| Root browser | 24 PASS, GET-only: 18 dark/light × 360/768/1440 × Data/Live trades/Live account axe/reflow checks; filters, latest-dataset fresh replay form, real polling, labeled network/403/unavailable fixtures, replay preservation |
| Independent review | Scoped PASS, 5 synthetic probes, 10 offline tests, 8 responsive cases with axe0/overflow0; keyboard horizontal scrolling of catalog/deals/quotes; actual local GET-only journeys and recovery |
| Build/regression | Vite build107 modules; 3 existing Live route tests PASS; Python compile and diff checks PASS. Existing Vite large-chunk advisory remains |

No test truncates the owner database. Unit imports use temporary files and an
in-memory store with the actual DataIngestService/ArtifactStore. Collector unit
tests mock the SDK; real broker-read evidence is separate. Those five tests are
explicitly skipped by foundation Python without NumPy and **passed** in the
isolated SDK environment, not silently counted as passed after a skip.

Original session `476f4b498e1a49ed9d48a75719f4d270` still has its original dataset
`dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d`,
93,810 bars, revision2, cursor500 and identical501-row visible prefix/hash.
Actual Live acceptance snapshot: demo, no open positions/pending orders, two
BUY/SELL deals, two other events and six quotes. No broker orders were created
to populate tests. Populated positions/orders and large live-deal pagination
are source-implemented but not validated with actual populated broker data.

Root reviewed representative desktop catalog/Live and mobile account screenshots.
Screenshots and account values remain in private ignored/local artifacts; only
sanitized summaries and the independent receipt are tracked. Earlier SQLite
WinError32 import failures remain preserved locally; closing the merge connection
before unlinking fixed the root cause, and the final 35 imports succeeded.

## Run and inspect

Use the existing local `TW_V2_DATABASE_URL` credential in the environment; do not
paste it into chat. From the product repository:

```powershell
.\foundation_v2\.venv\Scripts\python.exe foundation_v2/scripts/serve_exness_history.py --mt5-python .artifacts/ftmo-history-20261005/.venv/Scripts/python.exe
```

The optional argument enables read synchronization; omitting it serves imported
data without connecting to MT5. The task-local SDK environment has official
MetaTrader5 5.0.6231 and NumPy2.5.3; it is not a main/global dependency. Its FTMO
folder name is historical; the configured source is Exness. On another machine,
provide an equivalent reviewed SDK environment and configured terminal path.

UI dev server, in a separate terminal:

```powershell
Set-Location foundation_v2/web
$env:TW_V2_API_TARGET = 'http://127.0.0.1:8010'
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5180 --strictPort
```

- Data: `http://127.0.0.1:5180/?workspace=tenant-a&view=data`
- Live account: `http://127.0.0.1:5180/?workspace=tenant-a&view=live&area=live&section=trading-accounts`
- Live deals: `http://127.0.0.1:5180/?workspace=tenant-a&view=live&area=live&section=trades`
- Database: dedicated `trading_workspace_v2_exness_history`; QA8020 untouched.
- Persistent user data: `foundation_v2/.runtime/exness-market-data/`, including
  `tenant-a/market-sync/` queue, account pin, snapshots and captures. Do not delete
  these as disposable test output or reset the pin to bypass an account change.
- API8010 and UI5180 left running for owner review. No Windows scheduled task or
  background auto-start service installed; updates need the API and MT5 running.

Focused commands:

```powershell
$env:PYTHONPATH = 'foundation_v2'
.\foundation_v2\.venv\Scripts\python.exe -m unittest discover -s foundation_v2/tests -p 'test_market_sync*.py' -v
.\.artifacts\ftmo-history-20261005\.venv\Scripts\python.exe -m unittest discover -s foundation_v2/tests -p test_mt5_read_worker.py -v
Set-Location foundation_v2/web
node tests/marketSync.browser.mjs
npm run build
```

## Limits and source decision

- MT5 must be connected for fresh history/account reads. Cached replay works
  without it. A closed app does not perform daily work; it catches up next time.
  Live is five-second polling, not a per-tick streaming feed.
- Broker history may be truncated and contains unknown gaps. Current symbol specs
  are not certified historical contract specs. Raw Bid OHLC/tick volume/spread
  are retained; historical commissions/swap and variable-spread simulation are
  not certified. This slice is not full broker-parity backtesting acceptance.
- Daily immutable versions retain old data for reproducibility. Automatic
  garbage collection is not implemented; storage grows with changed versions.
  Current local folder is about1.23GiB including earlier failure captures.
- Long downtime can leave deal gaps outside the rolling90-day window. Calendar,
  live notes and tag analytics remain explicitly unavailable. No paid feed or
  futures exchange/CME entitlement has been configured.
- Dukascopy offers a personal/free historical exporter, but its current general
  terms also prohibit constructing a database. No clear archive exception was
  verified, so bulk/daily Dukascopy storage remains disabled. Sources:
  [historical exporter](https://www.dukascopy.com/swiss/english/marketwatch/historical/)
  and [official terms](https://www.dukascopy.com/swiss/english/legal-pages/terms-of-use/).
- Advanced Charts' existing Codex in-app blob-iframe limitation remains separate;
  Chrome/Edge and explicit Lightweight rollback are available as already recorded.

Evidence: `SUMMARY.json`, `root-browser-report.json`, `INDEPENDENT-REVIEW.md`, focused
test logs beside this receipt. Private attempts/reports are under
`.artifacts/market-sync-20261005/`; do not commit raw broker history or screenshots
containing account balances/deal identifiers.
