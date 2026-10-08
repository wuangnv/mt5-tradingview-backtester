# QDM shared catalog — 08/10/2026

Scope: owner clarified that Backtest and Prop firm are separate modes using one
complete QDM catalog. This slice expands catalog discovery and fixes symbol
creation. It does not implement FTMO presets/evaluators or duplicate price stores.

## Implementation and actual installation

Read `internal/plugins/DataSourceDukascopy/dukascopy.csv` from the owner-installed
QDM 125.2692. The file is semicolon-delimited, 12 columns, Windows-1252, 725 rows.
Source groups: Forex 64 (including two metals), Commodities 13, Indices 19,
Stocks 625, Crypto 1, Bond 3. Whitespace around category/group is normalized.
UI classifications: stock 625, fx 62, index 19, agriculture 6, metal 5, energy 4,
bond 3, crypto 1. Classification uses QDM fields, not ticker-name guesses.
Source SHA256:
`e641159e8a9b35fd829a7e5022754bb7a2d2a1a554088cb37f6d69c078f1ec2a`.

Catalog and downloader share one validated metadata snapshot. Refresh uses only
local installed definitions, requires no network or CLI launch, and reloads
metadata without restarting the downloader. Duplicate/unsafe codes, invalid
dates, unknown categories and malformed rows fail refresh. The last good list
remains browsable with stale/error state; both UI and backend reject new requests
and resume until recovery. The installation is the persistent source; if missing
at startup there is no invented catalog or hard-coded EUR/USD fallback.
Jobs pin source code/catalog hash and imports retain immutable dataset versions.

Source catalog is Dukascopy through QDM, not every provider QDM might support.
Neither mode changes this source list; broker costs/execution and prop rules are
session-owned. Existing FTMO rule gaps remain documented in quantdatamanager.md.

## Real CLI finding

Passing the spaced argument `broker=SQ Default` produced success exit markers but
did not create USATECHIDXUSD/AAPLUSUSD symbols. Omitting it uses QDM's documented
default and creates the source instrument correctly. Adding a temporary custom
instrument did not fix the spaced argument; that test instrument was removed.
Integration-owned `USATECHIDXUSD_TW` and `AAPLUSUSD_TW` were retained, with zero
records and no full historical download. Actual list reports Index/Stock,
Dukascopy, M1 and source-code instrument. Newly created symbols report empty
timezone until populated; accepted only when Total records=0. Timezone/source/
instrument/M1 are rechecked after update before explicit UTC export.
No existing user symbols, license or activation were modified.

## Verification

- 6 catalog cases: both encodings, categories/dates/IDs; malformed/duplicate/unsafe
  rejection; live refresh propagation and disk reload; failed refresh retention,
  backend download/resume rejection and recovery; pinned in-flight job; non-FX
  price-only fixture publication. 9 existing QDM executor cases pass.
- 26 reused Dukascopy full-download regressions pass; 16 Node model/metrics cases
  pass; Vite production build passes.
- Licensed CLI + FastAPI + disposable loopback PostgreSQL: catalog 725, selected
  FX/metal/stock/index dates/categories, refresh consistency, real non-FX symbol
  validation, cross-workspace denial, EUR/USD export/import on 05/10/2026.
  1,438 rows published; raw normalized SHA256
  `a0e59a0e6260ec498c013484ae9771496380a2083f958246ab9fc4a2c30dd796`.
  Quality remains review. User database was not truncated or modified.
- `qa.mjs` consumes the real API's catalog payload from an ignored local file;
  browser calls are intercepted fixtures, no real browser download commands.
  1710/768/360: downloaded default/empty state; pagination; stock/name search;
  QDM label/M1/date/unknown row count; drawer count/scope; malformed refresh keeps
  rows and disables downloads; recovery; same catalog under backtest/prop URL
  contexts; missing install; no page overflow/JS errors. Useful screenshots
  reviewed. Earlier failures are retained: harness initially assumed 10 rather
  than 25 rows; attempted desktop boundary control on mobile; attempted last
  page number outside the current pagination window. These were test assumptions,
  not product fixes. Current qa.json passes.

Not an integrity test of all 725 histories, full-history performance acceptance,
MT5 broker/profile validation, or acceptance of the FTMO evaluator.

## Activation and Git scope

Code/tests/docs and sanitized evidence are Git-managed. Commercial binaries,
license/cookies, vendor metadata snapshot, data and raw logs remain ignored in
`.runtime`. Clone GitHub then install/activate QDM locally as documented.
API 8010 was observed still serving the previous 1,504-asset catalog with no saved
datasets; this task did not restart it. Prior automatic restart was rejected by
tool policy; no stop/start workaround was attempted. Owner can run
`restart-offline-api.bat` and reload UI to activate QDM. The default filter is
still Downloaded per owner preference; choose Not downloaded to browse catalog.
