# Independent library grid review — 2026-10-07

**PASS: 10 UI journeys + 8 offscreen menu-entry regressions.** No remaining finding within reviewed scope. Reviewer edited evidence only; no product edits, commits or actual writes.

Run from product root:

```text
node foundation_v2/evidence/offline-library-grid-20261007/independent/review.mjs
node foundation_v2/evidence/offline-library-grid-20261007/independent/menu-scroll-race.mjs
```

Results: `review.json` and `menu-scroll-race.json`.

## Verified behavior

- Real empty catalog dark/light at 360/1428: seven table headers including category; no toolbar count, create-session button or disclosures. Desktop search sits left of right-side filter/sort/CSV controls. No document horizontal overflow.
- Explicit isolated fixtures dark/light at 360/1428: eight asset categories display correctly; category/source filters, hide/reset filters, search and descending/downloaded-first sorting work. Mobile table contains horizontal scrolling.
- Every row uses disabled download state and separate ⋯ dropdown. Opening ⋯ does not immediately open a dialog. Downloaded details and CSV update actions work; unloaded details are disabled and CSV import preselects its asset/category. Keyboard ArrowDown, End and Escape work; menu fits viewport and restores trigger focus. Dialog close restores ⋯ trigger focus.
- Update fixture preselects XAUUSD, metal, 60 seconds and source/spec. All preview/import POSTs intercepted. New dataset ID produces separate old/new rows after refresh; old row remains available. Payload contains no overwrite dataset ID. This proves UI immutable-version handling, not real persistence acceptance.
- Zero-closed-trades dashboard fixture uses required performance schema and shows no removed informational banner. Genuine error/blocked logic remains unchanged by source diff.

## Fixed finding and regression

Initial full probe found intermittent ⋯ dismissal immediately after automatic scroll brought an offscreen trigger into view. It failed both mobile keyboard opening and desktop update entry (`attempt-before-menu-fix.json`). Parent replaced global scroll-dismiss with menu repositioning.

Final full probe passes former failures. Separate regression passes eight entries: widths 360/1428, mouse click and immediate focus+ArrowDown, two repetitions each, against last row initially offscreen vertically and mobile horizontally. Native delayed table-scroll events are recorded; menu stays open; Escape restores focus. Initial dashboard fixture errors were probe setup mistakes (wrong endpoint, then missing required schema), corrected without product changes.

## Evidence and limits

Inspected screenshots include `real-dark-1428.png`, `fixture-light-1428.png`, `fixture-dark-360-menu.png`, `fixture-light-360-csv.png`, `immutable-update-fixture.png` and `scroll-keyboard-360.png`.

No page errors or forbidden traffic. Real journeys use local GETs only. CSV POSTs fulfilled by QA fixtures; provider/Live/MT5 APIs, external origins, other writes and WebSockets blocked. Fixture provider is labeled `isolated-QA` and is not a configured integration.

Backend diff exposes metadata only from configured providers declaring `read_metadata`; it does not add a Dukascopy adapter, API key, network discovery or history-download authority. Current download controls remain disabled. This receipt must not be used to claim full Dukascopy/provider integration or dataset-quality acceptance.

## Source SHA-256 at final verification

```text
DataDeskWorkspace.jsx cbd34630a54d2c4d51d9001156585edc732c005a6acfaf381b36983f98404b76
DataLibraryActions.jsx fe496339efd557a45b7e841ea21ee6d4724c15a57213c63fb5861c0e0ab858ab
dataLibraryModel.js cda77d385da1120c7611b48f3793e74530e6faae18959111c9fd6597b22da119
data-library.css d10e92094080f840856ce98643fc33a333ed34095866444155a6623387c3821a
dataDeskApi.js 3d43fddf53f7277fa73ec8e7ed9e5a41529b02e75ed85d3afea0fbd51c7337b9
DashboardPerformance.jsx 3c320c0929f689ad0cf4fc0879f178565747323a18a5b98a255286e07208c80e
api.py 78b7f7d9bd4ea79f16338ca80387136f13c003e41680ea7f61a110e41e5c1acc
data_sources.py 75bba3366eab1ed922509a52ca8c2431ee52955675980f919535d8cb32cd4444
```
