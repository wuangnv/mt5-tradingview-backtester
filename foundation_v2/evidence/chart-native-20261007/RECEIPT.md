# Native chart palette and branding — scoped receipt

07/10/2026. Owner requested normal, strong chart colors independent of the application palette and confirmed rights to hide the TradingView logo.

## Implementation

- Advanced Charts pane/scale/candle/HA/bar/line/area colors now use `nativeChartPalette`: dark #131722, light #FFFFFF, teal #26A69A, red #EF5350, blue #2962FF. Order lines and imported annotations use the same chart-only roles.
- Removed project-palette import/toolbar overrides from the application-owned iframe stylesheet. TradingView supplies its native theme; the React portal header controls use matching native text/hover/focus.
- Existing saved layouts repaint on readiness and theme changes, including restored Volume studies. Native interval, drawings, causal cutoff and scoped local snapshots retain ownership.
- Disabled the pinned v23 `widget_logo` featureset through constructor options. No vendor source/assets changed.
- Native surface role supplied for the lightweight fallback primitive (fallback integration owned by root).

## Research evidence

Official current customization page https://www.tradingview.com/charting-library-docs/latest/customization/#tradingview-logo states logo visibility depends on the license agreement. Rights were explicitly confirmed by the owner in this task.
The local authorized v23.040 featureset registry defines `widget_logo`; the branding renderer checks it for library branding. The logo is canvas-rendered, so CSS hiding/DOM removal would not be appropriate. The app uses the existing configuration mechanism.

## Validation

- `node --test tests/advancedChart.test.mjs`: 7 passed (datafeed causal prefix, aggregation, rewind, precision, snapshot cutoff isolation).
- `npm run build`: passed.
- `node foundation_v2/evidence/chart-native-20261007/verify.mjs`: actual local service, read-only API network guard; 1710/768/390 widths; dark initial, saved old pastel layout restore with native drawing/Volume/interval retained, light toggle + reload; 9 checks, no page errors.
- Visual review: native dark desktop and light mobile screenshots show strong native candles/axes and no logo. Screenshot + constructor option together verify branding removal; no DOM-logo assertion is used because v23 draws it into canvas.
- Script instruments widget constructor in its isolated QA browser to inspect the public save API; no app source test hooks are added. Test-old layout exists only in its temporary browser localStorage.

## Boundaries

The root's timing hook is concurrently active. This chart-only run blocks activity POST requests and therefore intentionally shows the retry notice in some screenshots; timing API acceptance belongs to root. External vendor analytics GET is also blocked. No simulator/broker mutation, external upload, user browser profile or persistent backend writes.

Local full saved-layout diagnostic and probe are not needed in a compact commit; preserve locally. Independent root review is still required for integrated acceptance.
