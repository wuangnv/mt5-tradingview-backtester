# Independent component alignment audit — 09/10/2026

Read-only inspection of current app components. Fresh Playwright contexts and local origins only. Initial scan uses GET/HEAD/OPTIONS only. Final conditional review intercepts the CSV preview POST with a local fixture, never forwards it, and aborts other writes. No provider, broker, import, restart, or source mutation.

## Coverage and evidence

`audit.json` records 60 route/theme/width samples: 15 named routes × dark/light × 1710/360. Includes reference, overview, sessions, trades, analytics, prop report, prop demo, market, live demo, playbook demo, journal demo, and actual read-only settings/risk/research/learn. Screenshots are named by route/theme/width. Direct SVG button centers and page/content horizontal overflow were measured. No visible button-icon centering defect or page/content overflow was reproduced in this broad initial sweep; Dashboard mobile hidden SVGs with zero-size rectangles are false positives and excluded from conclusions.

Deeper checks opened actual DataDesk catalog and idle CSV dialogs, demo Ledger basic filter drawer, and actual Journal context filter (`view=journal&session=fixture-alignment`). Idle CSV fields retain grid starts on desktop and a common edge on mobile; close buttons are centered within their boxes. No import preview was requested. Search-icon centers in Dashboard/Market have zero vertical offset and 12px horizontal inset.

## Concrete findings sent to root

1. Native checkbox browser margins survive the shared drawing adapter. Risk's CSS gap 8px produces a visible 11px mark-to-caption gap, Ledger Choices gap 10px produces 13px, and Journal filter gap 7px produces 10px. All have `margin:3px 3px 3px 4px`; the mark starts 4px past its parent edge. Shared menu checkbox gap is 8px. Vertical centers are within 0.25px. Evidence: `choices.json`, `choices-risk.png`, `choices-trade.png`, and `journal-choice-context.png`. Owners: `compact-system.css`, `ledger-controls.css`, `journal-analytics.css`.
2. Market toolbar desktop search is 44px at y=141 while dropdown/buttons are 36px at y=145. Their vertical centers match at y=163 but top/bottom boundaries differ, contrary to compact same-toolbar geometry. Owner: `data-library.css` search rule explicitly uses 44px. Both responsive widths keep search icon centered. Root decides the compact control-height correction.
3. Ledger numeric columns currently align left (P/L, return, R, prices, volume, fees) while the documented layout standard aligns numbers right. Header/body left edges match; this is semantic column alignment, not row geometry. Dynamic shown columns require key-based classes rather than positional selectors. Market numeric columns already align right. Root decides whether to migrate this within the current slice.

## Conditional and excluded cases

`MarketAssetCatalog.jsx` has a checkbox but has no current source consumer; current DataDesk catalog drawer has no checkbox, so no user-reachable defect is claimed there. CSV review-acceptance checkbox is now exercised in dark/light at 1710/360 via an intercepted fixture POST; see `conditional-review.mjs` and `conditional-review.json`. No write is forwarded. Demo Journal omits context checkbox; the actual context URL above covers it. Broker/live-connected states, submitted form validation/server conflicts, unmounted dialog variants, exact real session/chart loaded states, vendor trading-chart internals, zoom/full accessibility, and provider data behavior are not accepted by the broad route sweep.

Root fixes close the findings above, plus Ledger selection/action axes and reference action-cell alignment. Final independent focused regression is 36 PASS; final conditional CSV/Journal geometry is 8 PASS. See `INDEPENDENT-REVIEW.md` for acceptance scope and limitations. These evidence notes do not create a separate product progress ledger.
