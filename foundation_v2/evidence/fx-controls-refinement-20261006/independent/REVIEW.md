# Independent review — FX controls refinement, 2026-10-06

**SCOPED_PASS.** Final independent runtime matrix: **31/31**; focused accessibility scans: **10/10**, **0 violations**. No blocking findings remain in this refinement scope. This receipt does not assert whole-product completion or broker acceptance.

## Evidence and isolation

- UI `http://127.0.0.1:5180`; actual API `http://127.0.0.1:8010`, workspace `tenant-a`.
- Reviewer changed only this `independent/` evidence directory. No product source edit or commit.
- Actual traffic allowed GET/HEAD/OPTIONS only. External origins, writes, and WebSockets blocked. No blocked write attempts occurred. Actual catalog and selected session GET snapshots matched before/after.
- Demo journeys produced **zero API requests**. They exercise local preview state, not actual session mutations.
- Two separately labeled synthetic GET catalog cases add 15 clone records only to make rich picker / Session dropdown scrollable. Clones are never selected or applied; they are not actual backend records.
- Final `report.json` pins **21 frontend files** before and after, including `fx-analytics.css`: unchanged. `accessibility-report.json` independently pins the eight relevant control/dialog files: unchanged.

## Runtime matrix

`review.mjs` and `report.json` contain 24 demo route/theme/viewport cases (Dashboard, Sessions, Trades, Analytics × dark/light × 360/768/1440), one domain model oracle, two synthetic catalog scrollbar cases, and four actual GET-only route smoke/cancel cases.

Verified behavior:

- Direct Archive/Restore/Delete control labels/icons replace the action overflow menu. Delete confirmation opens with input focus; Tab and Shift+Tab remain inside the modal, Escape dismisses it and restores opener focus. Real dialogs were canceled, not submitted. Root's separate session-action tests cover demo mutation submissions.
- Rich replay picker omits the redundant placeholder option. Popups stay within horizontal and vertical viewport bounds and within the actual content client edge, excluding the native scrollbar width. Opening or using them does not add content horizontal overflow beyond the closed-report baseline.
- Trades detail icon is circular, uses vector icon, and pagination/page-size controls align at 360/768/1440. Session filtering uses whole-row checkbox buttons; Space toggles a row and All exposes mixed state.
- Session metric info icons are SVG. Analytics internal tabs have rounded active backgrounds. Extra report scope text was removed.
- Type has App/Prop selections and disabled Battles. Draft changes preserve current report until Apply; selecting only Prop in an App demo report yields zero rows after Apply. Clear restores its original 20. Type filters the current report source; it does not load an App/Prop union.
- Time Start/End use HH:mm, inclusive minute filtering and overnight ranges. UTC overnight expected counts are independently derived from ledger close timestamps; a separate Ho Chi Minh midnight-boundary fixture includes 00:00 through 01:30:59 and excludes adjacent minutes.
- Searchable Timezone accepts `Ho Chi`, selects Ho Chi Minh, remains draft before Apply, and renders the selection/clear state afterward.
- Calendar input synchronizes month; selecting July 10 then July 8 swaps endpoints to July 8–10. Draft report remains unchanged; Apply yields the independently counted close-date range. Endpoint and intermediate-day visual states were reviewed in dark/light screenshots.
- Native scrollbar track click increases scrollTop, native thumb drag increases it again, and each dropdown remains open. These checks use actual browser scrollbars with **no DOM/CSS instrumentation**, including the long IANA list and both synthetic catalog pickers.
- No document horizontal overflow, new content horizontal overflow beyond its closed-report baseline, page errors, unexpected external traffic, or actual writes in final matrix.

## Accessibility and visual review

`accessibility.mjs` scans direct action dialog, Session filter, Type menu, Timezone menu, and calendar in both themes against Axe WCAG 2 A/AA and 2.1 AA tags: ten scans, zero violations. It separately proves Shift+Tab leaves the Session/Timezone dropdown and dismisses it. Keyboard close was preserved by the scrollbar fix.

Screenshots at all tested widths were generated; representative Dashboard/Sessions/Trades/Analytics layouts, calendar states, native scrollbars, and dark/light treatment were visually inspected. At 360px, calendar content scrolls within the bounded popup; selecting dates can move its heading above its internal scroll viewport. It remains reachable with native scroll, and this is accepted responsive behavior rather than a blocker.

## Finding resolved during review

Native scrollbar click blurred a search input to `.fx-content`, causing the shared outside-focus handler to close the menu. Ignoring null relatedTarget did not solve this case. Making the scrollable listbox/session-options focusable with `tabIndex=-1` moves native scrollbar focus inside the dropdown. Final actual track/thumb interaction and Tab-out regression both pass.

Final native-scrollbar screenshot review found that dropdown positioning used the content bounding rectangle's right edge, which includes the native scrollbar gutter. FxSelect, SessionFilter, and AnalyticsFilterControls now clamp against `container.clientWidth`. Independent checks use actual client-edge geometry, rather than viewport fit alone, and compare content scrollWidth before/after popup interactions. The previous receipt was replaced after rerunning on these three source changes with fresh 21-file pins.

The final calendar date-input CSS uses 12px type and 6px inline padding so the native mobile date text and calendar icon fit the compact two-column controls. The final runtime and accessibility reruns pin this stylesheet change too; the prior passing behavior run crossed that edit and remains separately labeled `report-r9-client-edge-before-date-style.json`.

Raw failed probes remain in `report-r1` through `report-r5` for traceability. Early thin/hidden-scrollbar oracle failures are not product regressions: Playwright default headless Chromium includes `--hide-scrollbars`, which reserves CSS gutter without an interactive native track. Final harness uses `ignoreDefaultArgs:['--hide-scrollbars']`; `report-r6-native-scrollbars-pass.json` records the first successful three-case affected probe.

## Limits

No real archive/restore/delete submission, live broker/provider action, paid capability, or whole-plan acceptance was tested or inferred. Root's build, Node model tests, primary browser journeys and action mutation tests are separate evidence and were not counted as independent checks here. Battles remains deliberately unavailable because no corresponding report source is configured.

The underlying Analytics report at native-scrollbar 360px has an existing 11px content horizontal overflow (scrollWidth 298, clientWidth 287), already present before opening Type and unchanged after it closes. This receipt accepts bounded popups and no additional overflow; it does not claim that underlying report layout overflow was removed. `report-r8-baseline-content-overflow.json` and `overflow-probe.json` retain the baseline finding separately.
