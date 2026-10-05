# Independent Legacy chart layout review — 2026-10-05

Accepted for the requested FX Replay Legacy layout adaptation using the existing authorized Advanced Charts v23.040. This acceptance covers local layout and the preserved replay interactions; it does not close full U4, the whole product, broker/provider/deploy gates, historical calendar integration or complete manual WCAG certification.

Final seven-file source composite SHA256: `2609c777d80a587dd33e270850ddc67fda78cd068753378c92a75f48789f750e`. Exact individual hashes are in `final-light-delta.json` and `final-768-delta.json`; both match before/after on the frozen final source. Files: TradingViewReplayChart.jsx, advancedReplayDatafeed.js, ReplayWorkspace.jsx, ChartWorkbench.css, ChartFloatingToolbar.jsx, ChartIcon.jsx and public/chart-legacy.css.

The independent reviewer edited only scripts/reports in this artifact directory, used isolated test contexts, and performed no API writes, vendor/product source edits, commits, broker actions or provider requests. Memory lookup returned no relevant match; no memory-derived facts were used.

## Reference and source

Reference inspected: `C:/Users/MIIKEY/AppData/Local/Temp/codex-clipboard-009b26b2-c85b-4d03-9fab-5c448286fb4e.png`. The implemented structure matches the relevant composition: one native header, black flat pane/rails, native favorite intervals/full tools, compact floating replay, right quick actions, rounded Buy/Sell/size and bottom Analytics/account.

Reviewed native custom-header hosts and React portals, current-theme restoration, metadata refresh retaining dataset items, cross-document focus ownership, supported interval additions, toolbar insets/compact minimum, button DOM order, responsive rail scroll, palette/contrast and fallback header behavior. The vendor distribution was not modified; appearance lives in application-owned CSS. Host placement intentionally depends on the pinned local v23 header grouping.

The API retains session/revision/dataset/cutoff/execution authority. Portal actions call existing local state/routes. The native datafeed still receives only the API-visible prefix and causally aggregates supported higher intervals. New3-minute/2-hour favorites do not introduce unsupported lower intervals or provider history. The speed slider and selector share the existing replay speed state. Journal and Analytics links preserve workspace/session/cursor. Native layout persistence and historical write locks remain in place.

## Independent evidence

- Initial `review.json`: six actual GET-only QA8020 cases, dark/light at1440/768/360, pass one native header at y0, exact pane/rail palette, rounded trading controls,61 causal visible bars, zero page overflow, synchronized replay speed, real order/news panels and native-portal keyboard focus return.
- Successful actual journeys verify native portal theme updates both shell/pane and preserves context action/focus;3-minute native aggregation yields21 causal buckets with correct partial final bucket; GoTo20 opens actual historical API state with21 visible bars and no future payload; Buy is disabled; the header survives the history remount; Journal/Analytics retain cursor20; missing local library leaves outer navigation available and renders the actual Lightweight rollback.
- Five focused adapter/storage tests pass. No page errors or API writes/external requests occurred during independent runs.
- Initial visual/axe review found and returned concrete defects: insufficient Buy/Sell text contrast, light rail caption contrast, a mobile floating/Volume collision, tablet theme access and bottom Balance visibility. Parent repaired them. Earlier receipts retain those failed findings; they are not counted as clean accessibility evidence.
- `final-delta-light-contrast-failure.json` preserves three passing dark delta cases and the remaining light CSS specificity failure. Final delta repairs were reviewed in source: darker teal/red keep white-text contrast above4.5, hover preserves those colors, explicit light caption tokens win the prior rule, theme is available in the rail at/below1100, mobile floating minimumy120 clears Volume bottom113, bottom DOM order is Buy→Sell→Size, and mobile Balance remains visible.
- Final frozen `final-light-delta.json`: three light widths pass outer-page and actual native-iframe axe WCAG2A/AA,2.1AA,2.2AA tags with zero violations, single-header layout, hover contrast, legend clearance, visible Balance and working theme control.
- Final frozen `final-768-delta.json`: dark/light768 pass the same assertions and zero outer/native axe violations. The duplicate quick-action strip is hidden below900; the existing right rail retains all actions and theme. Source deltas affecting only light specificity/compact layout are scoped against the earlier dark receipts, without repeating unrelated journeys.
- Reviewed final light360, dark768, initial/final desktop composition, historical/fallback and parent actual native zoom200 screenshots. Mobile replay clears the full native Volume legend; Buy/Sell/Analytics/Balance remain visible. Parent final-r3 reports eight actual GET-only journeys with zero page errors; final-zoom reports six real native browser zoom cases, including125/200 percent, with scoped PASS. The review includes those reports/screenshots; independent viewport cases are not mislabeled as native zoom tests.

## Remaining limits and deliberate choices

News currently opens an honest empty state because no historical calendar source is integrated for this OHLC dataset; it provides access to dataset details and does not fabricate historical events or markers. Native layouts remain browser-local. Intervals shown are those supported by the dataset adapter, rather than copying unsupported D/W/M entries from the reference. API data and UTC semantics were retained instead of replacing them with reference-market labels or data.

This is automated scoped accessibility evidence, not a manual screen-reader or every-native-dialog certification. No large-data/long-duration performance, broker/order-flow/depth, calendar-provider, public deployment or whole-product acceptance was performed. The proprietary local library remains separately mounted and outside build output/Git.

## Receipt pointers

Independent: `review.json`, `final-light-delta.json`, `final-768-delta.json`, `final-*.png`, `goto-20-history.png`, `missing-asset-rollback.png`.

Parent integration: product `.artifacts/legacy-chart-20261005/final-r3/report.json` and `.artifacts/legacy-chart-20261005/final-zoom/report.json`, with the inspected zoom screenshot `replay-dark-zoom-2.png`. Canonical project state remains owned by the parent checkpoint/ledger; this review does not modify it.
