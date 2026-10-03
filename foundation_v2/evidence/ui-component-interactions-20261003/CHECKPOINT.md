# Component interaction refinement — 03/10/2026

Owner feedback: selectors and child components still felt basic after the cross-page layout migration. This slice completes their interaction states without changing the chosen page patterns.

## Behavior and state

`component-interactions.css` adds consistent hover, keyboard focus, pressed, disabled, disclosure-open and persistent selected-record states. Dashboard marks the actual selected result row with tint/outline and a checkmark; Data and Prop selection buttons expose `aria-pressed`. Selection styling survives hover. Color transitions last140ms and respect reduced motion; no decorative left stripe or nested card is added.

Native selects retain options/value/onChange, type-ahead, keyboard selection, Escape and outside dismissal. Supporting engines use `appearance:base-select` with a themed picker, selected-option checkmark and rotating arrow. Dashboard/Session selectors use the native inert button/selectedcontent to keep long closed labels at44px with ellipsis; full labels remain visible in the picker. The768px Dashboard scope label cannot shrink or wrap.

The data path remains existing selected session/dataset/Prop state → existing handler → existing URL/request/metrics. No service, financial calculation, revision, cutoff, provider or broker contract changes. All real runtime checks use the existing isolated synthetic QA workspace and GET-only adapter; intercepted-write fixtures remain labeled separately.

## Decision and limits

[MDN customizable select](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Forms/Customizable_select), consulted03/10/2026, documents limited support. Progressive CSS keeps native controls on unsupported engines and avoids a new JavaScript combobox dependency. Installed Chromium supports the richer picker. Native fallback is simulated by removing progressive CSS; Firefox/Safari were not run. The user in-app browser attempt timed out, so its personal tab is not claimed as verified. Automated axe results do not certify complete WCAG compliance, including incomplete overlapping-select contrast observations.

## Validation and source scope

Final frontend fingerprint: `a6bc415e5385031b2944e639535a4599cc9fa074f9d384c7b1ec80f9abdf4f9e`.

| Receipt | Observed scope |
| --- | --- |
| `overview-final/report.json` |8/8real Dashboard theme/width/reflow/axe cases,1440/768/390/320px; matching final before/after hash |
| `overview-zoom-final/report.json` |6/6native Dashboard zoom cases,125%/200%/return100% both themes; matching final hash |
| `controls-final6/report.json` |8/8real interaction scenarios;20screens including loaded768/320px captures, one-line label assertion, no errors/blocked requests/axe violations |
| `build-final4.txt` | Vite build PASS,81modules; existing >500kB bundle advisory remains |
| `unit-final2.txt` |80/80web tests PASS before the final label-only CSS fix |
| `routes-final2/report.json` |32/32Overview/Sessions/Analytics/Trades cases after native selectedcontent/inert repair; stable `f9925f7a…` before label-only fix |
| `routes/report.json` |144/144real18-route/theme/width cases on earlier `149e65bd…`; not a144-case rerun on final source |
| `edge-final2/report.json` |6long/empty/denied catalog fixtures at320px both themes;44px triggers, full popup labels, no overflow |
| `zoom/report.json` |24native zoom cases on earlier `81e0a83c…`; final Dashboard replacement recorded above |
| `chart/report.json` |8chart renderer regression cases, five types/wheel/pan/cutoff/overlays/history, before selector-label refinement; chart source unchanged |
| `lane-receipts/populated.json` |27intercepted Journal/Risk/Trade checks and18captures; no backend mutation |
| `lane-receipts/session.json` |5real session groups/20captures plus labeled stale/partial/503 fixtures; historical cursor20 yields20trades/net25USD |
| `prop-report.txt` |20intercepted Prop lifecycle/report/CSV/denied/conflict/localNotion checks |

`controls-final4/report.json` previously passed8actual theme/width scenarios: picker opening, selected option geometry, Escape, outside dismissal, Home/ArrowDown/Enter, URL/reload state, known75USD/60trade QA results, selected row/aria/checkmark, persistent hover, focus, reduced motion and simulated fallback. The final label regression assertion and loaded tablet/mobile recaptures are recorded in `controls-final6/report.json`.

## Failures and repairs retained

- Initial controls color comparison sampled an intermediate transition; harness now waits for real animations to finish.
- Initial edge overflow check missed a239px-high long-label trigger; explicit compact-height assertion caught it. Native selectedcontent/button sizing repaired the trigger to44px.
- Native internal button target-size findings were repaired with explicit inert semantics; axe checks were not disabled.
- Independent review caught `Phiê/n` at768px. A scoped nonshrinking nowrap label fixes it; final loaded screenshots and responsive/zoom checks close that finding.
- `controls-final5/report.json` is FAIL: a new harness assertion parsed CSS `line-height:normal` as a number. It was replaced with actual text line geometry using DOM Range; no product change was made to satisfy that invalid assertion.

Independent acceptance lives in `review/REVIEW.md`; selected images are in `selected/`. Earlier attempts/screens/profiles remain local and are not broadly staged. No golden promotion, shared-system change, ledger/STATE acceptance, backend reseed or whole-product completion is claimed. UI5180/API8020 remain the existing read-only preview; VI Dubber remains deferred.
