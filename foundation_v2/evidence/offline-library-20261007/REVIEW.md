# Independent offline-library review — 2026-10-07

PASS 26 scoped cases for the final offline-only direction: eight actual UI cases (360/1710 px × dark/light × VI/EN), three route/deep-link cases, five catalog-response states, two demo cases, and eight CSV/keyboard cases. Final affected visual and CSV checks were rerun after the search, primary CSV copy and pending-input corrections. No unresolved scoped finding. The earlier `data-library-20261007/REVIEW.md` remains unchanged WIP evidence for the abandoned online-tab direction.

## Scope and actual behavior

Practice now mounts only the saved dataset library and CSV workflow. Source review confirms no MarketAssetCatalog import/mount, sync tab or Live-source navigation in this page. Every reviewed journey had zero market-assets and Live API attempts; the probe explicitly aborts those endpoints and would record a failure if invoked. No online polling, broker update or new downloader was exercised.

Actual tenant-a GET returns 44 existing immutable snapshots. Original source labels such as Exness-MT5Trial14 / MT5 remain visible with an Offline snapshot label; they are not relabelled as Dukascopy data. The UI explicitly states Dukascopy downloads are not enabled and saved history is used offline. This slice does not implement, activate or verify a Dukascopy connection.

`git diff HEAD --exit-code` passed for LiveWorkspace.jsx, FxReplayShell.jsx, live-workspace.css, MarketAssetCatalog.jsx and marketSync.browser.mjs: no staged or unstaged changes to these deferred MT5/Live files. Their existing behavior was not tested or claimed accepted by this offline review.

## Verified interactions

- The 44-item catalog shows 25 rows then 19; selecting 50 shows all 44. Search/source filtering, clearing and no-results states work. Primary headings, quality labels, dates and counts follow VI/EN. Mobile table scrolling stays inside its focusable labelled region; keyboard ArrowRight scrolls it and page width does not overflow.
- Known dataset deep links open the correct details; unknown IDs select no replacement dataset. Legacy `view=data&data_tab=sync` safely opens the offline library, including after reload, with no tabs or online requests. A stale Live area on the legacy alias activates Testing/Market Data. Canonical data links preserve chosen workspace/demo/dataset and clear explicitly removed session/cursor scope.
- Per-row Create opens the existing quick-session dialog with that exact dataset selected. Eight disposable replay POST fixtures carry its dataset id, raw `starting_balance: "25000.75"`, Legacy engine and tenant-a header, then stop at 422. No real session creation occurred.
- Provider-info failure leaves saved datasets usable. Dataset 503/403 states hide the table and permit three bounded retries, then stop. Recovery restores the catalog; empty state offers offline CSV guidance rather than online download controls.
- Demo uses the same library with creation and header Import CSV disabled, no file input, and zero API reads/writes in both languages.
- Header Import CSV is keyboard-operable at both widths: Enter opens the existing disclosure, scrolls the file field into view with reduced motion respected, and focuses that field. It does not read or upload a file by itself.
- CSV fixtures cover empty file, preview 422, missing-data import block, review acknowledgement, stale preview after metadata edits, and successful filtered import/reload. Changing instrument metadata disables Save until Check data is repeated. Successful fixture import clears nondefault source/search filters, resets page, selects/opens imported details, and reads a fixture-only 45-item catalog after reload.
- Held preview/import responses verify file, metadata and review controls are disabled while busy and enabled after settlement, preventing old-preview/new-form races. File selection alone performs no POST. Intercepted request bodies carry CSV text/spec, never a filesystem path.

Final fixture samples use `time,open,high,low,close` and timezone-bearing ISO times. This was independently checked against REQUIRED_COLUMNS and `_parse_time` in data_ingest.py; its actual parser accepts Unix seconds or ISO with timezone. Response fixtures prove UI/state and body behavior only, not real ingestion or storage durability.

## Visual review and resolved findings

Inspected representative dark/VI desktop, light/EN mobile, quick-create and CSV keyboard screenshots. Search icon is inside the input and vertically centered at every matrix size. Removing the online component initially removed its incidental CSS dependency and left the icon outside the field; owner fixed this with locally owned search styles. Existing table keyboard focus and localization findings from the first pass remain resolved.

Primary CSV instructions, file/instrument/timeframe/action labels are localized and the irrelevant broker badge is removed. Advanced provenance/provider/quality explanatory prose still contains inherited mixed VI/English; full translation of that advanced content remains outside this slice. No new provider/network authority is implied by its capability metadata.

## Evidence and boundaries

Runnable probe from product root: `node foundation_v2/evidence/offline-library-20261007/review.mjs`. Optional regex first argument selects cases; optional second argument names a separate result file. Final composite: `review.json`; prior batches retained in `review-before-header.json`, `review-before-final-refinement.json`, `review-header-final.json`, `review-final-affected.json` and `review-csv-final.json`. Useful screenshots include `real-{theme}-{language}-{width}.png`, `initial-modal-{theme}.png`, `csv-header-keyboard-{width}.png` and CSV response states.

Only local 5180/8010 GET/HEAD/OPTIONS reached servers. WebSockets closed; allowed replay/CSV POSTs were fulfilled in memory and every other write blocked. Errors/unexpected requests are empty. No real mutation, broker call, MT5 startup/update, external source download or account operation. No product source edit or commit by reviewer. Receipt covers scoped local UI/interaction, source ownership and request contracts; whole-product/broker/production/persistence acceptance is separate.

## Primary validation

Final source validation completed after the CSV copy, search geometry and pending-form changes:

- From `foundation_v2/web`: `npm run build` — PASS.
- From `foundation_v2/web`: `node --test tests/workspaceContext.test.mjs tests/retry-boundaries.test.mjs tests/dataDeskApi.test.mjs tests/researchDataApi.test.mjs` — 13/13 PASS.
- From product root: `& ./foundation_v2/.venv/Scripts/python.exe -m unittest discover -s foundation_v2/tests -p test_u2_data_desk_payload.py` — 4/4 PASS.
- `git diff --check` — PASS. The eight source hashes below matched the final working files before checkpoint.

These checks complement the 26 scoped browser cases; they do not establish real CSV persistence, broker or whole-product acceptance.

## Final SHA-256

Hashes below match source after the final affected runs and were rechecked before this receipt.

| File under web/src | SHA-256 |
|---|---|
| main.jsx | 5d6a44c0dd607fd51b9398c9d1172505fd2dcb06a6aa549d4495124972922d23 |
| workspaceContext.js | a9a96d7b3f2e5c200f739b91867c8be07118e8a262915224e0faa713f36623b0 |
| DataDeskWorkspace.jsx | 93d1b59a02f9414fbd4a8fd32ef128f4a80fc9ac254ec35b2248500ccc2465c3 |
| MarketAssetCatalog.jsx (unchanged) | 43b3dc2bd6a35335885942a42c0d217c859250dfdf94b40873116d7f23127b19 |
| QuickSessionDialog.jsx | 098cce29ee26fb38893a39c21c3a5c8f51bbac743394df0aebd089f685cee2a4 |
| DemoPreview.jsx | d70014cfab4b2695b21c88d66d1f684ea3572241e41b303840b0c8001b8955c7 |
| testing-copy.json | 8f12f4de4c3897f77a4a4dac4d2084381395688b8a7406105c369bb04247dcf1 |
| data-library.css | 5af66db9aa3132c4637b5ef19e0b074461940e2b833dc99be4181122a908456e |
