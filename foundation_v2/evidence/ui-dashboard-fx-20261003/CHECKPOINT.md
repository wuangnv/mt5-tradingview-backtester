# Dashboard rebuilt from owner FX Replay reference — 03/10/2026

Scope: Dashboard first, one page at a time, plus the reported shared subnav hover. The latest explicit owner request supersedes the earlier compact/flat Dashboard arrangement. No other page redesign, backend aggregation change, provider/broker permission, golden promotion or whole-product acceptance.

## Behavior and state ownership

- Three entry actions restore Backtesting session, Prop firm session and Tutorials, reusing existing routes. Fresh replay clears stale session/dataset/cursor/cutoff context. Creation and management backend mutations are not exercised in this GET-only preview.
- Performance calls the existing typed `/api/v2/overview` read model. Aggregate/session scope and UTC close-date range are separate from Recent Sessions search/status/sort/page. URL parameters persist both scopes through reload. Scope changes hide prior metrics immediately and abort superseded reads.
- Four meaningful metric surfaces, monthly trades at right, monthly win rate and symbol breakdown below match the supplied FX composition. Duration telemetry remains unknown because both API duration fields are null; the main plot uses actual trades rather than estimated hours. Archived inclusion and branch-lineage deduplication remain explicit. No mixed-currency P/L aggregate is invented.
- Recent Sessions shows six rows per page, search/status/sort, actual context and resume eligibility. Result selection drives Performance. The menu opens existing revision-aware rename/duplicate/archive/restore workflows; it has Escape and focus dismissal and never performs direct writes. Archived/missing datasets cannot resume.
- Replaced obsolete Dashboard CSS instead of stacking a second layout. Removed retired Dashboard-only interaction rules. Shared subnav now exposes hover, active and keyboard focus with existing project tokens and reduced-motion behavior.

## Verification

- Final web unit suite: **82/82 PASS**; focused Dashboard suite: **11/11 PASS**. `npm run build`: **81 modules PASS**, existing large-chunk warning retained. `git diff --check` clean.
- [Dashboard journeys](journeys/report.json): **PASS** on actual isolated GET services plus explicitly separate fixtures; no page errors or writes. Actual API oracle: **60 unique closed trades / 100% / EURUSD / Jan2024**, partial **7/25** readable sessions, durations null. Covers independent filters, pagination/search/sort/reload, scoped links/menu dismissal, actual **61-candle** replay resume/reload, Analytics routing, custom dates and last30days empty scope.
- Fixtures separately cover multiple months/symbols, archived/completed, delayed stale-scope response, inverted dates, empty/blocked/partial/malformed/error/retry, missing dataset, long320px name and catalog recovery. They do not prove new backend behavior.
- [Final route/axe/reflow scan](routes-final/report.json): **10/10 SCOPED_PASS**, dark/light at1598/1440/768/390/320px; no page/content overflow, unresolved ARIA, violations, page/HTTP errors or unexpected requests. Axe incomplete rules remain in the report; no full WCAG certification.
- [Final native zoom](zoom-final/report.json): **6/6 SCOPED_PASS**, both themes125%/200%/100%; stable source before/after in both final reports: `51eb0cfd95bec3d212e92b65a1828ef70140a74d04f2f10bfb841f4968c786d1`.
- [Final interactions](interactions-final2/report.json): **8/8 PASS**, pointer/keyboard picker, Escape/outside dismissal, URL selection/reload, selected row, settled blue result-button text/border, focus/reduced motion, axe and simulated native fallback. No errors or blocked requests. Original `interactions/report.json` also passed8cases before strengthening the settled-button assertion; it remains separate.
- Independent `support_patterns` source/visual review: **SCOPED_ACCEPT**, latest owner image `codex-clipboard-0bb4fe19-7d3b-4ebd-8c67-22f90fd326df.png`, representative desktop/mobile/theme/chart/picker/long-name images and domain contracts. Review receipt is copied alongside this checkpoint after final closure.

## Findings and repaired attempts

Root and independent reviewer found search icon/text overlap: the generic control selector was stronger than the search-padding rule. Increased only its scoped specificity and added padding regression verification; fresh light320/dark390 images are clear. Corrected the selected result-button color/border specificity by the same reasoning; selected row, checkmark and pressed semantics remain.

Initial route/zoom receipts (`routes/`, `zoom/`, source `cba2bf87444233d6e62d6d49ec28919e71811987f30f6855833b489de421929b`) predate these two fixes; final replacements above own the final hash. The first strengthened button-color probe (`interactions-final/report.json`) failed because it sampled color and border during their140ms transitions. The harness now waits for its actual animations to finish and samples one computed style. Product source was unchanged for that harness repair; the failure is retained.

## Runtime and limits

UI5180 PID21100/API8020 PID16624 remain listening on the existing isolated synthetic QA database and GET-only adapter; no reseed or backend mutation. Other engines were not run; native fallback is simulated by removing progressive CSS in Chromium. Creation/archive/rename/branch writes were not tested here; their existing workflows remain owners. Whole-product gates, canonical golden/shared-system promotion and runtime ledger/STATE stay unchanged. VI remains deferred.

Resume: owner can inspect Dashboard at `http://127.0.0.1:5180/?workspace=tenant-a&view=overview&area=testing&section=dashboard`. Continue another page only within the next owner request; this checkpoint is evidence, not a competing tracker.
