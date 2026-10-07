# Independent positions-control polish review — 2026-10-07

PASS on the final source recorded in `positions-review.json` (six SHA-256 source hashes). This is a separate receipt; earlier chart-polish and consistency receipts remain historical.

## Validation scope

Six real local GET cases: dark/light at 1368×790, 360×844 and 1920×940, each with normal and maximized positions. Two response-only fixtures supply 35 closed trades for pagination. Two deterministic telemetry regressions force Math.random=0 on default blob and optional srcdoc.

The reviewer changed no product source or commits. All mutations were blocked except activity requests fulfilled in the browser with matching nonpersistent receipts. WebSockets were closed. The trade fixture replaces only the GET response in an isolated context and sets the execution cursor to the requested cutoff; no real orders, replay steps, owner records or external FX actions occurred.

## Verified result

- Native/custom header and native left drawing-tool buttons use 6px radii. Full header width and no horizontal document overflow at each viewport.
- Replay and positions grips retain the same background, text color, shadow and filter on hover.
- Quantity input and both spinner buttons have outline-style:none. The outer group retains a single 2px project-primary focus edge at offset −2px.
- Positions tabs have transparent hover background, text highlight, a top separator and active bottom border spanning the whole button. No SIM label remains. Keyboard End selects the closed tab.
- Table header background differs from the chart/table body in both themes: project-raised provides a visible surface distinction.
- Pagination footer reaches the viewport bottom in both normal and maximized states. Rows-per-page remains left and navigation right, including 360px without overlap. The footer has one top separator.
- Maximizing positions hides the replay toolbar so it cannot obscure/intercept tabs. Tab clicks work at 360px and replay toolbar visibility returns on restore.
- The 35-trade fixture has four pages at size10 (last page five rows), two at size25, and one at size50. Direct page selection, previous/next disabled states, size-change reset to page1, and row ranges passed in both themes.
- Forced vendor telemetry sampling causes no external request or page error in blob or srcdoc after disabling pinned-vendor feature `14851` through widget configuration.

Final counts: six visual/geometry cases, two pagination fixtures, two forced-telemetry cases. Zero page errors and zero blocked unexpected requests. Representative desktop dark/light, mobile maximized and populated fixture screenshots were visually reviewed. All normal/maximized screenshots and fixture images are saved beside the report.

## Failure → correction evidence

`positions-attempt1-spinner-focus.json`: independent review found a remaining inner focus outline on spinner buttons; root suppressed it while retaining the group focus edge.

`positions-attempt2-light-header.json`: header background used project-surface, which was white like the chart body in light mode; root switched to project-raised.

Mobile screenshots exposed the replay toolbar covering maximized position tabs; root hides it during maximization and restores it afterward. Final click and visibility assertions passed.

`positions-attempt3-vendor-telemetry.json`: all positions/fixture assertions passed, but pinned vendor's 2% telemetry branch attempted Google Analytics and failed to parse about:srcdoc URL. Source inspection established the exact branch `enabled('14851') && Math.random() <= .02` in the vendor bundle. Root disabled that feature in TradingViewReplayChart without editing the vendor. Final deterministic sample=0 regressions passed on both transports.

An exploratory fixture timeout came from Playwright selectOption('3') matching displayed page3 (value2). The final test explicitly selects `{value:'3'}` and verifies displayed page4, row range31–35. No pagination source fix was needed for that test defect.

## Limits

This receipt covers the requested visual and local pagination slice. It does not re-certify execution/SL/TP, owner playback, download/clipboard permissions, external FX behavior or exact pixel identity. Synthetic trade data is identified as a fixture, separate from owner data. The source hash manifest is the precise checked checkpoint.
