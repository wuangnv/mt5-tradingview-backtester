# WMREPLAY visual comparisons

These tests cover four session-first Testing routes with an explicitly labeled, fixed synthetic fixture. They do not exercise the real API, chart, W6, market data, broker or long-session behavior. Existing real-API journey tests remain separate acceptance evidence.

The fixture was captured from the isolated QA replay engine baseline (60 closed trades, USD75), reduced to one catalog session, given a visible `Fixture UI` name and fixed overview timestamp/inventory. No session token, cookie or secret is stored. All APIs are intercepted, writes and external requests rejected. Source/fixture hashes, browser, locale and viewport are saved with each capture. Exact required viewports are 1440x900, 1280x800, 768x1024 and 390x844, dark/light; metrics and ledger get additional scrolled checkpoints.

From the TradingWorkspace root, using the already installed pinned Playwright 1.63.0 worker kit:

```powershell
$env:TW_VISUAL_ORIGIN='http://127.0.0.1:5180'
$env:TW_VISUAL_CANDIDATE='1'
node tooling/ui-qa/node_modules/@playwright/test/cli.js test --config projects/mt5-tradingview-backtester/foundation_v2/web/tests/visual/playwright.config.mjs
```

Candidate mode writes only `.artifacts/wm-visual-comparison/candidate/` and marks every capture `CANDIDATE_NOT_APPROVED`. Repeated byte equality is determinism evidence only. Before promotion, freeze the integrated source, inspect all representative candidate images at their exact viewport, compare to prior same-contract baselines if present, review behavior/quality evidence, and record agent delegated approval with the fixture/source hashes and approved image hashes. The old W8 candidate uses different fixtures/selectors and is historical reference, not a pixel oracle for this session-first fixture.

After that review, explicitly copy only each approved image (never `-repeat.png`) to `tests/visual/baselines/<project>/<image>.png`, using the identical filename/project folder from the candidate. Do not use a wildcard copy that promotes unreviewed candidates. Keep the approval receipt with the baseline. No initial baseline is silently created; CLI `--update-snapshots` is blocked.

Comparison command:

```powershell
Remove-Item Env:TW_VISUAL_CANDIDATE -ErrorAction SilentlyContinue
node tooling/ui-qa/node_modules/@playwright/test/cli.js test --config projects/mt5-tradingview-backtester/foundation_v2/web/tests/visual/playwright.config.mjs
```

This uses `expect(page).toHaveScreenshot()` against the reviewed baselines, fails when missing, and saves actual/expected/diff plus a trace on failure. No masks are applied. `maxDiffPixels: 0` intentionally requires the same pinned Windows/browser/fonts/DPR1/reduced-motion environment; do not raise tolerance to conceal changes. Cross-machine raster changes require a reviewed environment update. Never interpret a pixel match as independent product acceptance.
