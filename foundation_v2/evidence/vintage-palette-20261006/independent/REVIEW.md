# Independent vintage palette review

Status: **PASS_SCOPED_VINTAGE_PALETTE** after owner r4 contrast fixes and r5 Advanced Charts volume/imported-annotation fixes.

Final verification on stable source:

- 38 desktop route/theme cases, including actual API readers and separate demo preview; 8 WCAG Axe scans without violations. Exact palette roles, route aliases, primary/muted contrast, transparent menu/nav hover, continuous Analytics underline, dropdown scrollbar and overflow assertions passed.
- 16 same-page demo→actual→demo cases covering 8 preview routes and both themes; palette/contrast checked after every transition, 4 additional Axe scans passed. This exercises lazy-loaded styles within the same document. Route nav links reload the document; they do not share a SPA CSS cascade.
- 8 chart engine/theme/viewport cases: lightweight and Advanced/legacy, dark/light, 1377/360. Background, up/down candles and primary annotation pixels verified before and after UI theme switching. Four app-owned annotation records and 61 visible rows checked; no chart write controls used.
- Final screenshots inspected for Dashboard, Analytics, Live, Research, Risk, Trade draft, Learn, Settings, desktop/mobile charts and Advanced dark→light. No overlap introduced by palette change; existing mobile chart toolbar geometry is unchanged.

Source hashes stayed stable during each final run. Between route/lazy verification and chart verification, only `src/TradingViewReplayChart.jsx` changed; that file is fully covered by the final chart pass. Final pins are recorded in `final-receipt.json`.

The initial exploratory run retained 75 successful desktop/mobile cases and one Analytics light contrast failure on London Breakout. It ran across owner source revisions and is not represented as final stable-source acceptance. The contrast failure was fixed and independently rechecked. Initial chart oracle failure was a fixture limitation: original fixture contained only up candles. Final chart review lowers every fifth close within its original low/open in memory, and explicitly returns unavailable tick status. Product/fixture files were not modified.

Screenshot inspection found Advanced Charts volume and imported drawings retaining native bright colors despite candle/background assertions passing. Owner r5 fixed volume study roles and app-owned annotations. Final native chart screenshots show sage/rose volume, sea-blue line/text/zone, correct candles and labels after theme switch.

Native saved drawing preservation is source-reviewed: only app-owned imported IDs are removed/recreated, native user shapes are not enumerated for removal or recoloring. This read-only review did not create/save/mutate native drawings, so that scenario is not claimed as runtime verified.

Actual endpoint unavailable/empty states remain honest and are captured in reports. This receipt accepts palette/UI scope only; it does not accept broker/provider connectivity, data calculations or whole-product functionality. All observed requests were loopback GET/HEAD/OPTIONS; WebSockets, external origins and writes were blocked. No source edits, commits, server starts or API writes were performed by this reviewer.

Evidence: `final-r4/report.json`, `lazy-r4/report.json`, `chart-report.json`, final screenshots and `final-receipt.json`. Exploratory reports and pre-r5 chart screenshots are retained separately (`report.json`, `chart-r4/`, `chart-initial-oracle-report.json`).
