# Independent Testing UI review — 2026-10-06

SCOPED_PASS. 164 final browser cases passed, with zero page errors and zero blocked write/external requests in their final reports. Review edits were limited to this evidence folder; no product source or commits were changed by this reviewer.

## Evidence and coverage

- `runtime-report.json`: 96 cases across Dashboard, Sessions, Trades, Analytics Sessions, Analytics Prop and Market Data. Demo: EN/VI × dark/light × 390/768/1710 =72 cases. Actual local data: EN/VI × dark/light ×1710 =24 cases. No repeated visible page titles; document/content overflow0; controls13px, section headings16px, metric values32px; mobile common controls44px. Dropdown fit, hover, keyboard tabs and cancel-only deletion dialog focus trap checked.
- `focused-report.json`: 42 cases covering native Timezone scrollbar track and actual thumb dragging; keyboard and Tab-out; multiple selection mixed state; draft filters followed by Apply; invalid date ranges; Market catalog137 rows with missing optional metadata; Trades237 rows through remote GET paging; empty, error, unavailable, partial and unknown-count states. Includes12 scoped Axe scans with zero WCAG2A/AA/2.1AA violations.
- `supplemental-report.json`: 16 stable-source Sessions cases after the isolated final copy changes. Checks EN/VI visible text and aria/title strings, both themes, demo390/768/1710 and actual1710.
- `chart-report.json`: eight actual GET-only journeys through Go to chart, both advanced and lightweight engines, EN/VI at390/1710. Actual candles rendered. Order panel and existing account initialization form opened for inspection and closed. No replay or execution mutation.
- `chart-label-supplement-report.json`: two final stable-source actual advanced chart cases, EN/VI at1710, after isolated chart label/glossary changes. Verified ready state, localized iframe title and outer aria, native Save chart caption/title, and Order panel view/open/close. Fit order is hidden because the real session has no initialized order; it was not activated.
- `contrast-report.json`:12 popup color samples compensate for Axe's incomplete color-contrast assessment. All enabled text sampled from Type, Timezone and Date popups meets4.5:1; minimum6.225:1. Foregrounds were compared with composited ancestor background colors. Disabled text excluded.
- `final-receipt.json`: machine-readable coverage, constraints and final source hashes.

Representative screenshots were visually inspected: Desktop Sessions and Trades; mobile Market and Analytics; Dashboard, Prop and actual read states; advanced and lightweight actual chart; mobile order panel; native scrollbar popup. Tables intentionally scroll within their own regions. Mobile filter rows wrap without horizontal document overflow. Shared `.sr-only` now hides accessible page headings on routes where the chart chunk is not loaded.

## Findings resolved by implementation owner

1. Trades local page was reset by an effect depending on the current page. Page2 and First/Last now work; remote paging, row sizes and mixed header selection also passed.
2. Pagination-specific height overrode mobile control sizing. Trades and Market selectors now use44px on mobile.
3. Sessions summary/description heading styles overrode the section font token. They now use16px.
4. `.sr-only` previously existed only in the lazy chart stylesheet, exposing repeated titles on other routes. The shared rule now applies across Testing.
5. Final Sessions chart/tooltips and weekday aria strings are localized. Stable supplemental evidence verifies these isolated changes.

## Source and data integrity

The96-case matrix and42-case focused run crossed exactly two source changes: `SessionPerformance.jsx` and `testing-copy.json`. Their raw reports retain `sourceUnchanged:false`; the main matrix's exit1 is its strict pin guard, with all96 behavioral checks passing. The final16-case supplemental run has unchanged pins and supersedes those final copy checks. The eight chart cases also have unchanged hashes for all frontend source files. The seal script verifies current source against those final hashes before producing the receipt.

The subsequent chart label supplement supersedes exactly `TradingViewReplayChart.jsx` and `testing-copy.json`. Its two cases and all105 final frontend hashes remained stable. `seal-label-supplement.mjs` verifies that exact change set and current hashes, then extends the prior162-case receipt to164. The previous receipt is retained as `receipt-before-chart-label-supplement.json`.

After those stable runs, the owner cleaned blank-line spaces and extra EOF newlines in12 frontend files. `../root/format-only.json` reports `nonWhitespaceUnchanged:true`. The reviewer independently checked that byte hash changes match exactly those12 filenames, with no unexpected source drift, and resealed current hashes. The pre-format105 pins remain in the receipt's format-only lineage. This is owner-supplied evidence for a whitespace-only change; the reviewer does not claim byte-identical runtime QA after formatting. The owner reported post-format build PASS, Node64/64 PASS and backend75/75 PASS before the frontend-only cleanup.

Actual catalog and selected session records were compared before/after the matrix, supplemental and chart journeys and remained equal. Network was restricted to local GET/HEAD/OPTIONS and WebSockets were closed. No account initialization, step/play, order submission, archive/delete confirmation, provider calls or data updates were executed.

One chart attempt hit a transient local GET socket hang-up. The same backend returned200 immediately afterward; the scoped chart run was repeated with Playwright's connection-reset retry and completed all8 cases. Early modal containment and iframe-canvas assertions were corrected as harness oracles, not product failures; exploratory evidence remains separate.

An early chart-label oracle incorrectly selected the native iframe by URL; its actual URL is about:blank. The corrected check uses the selected iframe's contentFrame and passed both languages. That exploratory run also recorded one vendor request for Google Analytics script, which was aborted by the network guard; no external traffic was allowed. The final two-case supplement recorded no such request. This observation remains in `chart-label-oracle-report.json`.

This receipt approves only the reviewed Testing UI scope. It does not certify whole-product completion, broker/live execution or initialized real Prop analytics. The primary actual session has no initialized execution; populated analytics and challenge objectives were exercised with deterministic demo data.
