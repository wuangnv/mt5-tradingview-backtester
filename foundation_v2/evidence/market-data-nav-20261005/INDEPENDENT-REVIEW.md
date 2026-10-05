# Independent review — Testing Market Data navigation

2026-10-05T08:34:11.476493+00:00 · `/root/fx_analytics_review`

**Scoped PASS. No remaining product blocker found.** This accepts the Market Data navigation/page slice only; FULL_PRODUCT_NOT_COMPLETE. Root owns integration and commit; no plan or ledger state was modified by this reviewer.

Market Data is the fifth/final Testing sub-header tab after Dashboard, Sessions, Trades and Analytics. `view=market-data&area=testing&section=market-data` renders the existing broker catalog as a dedicated flat page, with an accessible hidden h1 but no repeated visible heading. Shared catalog fetch/state/storage stays unchanged. Sessions uses the Market Data action; `view=data` still renders Data Desk CSV/provenance and its optional Kho Testing heading.

Independent actual UI5180/API8010 GET-only evidence in `browser.json` verifies seven journeys/checks:

- Dashboard → final Market Data tab preserves workspace, session and cursor context, selects exactly one sub-header tab and the Testing rail.
- Search EURUSDm renders its real M1/tick catalog row. No update/download/fresh replay link was followed.
- Bare `?workspace=tenant-a&view=market-data` deep link and reload infer Testing and retain Market Data selection.
- Sessions Market Data action reaches the dedicated page; returning to Dashboard restores its selected tab.
- Data Desk CSV/provenance route and catalog heading remain available.
- Six actual dark/light × 360/768/1440px cases have document overflow0, selected Market Data fully visible and axe WCAG2A/2AA/2.1AA/2.2AA violations0. Catalog horizontal scrolling is keyboard accessible at 360/768px.
- Prior replay `476f4b498e1a49ed9d48a75719f4d270` remains at revision2 with unchanged payload, dataset hash and 501-row prefix. Catalog history IDs/timestamps/counts and tick snapshot IDs/counts remain unchanged: 356 assets; EURUSDm 2,464,842 ticks and XAUUSDm 19,014,116 ticks.

Visual inspection of `market-data-light-360.png` and `market-data-dark-1440.png` confirms the final tab, compact page spacing, catalog filters and focus indication. Table clipping on mobile is inside the intentional horizontal scroll region, without document overflow.

## Resolved finding and evidence integrity

On desktop→360px resize, Market Data initially remained wholly outside the visible sub-header: nav x58..360; selected tab x399.89..494.06. `selected-last-tab-before-fix.json` preserves this failure. Root added ResizeObserver selection reveal to ShellSubnav with observer cleanup. Final six-case rerun confirms the selected tab stays visible when resizing.

Two early harness assumptions were corrected: collapsed-rail text must be verified through its aria-label, and catalog rows must be awaited after search. These were harness errors, not product findings. One interrupted attempt encountered a route.fetch socket hang-up. The bounded final rerun completed all product assertions and matrix checks with no page error or write/external attempt. During browser teardown, one outstanding sessions GET reported `Request context disposed` after PASS had been recorded; that harness-cleanup warning remains verbatim in `browser.json.errors`. It is not claimed as an error-free teardown or an application page error. No additional matrix was opened for this cleanup-only warning.

## Scope and limits

Reviewer edits are confined to this evidence directory. No product source, vendor file, broker execution, MT5 SDK/account, download/import/update, new session, existing DB/session mutation, server restart, dependency or commit operation occurred. API reads were routed from the local UI to actual loopback8010; this is local preview evidence, not deployment acceptance. Existing financial/history completeness, tick cost/coverage and full-product gates are unchanged. Root's build and broader empty/stale/403 fixture checks remain separate evidence.

Five inspected frontend files stayed byte-identical across the final browser run and were rechecked from disk before writing this receipt.

| File | SHA256 |
| --- | --- |
| `foundation_v2/web/src/FxReplayShell.jsx` | `c751f11c689e24094702983178c631d2543dbe4c59ae3ad246bbae8cb096dbae` |
| `foundation_v2/web/src/main.jsx` | `c7fd7b10befc3cf92fe3a32469fd27060019a2f2fc6e2ae2f6615dbe780b26e3` |
| `foundation_v2/web/src/MarketAssetCatalog.jsx` | `3e4fc79f134fe07c063439f9b7075260c951f0ee3f44d28771618e13f9732f05` |
| `foundation_v2/web/src/market-sync.css` | `345a264f6ff6e5c8013e8a78d29d5aa55e638fbdd8c596024dd7210cd5fffbf5` |
| `foundation_v2/web/src/SessionPicker.jsx` | `e3af3330e5e3f8681c62f4b6f1a53faf08473e2bdcd98b0ddc9cc73a0e579b63` |
