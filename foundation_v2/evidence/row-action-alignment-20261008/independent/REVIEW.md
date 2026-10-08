# Independent row-action alignment review — 08/10/2026

PASS: actual local Library in dark theme at 1710px and 360px, GET-only.
`qa.mjs` records button/SVG rectangles for resting, hover and open states.
Ellipsis center deltas are exactly zero on both axes in all six measurements.
The desktop target is 32px and mobile target 44px; SVG is 16px, padding is zero.
Hover keeps the same target position/size; Escape closes the menu and restores
focus. Reviewed cropped hover screenshots visually: the three dots remain
centered inside the circle.

Source comparison: shared compact action group in `testing-standard.css` already
uses zero padding and 16px SVGs (detail, session action, Dashboard icon and related
controls). The former Library-specific 8px padding/18px SVG was the exception.
The fix now follows that existing contract without changing click behavior.

No actual download controls currently appear for EUR/USD, so resume/cancel icon
geometry is source-audited only in this run. The initial harness had assumed the
prior paused job remained present and timed out after ellipsis measurements had
passed; the final harness records current-state absence instead. `FAIL-*.png`
retain that pre-final runtime snapshot. This absence is not an ellipsis failure,
and no job state was changed to create a test state.

All external origins, WebSockets and writes were blocked; there were no attempted
writes or page errors. No backend restart, provider request or job transition.
Evidence: `results.json`, `dark-1710-hover*.png`, `dark-360-hover*.png`.

Run from the product root:

```powershell
node foundation_v2/evidence/row-action-alignment-20261008/independent/qa.mjs
```
