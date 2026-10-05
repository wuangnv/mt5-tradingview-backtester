# Exness history and chart navigation — 05/10/2026

Owner authorized EURUSD M1 for three months, then explicitly switched FTMO to the
currently logged-in Exness demo. This receipt covers imported market history and
chart navigation only; it does not accept broker execution or the entire product.

## Data and provenance

- Source: Exness-MT5Trial14 / MT5, connected demo. Explicit mapping EURUSD → EURUSDm.
- Official MetaQuotes SDK 5.0.6231 in task-local `.artifacts/ftmo-history-20261005/.venv`.
  Wheel SHA256: `b94b1f8f52087ae36dfac5f352a96f5d04fe308704d9515f82cf5d1470bc31d4`.
  No main dependency or global configuration change.
- Requested UTC: 2026-07-05 00:00 → 2026-10-05 04:27. Actual closed bars:
  2026-07-05 21:05 → 2026-10-05 04:26; **93,810 M1 rows**.
- Weekly SDK reads, boundary timestamp deduplication, forming minute excluded.
  Bid OHLC and tick_volume; full raw spread/real_volume preserved separately.
- Raw broker CSV SHA256: `31051b9e169e8e3b4331e6ee651355af49aa478b4f3b18ffa206f6da734c63ba`.
- Normalized CSV SHA256: `9412b633ae597ba0ee948e0d552f30c63a1f5fd3df2953dab2cde1ab74802356`.
- Parquet SHA256: `e1d208a92b9c418d78b8f8cad86dec4c888fe19eae1536100a79f2b005e9b6a2`.
- Reused preview_csv → DataIngestService → ArtifactStore → ReplayService.
  Separate database `trading_workspace_v2_exness_history`; existing QA DB untouched.
  Dataset `dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d`.
  Session `476f4b498e1a49ed9d48a75719f4d270`, cursor500 (501 visible prefix rows).
- Persistent user files: `foundation_v2/.runtime/exness-market-data/`, including
  `broker-raw/exness-20261005/`. These are user data, not disposable QA artifacts.
  Raw market data is local and is not committed or redistributed.

Quality remains **review**: duplicates0, unordered0, overlapping0, **82 gaps with
unknown classification**. No interpolation. Some gaps can correspond to market
closures; that classification has not been verified. UI now preserves disposition,
gap count, actual broker source and timeframe metadata instead of transport ID.

Current symbol snapshot: digits5, tick0.00001, contract100000, lot min/step0.01,
max200, EUR/USD, account currencyUSD. Snapshot effective from capture time;
historical contract changes are unverified. Historical commission/swap are absent;
per-bar spreads are retained raw but not consumed by the fixed-spread simulator.
No execution/account was initialized: Balance/Equity/P&L and quotes remain N/A.
No broker order was sent. Terminal algo trading is enabled; the read scripts do
not disable that setting and only use history/metadata APIs.

## Navigation and verification

Native Sessions link was rendered inside TradingView iframe. Default target loaded
Sessions/Dashboard inside that iframe while outer replay chrome survived. Setting
the app-owned link target to `_top` fixes actual Chart → Sessions → Dashboard.

- Root browser test `web/tests/realHistory.browser.mjs`: 4 groups PASS against actual
  owner API8010; 501 prefix rows equal CSV, native OHLCV equals CSV without future
  candles, metadata preserved, navigation clears all chart chrome; zero page errors
  or API write attempts. Build PASS104 modules (existing chunk-size advisory).
- Earlier reproduced failure and navigation independent acceptance remain under
  `.artifacts/chart-navigation-20261005/`; final data review under
  `.artifacts/real-history-20261005/independent/`.
- Startup helper smoke on temporary loopback8011: actual catalog1 dataset,
  EURUSDm/93810 rows. Only the owned smoke process was stopped; API8010 stays alive.

**Codex in-app browser limitation:** actual IAB CDP recorded blob iframe Document
`net::ERR_ABORTED`, leaving iframe blank. Isolated Chromium loads the same Advanced
Charts distribution and dataset successfully. No vendor modification or silent
engine switch. Added bounded20s loading error with explicit Chrome/Edge advice and
Lightweight rollback link; IAB visibly displays that error. Native Advanced Charts
inside IAB remains blocked. The exact broker-data native screenshot is `real-chart.png`.

## Resume the imported history

From product repo, retain the existing local `TW_V2_DATABASE_URL` credential in the
environment (do not paste it into chat). Two terminals:

```powershell
.\foundation_v2\.venv\Scripts\python.exe foundation_v2/scripts/serve_exness_history.py
```

```powershell
Set-Location foundation_v2/web
$env:TW_V2_API_TARGET = 'http://127.0.0.1:8010'
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5180 --strictPort
```

The helper requires loopback PostgreSQL and the existing imported data folder,
selects the dedicated database and local owner tenant-a, reuses create_app; it does
not connect to MT5 or fetch new data. Its normal create_app schema initialization
still applies. Do not start a second process on ports already running.

Open in Chrome/Edge:
`http://127.0.0.1:5180/?workspace=tenant-a&view=replay&surface=workspace&session=476f4b498e1a49ed9d48a75719f4d270`.

For a fresh authorized capture, original read/import scripts and receipts remain
under `.artifacts/ftmo-history-20261005/`; its historical folder name does not mean
the imported source is FTMO. Never reimport QA fixtures into this owner database.
