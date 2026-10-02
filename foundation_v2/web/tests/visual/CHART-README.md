# Actual replay chart visual comparisons

This is a separate chart-only fixture and harness. The existing four-route suite is unchanged: its `replay-top.png` still means Sessions (`select=1`). Chart uses `view=replay&surface=workspace` with no session-picker flag.

`chart-fixture.json` derives from GET-only reads of the isolated QA canonical session at cursor 60 and historical cursor 20. Exact OHLC, volume, timestamp prefixes, dataset hash and advertised cutoffs are retained. Fixture identities, names and audit timestamps are stable; execution ledger data is omitted because the fixture makes no financial claims. Four actual API drawing templates retain their time/price anchors, with fixture run IDs, explicitly labelled names and creation cutoff remapped to 60. This is synthetic visual evidence, not proof that those annotations exist in the canonical session.

Regenerate only when that explicit source snapshot is deliberately changed. The capture script verifies the known disposable DB/scope, uses GET only, checks canonical revision123/cursor60, and rereads the session to assert it is unchanged. It writes only this fixture and source receipt. It does not create sessions, draw into the API, send orders, read holdout or contact a provider.

```powershell
node projects/mt5-tradingview-backtester/foundation_v2/web/tests/visual/capture-chart-fixture.mjs
```

`fixture-source.json` under `foundation_v2/evidence/wm-all-plan-20261002/chart-review/` pins request response hashes, real drawing templates and transformations. The browser suite intercepts every API; it aborts external requests, WebSockets and any write. Unimplemented API routes fail instead of silently returning empty data.

Capture into fresh attempt folders so failed runs remain intact:

```powershell
$env:TW_VISUAL_CANDIDATE='1'
$env:TW_CHART_OUTPUT_ROOT='D:/ANNAM/TradingWorkspace/.artifacts/wm-all-plan-20261002/chart-capture-r3'
$env:TW_CHART_CANDIDATE_ROOT='D:/ANNAM/TradingWorkspace/.artifacts/wm-all-plan-20261002/chart-candidate-r3'
node tooling/ui-qa/node_modules/@playwright/test/cli.js test --config projects/mt5-tradingview-backtester/foundation_v2/web/tests/visual/playwright.chart.config.mjs
```

The eight projects reuse the existing pinned browser/Windows/locale/timezone/DPR/reduced-motion configuration. Three images per project cover the current full viewport, current chart frame and historical chart frame. Before each capture the test asserts the exact visible-row/object count, OHLC/timestamp accessible summary, readout values, cutoff slider bounds, fitted logical range and an actual rendered crosshair sample. Historical view has 21 bars, no annotations created at cutoff60, disabled forward mutation controls, and reload retains cutoff20. Every intercepted session payload is checked as a strictly ordered prefix; source must remain unchanged.

Candidate repeat equality only establishes deterministic rendering. Reviewer approval must identify every exact image/hash. Root may then explicitly copy those approved images to `chart-baselines/<project>/<name>` and save a separate promotion receipt. This chart directory is distinct from the existing four-route baselines. CLI snapshot updates remain disabled; no masks or tolerance increases are used.

```powershell
Remove-Item Env:TW_VISUAL_CANDIDATE -ErrorAction SilentlyContinue
node tooling/ui-qa/node_modules/@playwright/test/cli.js test --config projects/mt5-tradingview-backtester/foundation_v2/web/tests/visual/playwright.chart.config.mjs
```

The comparator fails when a baseline is missing, and uses exact `toHaveScreenshot` matching. Golden scope excludes alternative chart types, down-candle palette (the canonical synthetic rows all rise), all gesture/drawing persistence workflows, complete manual WCAG, real market data and sustained heap/frame acceptance. Those need their own evidence; this fixture does not close all W4/W7/W8 gates.
