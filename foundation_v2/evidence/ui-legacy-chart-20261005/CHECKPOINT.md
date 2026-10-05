# Legacy chart workspace — 05/10/2026

The owner requested the supplied FX Replay Legacy layout using the already authorized
Advanced Charts integration. This checkpoint covers that local UI slice only.

## Behavior and data ownership

- One native header replaces the shell header only after chart/header readiness. It
  includes dataset identity/back navigation, supported favorite intervals, native
  chart tools/settings and app theme/context. Native failure retains shell navigation.
- Black panes/rails, a movable/pinnable/collapsible replay toolbar with speed slider,
  Go To/Order/News/Journal actions, and round Buy/Sell/Size/Analytics follow the reference.
  Tablet/mobile use the utility rail for actions; it scrolls on short viewports so the
  trading bar stays visible. Mobile controls clear the native drawing rail and legend.
- Buy/Sell use DOM order matching their visual order. Iframe portal triggers retain
  their real opener; Escape from the application dock returns focus across documents.
  Dataset refresh preserves known metadata so focus transitions do not recreate the chart.
- API sessions/revisions/cutoff/order state remain authoritative. Only `visible_rows`
  reach the chart; 3m/2h join the supported causal intraday aggregations. No lower
  timeframe candles, market data, session names or economic markers are fabricated.
  Go To accepts opened candles/timestamps only. News honestly reports the absence of
  a historical event feed. Native drawings/layouts remain local, scoped cutoff snapshots.
- Application CSS customizes the iframe using the library's supported stylesheet option
  and official custom button hosts. The pinned v23 market-button group gets one ordering
  class. Vendor assets remain ignored/unmodified and are excluded from the app build.
  `chart_engine=lightweight` remains a reversible rollback.

## Verification

- Production build passed (104 modules); the existing large-chunk advisory remains.
- 18 focused adapter/storage/order/drawing tests passed using explicit `*.test.mjs` files.
- Final GET-only actual preview: 8 journey groups passed, zero page errors. Real pointer
  drawing, RSI/settings/style/interval, save/reload/cutoff, portal keyboard/theme/focus,
  Go To, News, toolbar move/pin/collapse/speed, responsive themes and missing-asset rollback.
  Full receipt: product `.artifacts/legacy-chart-20261005/final-r3/`.
- Disposable real UI/API/PostgreSQL: 12 journey groups passed, including all 8 annotation
  types, simulator initialization/queue/next-bar fill, native SL pointer drag/protection
  ledger, stale revision rejection/reconcile/reload, and historical mutation locks.
  Unauthorized/stale requests left canonical data unchanged. The generated temporary DB
  was dropped; the owner preview remained read-only. Full receipt: workspace
  `.artifacts/advanced-chart-20261004/integration-9b4c24da/`.
  Final subsequent changes only adjust visual contrast, responsive placement and rail
  overflow; the execution contract was unchanged.
- Native browser zoom through `chrome.tabs.setZoom` passed 125%, 200%, reset in both
  themes (6 cases). The oracle now also verifies the trading bar stays inside the viewport.
  Root inspected desktop/mobile and 200% captures. Full receipt: product
  `.artifacts/legacy-chart-20261005/final-zoom/`.
- Lightweight rollback retained 5 GET-only journeys and 8 responsive theme/width layouts,
  zero page errors: product `.artifacts/legacy-chart-20261005/rollback/`.
- Independent source/runtime review receipts and selected screenshots are preserved
  beside this checkpoint; the review is scoped automated evidence, not full manual WCAG.
  Review accepted the final seven-file composite
  `2609c777d80a587dd33e270850ddc67fda78cd068753378c92a75f48789f750e`.
  Final light/tablet deltas passed with stable before/after hashes; automated axe found
  zero outer/native violations in those checks. See INDEPENDENT-REVIEW.md.

Earlier failed layout/race/contrast attempts remain in `.artifacts`, not counted as passes.
An overly broad Node file glob also selected an old write-browser test: the preview rejected
its create request with 403 `qa_read_only`; explicit unit-test filenames replaced that
invocation. No preview data was changed and no guard was loosened.

## Scope and resume

UI remains running at `http://127.0.0.1:5180`, API at `http://127.0.0.1:8020`; broker locked.
The screenshot's market history differs from the current labeled QA dataset, and the
reference's historical economic news/calendar are not supplied by this slice.
No FX Replay source was copied. Standalone production hosting still must separately
mount the authorized Advanced Charts distribution as documented in README.

This does not close whole U4/product acceptance, manual accessibility, sustained chart
performance, real market data/OOS, broker/provider/deploy or Trading Platform depth/order
flow scope. Ledger/STATE and global/shared UI foundations were not changed.

## Follow-up: tools and alignment

The owner reported missing tools and uneven alignment. The follow-up adds real UTC D/W/M
aggregation, six native drawing shortcuts (trend/price/rectangle/Fibonacci/long/short),
native object tree and local PNG export. The adaptive header exposes interval/style
favorites on desktop. App-owned chart controls share the native Arial font; icon centers,
caption line-height, button/link dimensions and trading-control heights are consistent.
Favorite/replay bars start separately, with mobile rows clearing the native legend/rail.

Data ownership stays with the API-visible prefix. Calendar buckets include partial current
bars without future prices/volume; Monday weeks and actual month boundaries are used.
Chart timeframe does not change dataset-source stepping or simulator fills. Native drawing
shortcuts use official `selectLineTool`; their shapes retain the native local snapshot
contract. PNG uses `takeClientScreenshot` and is fenced against cutoff/interval/session
changes. Native server screenshot upload stays disabled; vendor assets were not edited.

Follow-up validation (supersedes baseline counts for this slice):

- Build passed, same existing large-chunk advisory.
- 20 focused tests passed, including leap-month/year boundaries, partial month realtime,
  rewind/pending-history invalidation and coarse-source resolution restrictions.
- Actual read-only preview: 10 groups passed, including exact native D/W/M OHLC/volume,
  six two/one-anchor drawing gestures, native object tree, valid PNG download, dark/light
  desktop/tablet/mobile, centered/equal rail controls, save/reload/rewind and rollback.
  Receipt: product `.artifacts/legacy-chart-20261005/complete-r5/`.
- Native browser zoom: 6 cases passed (125%/200%/reset, dark/light), no cut-off trading bar.
  Receipt: product `.artifacts/legacy-chart-20261005/complete-zoom/`.
- Real disposable UI/API/Postgres: 14 groups passed, including native SL drag, exact
  protection ledger, stale revision rejection, reload, historical locks and next-bar fill.
  Receipt: workspace `.artifacts/advanced-chart-20261004/integration-2aae919a/`.
  The temporary database was dropped; owner preview was unchanged.

Earlier failing assertions remain in attempt artifacts. Native SDK adds bar flags to the
callback objects, so the OHLC oracle projects only financial fields. Hidden theme buttons
are excluded from geometry checks. A native modal is closed with Escape, not by calling
its open action again. These were harness corrections, not weakened financial assertions.
The original baseline independent-review receipt is not acceptance of this follow-up.
The separate follow-up review accepted composite
`b32ebfa218248a7d43597cf04b4ee3af0db67a5805b11a1769d8056939b4d6b8`
with unchanged before/after fingerprints: six dark/light layouts, zero toolbar overlap,
zero rail icon-center delta, zero automated outer/native axe violations, six pointer
drawings and a waited object-tree row. Client PNG was validated at 1356x899; a delayed
capture after interval change was suppressed with a visible message. No external request
or preview write was attempted. See TOOLS-INDEPENDENT-REVIEW.md, TOOLS-CONTROL-REVIEW.json,
TOOLS-ALIGNMENT-REVIEW.json and tools-desktop/mobile.png beside this checkpoint.
