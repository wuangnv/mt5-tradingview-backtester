# Independent Legacy controls refinement acceptance — 2026-10-05

Accepted for this local UI/calendar slice. No blocking issue found in the reviewed runtime. This receipt does not represent whole-product, provider, broker, deployment or historical-news acceptance.

## Reviewed source

Composite SHA256: `b32ebfa218248a7d43597cf04b4ee3af0db67a5805b11a1769d8056939b4d6b8`.

Seven-file scope, exact per-file hashes retained in `review.json`: `TradingViewReplayChart.jsx`, `advancedReplayDatafeed.js`, `ReplayWorkspace.jsx`, `ChartWorkbench.css`, `ChartFloatingToolbar.jsx`, `ChartIcon.jsx`, `public/chart-legacy.css`. Fingerprints matched before and after both browser harnesses. Current vendor is authorized local v23.040; vendor source was not changed by this reviewer.

## Independent evidence

- `node --test tests/advancedChart.test.mjs`: 7/7 PASS independently, including causal aggregation/history, rewind generation invalidation, calendar boundaries and calendar realtime partial-month updates.
- `review.mjs` / `review.json`: actual UI5180 and QA API8020, tenant-a session `39b1d068edd64e75864f692f27237852`. Six dark/light ×1440/768/360 states: zero document horizontal overflow, zero top/native WCAG axe violations, zero page errors and zero blocked external/write requests.
- Actual native D/W/M datafeed requests each produced one partial calendar candle. `control-delta.json` independently compared the entire OHLCV against all61 actual API-visible source bars: UTC Jan1 bucket1704067200000, O1.1/H1.1038/L1.0997/C1.1032/V6100. LeapFebruary and ISO Monday/year-boundary expectations are separate synthetic fixture evidence, not claims about this61minute QA dataset.
- All six app-owned shortcut buttons selected their exact public native tools and actual pointer gestures created trend_line, horizontal_line, rectangle, fib_retracement, long_position and short_position. Shape identities are recorded in `review.json`; no simulator or broker order was placed.
- Native object tree actually rendered pointer-drawn rectangle row: `object-tree-waited.png`, `control-delta.json`. The earlier `object-tree.png` was captured before asynchronous rows appeared; its empty body is not a failure claim or final visual evidence. Actual tree text in the first run listed all six drawings.
- Client-only screenshot downloaded `WMReplay-EURUSD-1-cutoff-1704070800.png`, PNG magic verified,1356×899,82171bytes; image inspected. It contains native chart/drawings and excludes app-owned toolbar/rails as expected for the public client chart screenshot API. No upload/external request occurred.
- Delayed client screenshot resolved after native resolution changed: no stale download; visible “Chart đã đổi; chụp lại tại mốc mới.” notice. Evidence: `stale-png-fence.png`, `control-delta.json`.
- `metrics.mjs` / `metrics.json`: six states have zero replay/favorite toolbar overlap, remain inside viewport/right rail and clear the left native rail. Compact toolbar positions are below the native volume legend. Four icon-only app rail controls have18×18SVGs, exact vertical center alignment (maxdelta0CSSpx). Bottom controls use Arial with consistent32pxbuttons/30pxinput.
- Visual inspection of dark1440/768, light1440/360, waited tree and downloaded PNG confirms flat pane, one native header, legible hierarchy, aligned rails/account controls and fixed default toolbar collision. At360px the native chart is necessarily narrow between drawing/utility rails; controls remain usable through existing compact/scroll/collapse behavior. Six baseline screenshots are retained.

## Decisions and limits

Calendar candles group only the API-visible causal prefix; a partial day/week/month remains partial. Replay advances source dataset bars, not selected display-timeframe candles. This protects existing fill semantics.

Drawing shortcuts are app-owned using the public native `selectLineTool` contract, avoiding undocumented vendor favorite settings. Long/short position drawings are informational native drawing tools. Workspace API notes retain a separate owner.

PNG uses `takeClientScreenshot`; native screenshot/upload remains disabled. Existing historical cutoff/order locks and readonly/API authority were not relaxed by this slice. Historical news still has no dataset-linked source and remains an honest empty state.

Root-reported build, scoped browser10groups, six native zoom states and disposable integration14groups are supplementary evidence owned by root; they were not independently rerun here. This reviewer changed only review artifacts and did not commit or edit product/API/vendor files.
