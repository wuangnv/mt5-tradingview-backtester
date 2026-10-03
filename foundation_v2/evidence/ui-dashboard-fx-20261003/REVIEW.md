# Independent Dashboard FX reference review — 03/10/2026

Verdict: **SCOPED_ACCEPT** for the reopened Dashboard direction and reviewed interactions. No remaining blocker found. This acceptance uses the owner's FX Replay image and current one-page task, not the earlier flat Dashboard approval. It does not accept other page redesigns, whole-product gates, brokers or global tokens.

Reviewer: support_patterns. Read-only source/evidence inspection; evidence receipt is the only reviewer write. No product edits, suite reruns, personal browser, backend mutations, seeding or providers.

## Reference and visual assessment

Inspected the latest actual owner reference `C:/Users/MIIKEY/AppData/Local/Temp/codex-clipboard-0bb4fe19-7d3b-4ebd-8c67-22f90fd326df.png`; the earlier c6092457 image was also inspected as historical context. The new implementation follows the latest image's composition and order: three entry actions, four metric tiles on the left of a prominent monthly chart, blue monthly win-rate and purple symbol charts below, then searchable Recent Sessions with scoped actions. The main chart uses actual closed trades because invested-time telemetry is unavailable.

Reviewed routes overview dark1598, light1440, dark768 and light320; journey dark1598-charts, light390-charts, light320-top, light320-recent, dark390-recent, light320-picker and labeled long-name320. Desktop grouping is coherent; tablet/mobile stack the plots and entry actions without page overflow. Small-screen picker text truncates in the trigger but remains available in the popup. Full labels and values remain readable in the inspected charts. The long-name fixture wraps rather than hiding or overflowing its session context.

Found a concrete specificity defect: generic control styling overrode search padding, causing the magnifier to overlap text. Root changed the scoped selector and added a padding regression assertion. Inspected fresh light320-recent and dark390-recent captures: fixed. Also identified that the selected result-button color/border selector was weaker than the generic control rule; root corrected that scoped selector. Selected row, pressed state and checkmark retain the same scope.

## Source and semantics

Read DashboardSessions.jsx, DashboardPerformance.jsx, dashboardModel.js, replacement dashboard.css, subnav hover/focus changes in fx-shell-story.css and retired Dashboard overrides in component-interactions.css. Inspected the existing overview aggregation contract and SessionPicker management intent routing.

- Overview results are keyed by workspace/session/UTC date range; scope changes immediately hide prior metrics. Abort cleanup prevents old responses replacing the new scope. Custom inverted dates block results visibly.
- Time invested and historical replay time remain unknown, matching the current API null fields. Trades/win rate come from real closed fills. The main chart uses monthly trades rather than inventing invested time.
- Actual partial 7/25 sources is exposed; blocked/null and empty zero-trade states remain distinct. UTC closure grouping, archived inclusion and lineage deduplication remain explicit in the data contract/footer/details. No currency totals across mixed sessions are invented.
- Recent list search/status/sort/pagination is independent of Performance scope; the footer says so. Query persistence supports reload. Choosing Kết quả changes the Performance session scope.
- Native details provides action disclosure, Escape/focus dismissal and links to existing rename/duplicate/archive/restore management views. Dashboard does not mutate the records. Archived or unavailable datasets do not expose a resume action.
- Existing new-backtest, local Prop and Learn routes are reused. Subnav hover/focus adds feedback while preserving active indication and reduced-motion behavior.

## Runtime reports inspected

Read `foundation_v2/evidence/ui-dashboard-fx-20261003/journeys/report.json`: PASS, actual isolated GET service journeys plus separately labeled fixtures, no errors or writes. Reviewed its harness assertions for actual 60 unique closed trades / 100% / Jan2024 / EURUSD, unknown duration, partial 7/25, independent list filtering, reload/pagination/sort, scoped links, real 61-candle resume/reload, custom UTC filters, zero-trade recent period, and late aborted scope response. Fixtures cover multi-month/symbols, archived/completed, malformed/error/blocked/empty and catalog recovery.

Read `interactions/report.json`: PASS, eight cases (both themes at 1440/768/390/320), 26 scope options, recorded keyboard selection and selected record, no overflow, axe violations, page errors or blocked requests. Native fallback is simulated in Chromium with progressive CSS removed; other engines were not run.

Initial `routes/report.json` has ten SCOPED_PASS results and `zoom/report.json` six SCOPED_PASS results, with stable before/after source `cba2bf87444233d6e62d6d49ec28919e71811987f30f6855833b489de421929b`. These precede the final two CSS specificity fixes and are retained as the baseline rather than called final-source scans. Final journeys/interaction recaptures verify the fixes; coordinator owns the final source hash and focused scan/build receipts.

Final source closure: read `routes-final/report.json` (ten SCOPED_PASS results, no failures) and `zoom-final/report.json` (six SCOPED_PASS results, no failures). Both have stable before/after source `51eb0cfd95bec3d212e92b65a1828ef70140a74d04f2f10bfb841f4968c786d1`, covering the specificity fixes.

Read `interactions-final2/report.json`: PASS, eight cases, 20 captures, no errors/blocked requests, zero overflow and reported axe violations. Reviewed the revised harness: it awaits the selected button's active animations, then samples text/border colors in the same computed-style evaluation and verifies equality. Product source was not changed for this rerun. Inspected its selected-dark1440 and selected-light768 captures as scope/loading-state evidence. The preceding `interactions-final/report.json` remains FAIL because the immediate assertion sampled colors during the 140ms transition; the passing rerun does not relabel that failure. Final SCOPED_ACCEPT remains unchanged.

## Limits

No full WCAG or cross-engine certification; automated reports and inspected screenshots establish only their scoped evidence. No backend aggregation rewrite was reviewed or required. The entire product, other-page migrations, provider costs and broker readiness remain outside this Dashboard verdict. Missing duration telemetry is intentionally exposed, not implemented or estimated by this UI.
