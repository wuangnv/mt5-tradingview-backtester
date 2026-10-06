# Testing alignment and copy — 2026-10-07

Scope: latest owner feedback on Testing optical alignment, Analytics parent/source
tab states, Dashboard date/sort labels and the recent-session count. This receipt
does not close broader product, broker, provider or deployment gates.

## Change

- Analytics parent text/icon and its continuous underline remain peach. Source
  tabs are muted at rest, brighten on hover, and use contrast text when selected.
- Metric icons use fixed flex boxes without an inline font baseline gap. Wrapped
  mobile labels align icons to the first text line. Dashboard search icons track
  the input center rather than a fixed top offset.
- Testing text actions share flex centering, a 20px line box and non-shrinking
  SVGs. Standard icons stay 18px; the existing compact/new/journal roles stay 16px.
  Market search/date fields follow the desktop/mobile 40/44px control height.
- Owner-requested VI labels: Tuần trước, Tháng trước, Tất cả, Tuỳ chọn; Mới nhất,
  Cũ nhất, Mới cập nhật, Lợi nhuận cao nhất. Count uses prose, with a separate
  grammatical English form: “Showing 1 of 6”.
- Last week/month now mean the completed UTC calendar week/month. Selection
  writes ISO date bounds into the existing URL scope; the existing overview API
  still receives inclusive UTC close-date bounds. Reload retains those bounds.
  Legacy rolling ranges retain their values and accurate labels; no migration.

Shared fixes remain in project CSS and `ui/testing-standard.md`; no global
foundation generation, palette change or trading-chart vendor change.

## Verification

- `npm run build`: PASS after final source edits.
- 26 focused Node tests: PASS (`testingCopy`, `dashboardModel`,
  `dashboardSessions`, `sessionPerformance`, `ledgerFilters`). Includes completed
  week/month, year rollover, leap February and legacy-range cases.
- `primary/verify.mjs`: 8 PASS contexts: EN/VI × dark/light × 1440/360. Actual
  date scope, reload, custom bounds, legacy scope, sort/copy, tab hover/selection,
  metric first-line alignment and market field heights. No page errors or writes.
- `primary/audit.mjs`: 24 route/context samples covering Dashboard, Sessions,
  Trades, Analytics, Prop, Market Data, Data Desk and component reference at
  1440/768/360. 292 control-icon measurements; no document overflow, page errors
  or writes. Raw center deltas include expected exceptions: tablet quick actions
  use an icon-above-text layout; multiline mobile metric icons follow the first
  line, rather than the center of the entire wrapped label.
- Independent review matrix: 60 PASS cases, 0 failures/errors/writes, unchanged
  source pins. Its receipt and visual review are under `independent/`.
- 6 additional independent form journeys: PASS for session settings, creation
  dataset picker, and time/date popups in desktop dark VI and mobile light EN.
  Covers popup fit, cancel/Escape, focus return and no saved-state mutations.

All actual API checks allow GET/HEAD/OPTIONS only. Session writes, market updates
and broker actions were not performed. Runtime stayed on UI 5180 / API 8010.

Git retains the scoped receipt/source pins, runnable scripts, focused journey
receipts and selected screenshots. The large raw measurement reports, all other
screenshots and the initial option-label-oracle diagnostic remain local in this
evidence folder; the accepted runs did not erase the earlier failed diagnostic.
