# Independent review — daily MT5 history and Live read-only snapshot

Reviewed at 2026-10-05T05:31:09.767473+00:00 by `/root/fx_analytics_review`.

**PASS for this scoped implementation; FULL_PRODUCT_NOT_COMPLETE.** No unresolved blocker found in the final inspected source or the assigned GET-only UI journeys. Product owner/root integrates this receipt; this document does not change plan/ledger state.

## Changed behavior and data flow

Testing discovers the broker symbol catalog, keeps immutable history datasets, and queues daily UTC closed-M1 catch-up or an explicit bounded backfill. Newer overlap rows replace older rows at matching timestamps; genuine gaps remain. Existing replay sessions keep their pinned dataset. Each asset retains its own failed backfill date, earlier queued/in-flight date upgrades are preserved, and failures retry up to three attempts with bounded backoff. The PostgreSQL owner guard rejects nonowner mutation before writing shared queue state.

Live separately presents the current authorized Exness demo snapshot. The UI polls read-only status, serializes requests, shows a cached same-workspace snapshot as stale on a network error, and clears the account snapshot on denied access. BUY/SELL deal rows remain deals; deposits/other cashflows stay separate. No completed-trade reconstruction or balance derivation was introduced. Execution capability remains false.

## Independent evidence

| Evidence | Result and scope |
| --- | --- |
| `source-probes.json` | 5/5 synthetic temporary-state probes pass: queued earlier-date merge, active earlier-date defer, retry date retention, nonowner rejection, bulk asset date isolation. No SDK, real database or API writes. |
| `offline-tests.txt` | 10/10 actual `test_market_sync.py` unit tests pass under foundation Python. Includes real DataIngestService/ArtifactStore in temporary fixtures, immutable dataset versions, overlap/no-op/recovery, persisted queue and bounded retry. Collector and store are mocked/in-memory. |
| `collector-tests.txt` | Five collector tests were discovered but **all skipped** because NumPy is absent in foundation Python. This is not a collector-test pass; root owns evidence from its separate isolated SDK test environment. |
| `browser.json` | Actual UI5180/API8010 GET-only Chromium journey: Sessions → Kho assets, catalog search/group/full-broker-list filters, Live account values exactly equal API values in memory, deal counts/search, denied workspace, recovery, and pinned replay preservation. No external requests, write attempts or page errors. |
| Final responsive/a11y delta | 8 recorded cases at 1440/360px, axe WCAG2A/2AA/2.1AA/2.2AA violations zero and document overflow zero. Catalog, quote and deal horizontal scroll regions have accessible labels and can be focused/scrolled with ArrowRight at 360px. |
| Network state fixtures | Isolated synthetic GET network failure retained the last same-workspace success with a stale label. Synthetic GET403 removed the account snapshot. Returning to actual GET restored the authorized snapshot. These are labeled browser fixtures, not induced broker failures. |
| Visual inspection | Reviewed `catalog-search.png`, `live-account-redacted.png`, `live-trades-360-redacted.png` after final run. No nested decorative wrappers or clipping in reviewed content; account amounts/reference and deal identifiers were masked in retained screenshots. |

Actual final catalog contains **356 symbols; 35 enabled and 35 downloaded**, queue zero and no active import at the snapshot. Actual Live demo snapshot contained **0 open positions, 0 pending orders, 2 BUY/SELL deals, 2 cashflow/other events and 6 quotes**, with stale false. Saved reports contain only account field names and aggregate counts, not values, account reference or deal identifiers.

Pinned replay `476f4b498e1a49ed9d48a75719f4d270` retained its revision, dataset ID/hash and **501-row** visible prefix throughout the browser run.

## Closed findings

1. Bulk updates previously shared the first asset's failed date with healthy assets. The per-asset `requested_start` now passes the independent reproduction and the new unit regression.
2. Mobile horizontal tables previously failed `scrollable-region-focusable`. Catalog and all four Live table wrappers now expose a focusable labeled region plus focus-visible styling. The actual quote/deal/catalog tables pass axe and native keyboard scroll at 360px. Open-position/pending-order tables were empty in current actual data, so those two wrappers were source-inspected rather than tested with populated actual rows.

## Limits and trade-offs

- This reviewer did not call MT5 SDK, log in to a terminal/account, request imports/backfills, create sessions, send orders, edit product source, commit, restart servers or install dependencies. Root owns those authorized actions and their receipts.
- GET-only frontend requests were routed from UI5180 to actual local API8010. This is the local preview setup, not deployment or production routing acceptance.
- Current broker history is terminal-available history; completeness, full five-year coverage, historical costs/specification changes and OOS/strategy quality are not certified. Raw spread/tick-volume are retained, but historical transaction costs remain unverified.
- No Dukascopy history archive is enabled; its storage/database permission remains unresolved. Futures exchange data is not configured.
- Actual Live currently has no open positions or pending orders and only two deal rows. Populated position/order, pagination, partial-close and cashflow lifecycle coverage cannot be inferred from these current-data screenshots. BUY/SELL deals are intentionally not claimed to be completed trades.
- This receipt accepts only the assigned daily-history/backfill and read-only Live slice. It does not close full WMREPLAY, Product Plan, broker execution, licensing, paid provider, holdout, deploy or cross-project gates.

## Exact inspected source fingerprints

Browser source fingerprints were unchanged between start and end. They were rechecked from disk before writing this receipt. Test file hashes identify the independently executed or inspected suites.

| File | SHA256 |
| --- | --- |
| `foundation_v2/trading_workspace_v2/market_sync.py` | `36230ff5e624fd270dadd6b55ff3b4a442ff73b2c3744a1157b87cefece5f865` |
| `foundation_v2/scripts/mt5_read_worker.py` | `8cf2bff439cc10c3131d78644dc6c1e0a814bb3fb90ca4d29eba21af01865be2` |
| `foundation_v2/trading_workspace_v2/api.py` | `1d4a4aa03d0ed2abe4415309ba02091e9099bcf0805cbe3cf2d3d91a2475fb23` |
| `foundation_v2/web/src/MarketAssetCatalog.jsx` | `0de8695be4663e42f5585ec93b31f96c6933f576bfb02cb044a3ae440544738b` |
| `foundation_v2/web/src/LiveBrokerSnapshot.jsx` | `0ace1f8f7f9305a53268a8e1da1d48c9abbf088315e78d03e36eaa782dabedc5` |
| `foundation_v2/web/src/LiveWorkspace.jsx` | `310d7ddb991e66312ab54ae2ba52ac69a8a869e64e7f7cbf68e402cedf7ca604` |
| `foundation_v2/web/src/market-sync.css` | `60fac6d354b61e9a3984091a9437a68d68818bc81872bd145964639dff737809` |
| `foundation_v2/web/src/live-workspace.css` | `5a1a5386b3bf464d11f4fed990521ff078d52ee294b92cd2afe96103bd7df933` |
| `foundation_v2/tests/test_market_sync.py` | `c00d7ea8f4af84db2678508c101b618833aba8774ffbf17bc9fc2ce2405d5c43` |
| `foundation_v2/tests/test_mt5_read_worker.py` | `4b9d7fee8bde73053d0c7d4c5cdad3fd7799fe61952c7816cad9b4bd9f9fa31b` |
