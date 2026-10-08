# Quick-session asset picker — 08/10/2026

Scope: replace the repeated generic asset selection field with the owner's reference layout: search, wrapping category chips, flat instrument/name/category rows and a recent section when saved session history exists. This is a scoped UI change, not full product acceptance.

Data: the existing workspace library GET supplies saved dataset versions plus catalog metadata. Metadata joins require the same instrument, price source and download engine. Catalog-only instruments never become selectable replay datasets. Parent session history orders recently used saved versions; each row and creation payload retain the complete immutable dataset ID. Repeated instruments show a short version identifier. Source labels use Dukascopy for QDM imports, timeframe uses M1. Names come from saved/catalog data; the actual EUR/USD catalog currently only supplies EURUSD, so its subtitle shows M1/source rather than an invented full name.

Interaction: reuse FxSelect positioning, outside-click, Escape/focus return and option keyboard navigation. Optional header, row rendering, search metadata and grouping leave generic selectors' option DOM unchanged. Filtering repositions the popup without stealing focus from search. Category chips stay separate from selectable dataset rows.

Validation:

- `node --test tests/datasetAssetOptions.test.mjs tests/sessionPicker.test.mjs`: 13 passed.
- `node run_dataset_asset_ui_acceptance.mjs`: 10 passed journeys in report.json. Actual local UI/API GET journeys at 1710/1440/768/360; no real writes. Labeled fixtures cover recent history, source/name enrichment, long identities, exact version selection/payload, search typing/focus, category filtering, keyboard navigation, outside click, empty catalog, failed read/retry, dark VI and light EN. Generic multiselect and sort regression passed.
- `npm run build`: passed; `git diff --check`: passed.
- Reviewed desktop, mobile and light-theme screenshots. Popup bounds remain inside the dialog's scrolling body; categories wrap and the list scrolls.

The older selectPolish.browser.mjs attempt timed out on its literal English `Type` selector under the current Vietnamese UI. It was not reported as a pass; the scoped regression above uses the current localized controls.

No download, service restart, live broker action or real session creation was performed. Fixture creation POST is intercepted with an explicit 422 response to inspect the payload without changing workspace data. Native browser zoom and full accessibility certification are outside this scoped acceptance.
