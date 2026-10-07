# Independent compact-chart control review — 2026-10-07

PASS on the three source hashes recorded in `chart-compact-review.json`: LegacyReplayToolbar.css, chart-legacy.css and LegacyTradingBar.jsx.

Four guarded local browser cases passed: dark/light at 1368×790 and 360×844. Local GETs and browser-local chart preferences only; activity requests receive nonpersistent matching receipts, other writes/external requests are blocked and WebSockets closed. No reviewer product-source edits/commits, owner replay steps/orders or external FX changes. Final page errors and unexpected blocked requests are empty.

## Baseline and result

`chart-compact-baseline.json` confirms the original replay menu parent was 264px while its child was 132px. Final parent is 146px with a 132px child and 14px total padding/border, eliminating the unused horizontal space. Placement stays within the viewport. Home/End navigation skips disabled intervals; Escape returns focus to the opener. Selecting 5m updates the label and reopening focuses its selected entry.

The native interval is a div[data-role=button][data-value] with an isActive class, not an aria-pressed button. Baseline active 1m and its text descendants computed white. Final 1m→5m selection has exactly one active interval; native text and descendants compute #5695FE in dark and #2962FF in light, with weight600 and active background. Hover keeps that selected color. Desktop uses the native 5m button; mobile uses the native dropdown's “5 phút” item. Color assertions allow the existing transition to settle.

Baseline positions opened at 230px but reopening after a short resize retained only 130px. Final chevron opens to a responsive minimum: 296px desktop and 301px mobile in these cases. A remembered130px panel is raised to that minimum. A larger actual pointer resize (346px desktop, 351px mobile) is retained through close/reopen and maximize→collapse→reopen. Native chart height stays at least240px, footer stays in viewport, and no document horizontal overflow appears.

## Evidence and limits

`chart-compact-review.mjs` is the reproducible guarded runner. The JSON contains menu geometry, native selected styles, remembered-height outcomes and exact source hashes. Eight final menu/positions screenshots are saved beside the receipt. Desktop dark menu, mobile light menu and mobile light positions screenshots were inspected directly.

This receipt covers the three owner notes and their local UI behavior. It does not re-certify replay execution, SL/TP, fullscreen API, persisted chart save, owner playback or external FX behavior. The baseline and earlier receipts remain historical; this checkpoint records only the reviewed files and scope.
