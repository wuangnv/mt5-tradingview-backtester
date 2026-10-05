# Independent review — SCOPED_PASS

2026-10-05. No unresolved findings in this UI slice. Reviewer wrote evidence only; root owns source and commit. UI5180/API8010 tenant-a, isolated browser GET-only. No orders, research runs, update/history, session mutations, import/download or restart executed.

## Evidence progression

- `baseline.json`:20 route/theme cases and before screenshots; no runtime/network violations. Baseline hash inventory contains5 actual control files and2 honestly marked missing token filenames, not a complete final source pin.
- `harness-mismatch-attempt1-progress.json`: abandoned partial run because reviewer assumed popup8px. Implementation consistently uses trigger8px/popup10px/option6px; corrected oracle, not a product failure.
- `browser-attempt1.json`:57 pass/6 Dashboard failures;18 hashes stable. Found old amber keyboard focus and mobile58px wrapped trigger. Both fixed by root.
- `browser-final-supplemental.json`:45 pass, stable18 hashes;40 page/button/navigation hover cases,4 native keyboard/picker cases, real rich chooser/disabled appearance action. Predates later semantic exclusions; never described as final frozen source.
- `browser-attempt2-crossed-fix.json`:56 pass/6 Research/Risk failures; source changed during run. Found Research dataset98px on mobile and Risk select42px on desktop/tablet. Root fixed native height. Retained raw crossing evidence.
- `browser-native-final-before-legibility.json`:33 pass/1 reviewer oracle failure,18 hashes stable. All26 affected native routes,4 native keyboard cases and2 short/mobile popup cases passed. BUY/SELL both use existing gray hovered background; requiring different backgrounds was an incorrect oracle. Actual semantic foreground remains green/red.
- `browser-semantic-final.json`:2 pass,18 hashes stable. BUY hover text109,193,139; SELL239,137,137; P/L/badge colors retained; session full payload unchanged. Labeled CSS-only danger fixture remains red255,128,117/white, without claiming a real danger flow.
- Visual Research probe then found clipped long text and invisible chevron despite computed ellipsis. Root added existing inert button/selectedcontent markup to2 native Research controls.
- Final `browser.json`:10 pass, zero failures/errors/blocked traffic,19 source hashes stable before/after. Research dark/light360/768/1440, short/mobile custom popups, semantic hover and isolation rerun on final source.
- Final `research-probe.json`:2 dark/light360 pass; native keyboard selects next real dataset and updates local selection/URL, without submitting a run. Closed label shows ellipsis and clear chevron; popup shows full wrapping labels. No React/browser console error. Intentional blocked Vite HMR socket warnings recorded separately; raw audit retained in `research-probe-hmr-isolation-audit.json`.

## Accepted behavior and source

Ordinary select triggers40px/8px, compact13px typography; rich session summary intentionally remains tall/12px. FxSelect, SessionFilter and supported native base-select share neutral hover/open/selected states and10px popups. Pointer opening has no keyboard focus ring; keyboard focus remains visible and neutral. Disabled controls retain disabled behavior. Top columns/bottom page-size/session popups fit clipping content at360x600; no document overflow in tested layouts.

Dashboard, Sessions, Trades, Analytics Sessions/Prop, Market, Live, Strategies, Settings and Learn tested dark/light360/768/1440. Additional Journal, Research, Data Desk and Risk routes tested across the same viewport/theme matrix. Initial Live/Strategies/Learn routes have no select; visible buttons/links/navigation hover inspected. Axe returned no WCAG violations in inspected cases.

Column search/select-all/multiselect and session multiselect retain their meaning. Analytics edits remain draft until Apply; report count20 remains unchanged during edits, becomes10 for New York Buy after Apply, returns20 on clear; demo creates no API reads. Research retains native option labels/value/change handlers and keyboard selection. Buy/Sell and P/L foreground colors preserved; general hover policy does not grant execution authority.

Read-only source review and scoped `git diff --check` passed. Exact final pin is the19-file before/after list in `browser.json`; component policy SHA256 `18f1676f69dbf8b2af672d607ea3aaae6a8d3d7e06da1d534c2afe25d6d15040`, Research SHA256 `8c82bf11b7b23da441d9acbd026d00cfcd891cec4059d3bde9273d9666820c1c`. Research changes add only2 inert selectedcontent elements; handlers/option labels unchanged.

## Visual and data boundaries

Reviewed representative dark/light Dashboard/Analytics/Trades, native Market popup, Research closed/open mobile and page-size mobile screenshots. Useful final captures: `research-dataset-dark-360-closed.png`, `research-dataset-light-360-open.png`, `native-market-dark-360-open.png`, `native-market-light-1440-open.png`, `final-dashboard-dark-360-open.png`, `final-session-light-360-open.png`, `final-page-size-light-360-open.png`.

Real evidence: cached datasets, existing rich session chooser, local BUY/SELL draft switches, native Market group selection and unchanged old session full GET payload. Labeled fixture: CSS-only danger button, no real cancellation/deletion behavior claim. Demo analytics/multiselect evidence is local preview only. Browser WebSockets intentionally closed; no writes/downloads/external traffic attempted. Populated Prop financial acceptance, broker/live execution, native touch/coarse-pointer44px variant, unsupported-browser fallback and whole-product acceptance remain outside this scoped result. Root build/regression checks are not reviewer-run claims.
