# Independent library search parity review — 2026-10-07

**PASS: 4 viewport/theme cases, 12 state comparisons against Dashboard.** Dark/light at 360 and 1710 px; rest, hover and keyboard focus for each. No remaining finding in this CSS scope.

Run from product root: `node foundation_v2/evidence/offline-library-search-20261007/independent/review.mjs`. Full computed styles, geometry, traffic and hashes are recorded in `review.json`; screenshots capture both pages for each state.

Verified real local Dashboard versus real empty data library. Strict equality across border radius, height/min-height, padding, border width/style/color, background/text colors, font family/size/weight/line-height, outline and box-shadow. Placeholder color/opacity and icon dimensions/color/position also match. Focus was reached using Shift+Tab then Tab and `:focus-visible` confirmed; hover was removed before the focus comparison.

- Radius 999px; height/min-height 44px; left padding 38px; no outline or inset ring.
- Library width 420px desktop and 270px at 360px viewport.
- Search icon 16×16px, left inset 12px, vertical center difference 0px.
- Neutral hover/focus border matches Dashboard in both themes; placeholder opacity 1.
- Zero document horizontal overflow, page errors or blocked requests.

Initial review found library inherited line-height 19.5px while Dashboard used normal. Parent added scoped `line-height:normal`; final strict rerun passes all states. Historical report retained as `before-line-height-fix.json`.

Inspected final visual screenshots: `dark-1710-market-data-focus.png`, `light-360-market-data-hover.png`, `dark-360-overview-focus.png`. Both search fields have matching pill shape, neutral interaction treatment and centered icon/text.

Reviewer edited only evidence. Fresh browser contexts; no personal browser profiles. Local GET/HEAD/OPTIONS only; writes, provider/MT5/Live endpoints, external origins and WebSockets blocked. Observed actual API traffic was datasets and Dashboard overview/replay-session GETs only. No dataset, API key or provider research acceptance is implied.

Final source SHA-256:

```text
data-library.css 52dd62144ba60af4554b708afc94a875c981e9cc1650b139c081afb649e5aa2f
dashboard.css fffcd98b339256e462134731634480cc9aefdfb54b8dad9f82fedf95c65920f0
```
