# Peach actions and report palette — 07/10/2026

Scope: the owner's 13 annotated Testing comments, stronger peach primary actions,
and a separate report-chart palette. This receipt is scoped UI evidence, not a
whole-product completion or a broker/data acceptance claim.

## Implementation

- Project palette owns action/hover/foreground, soft-peach badges, destructive
  red/white, and six report-series roles for dark/light. Trading series, candles
  and user drawings retain their existing project roles. Global UI pins unchanged.
- Primary actions (including compact Play) provide local shared-control colors,
  so high-specificity neutral rest/hover rules do not undo semantic colors or
  canonical select/button geometry. Secondary actions remain neutral.
- Dashboard start actions are capped at 752px and aligned left, with peach icons
  and hover. Recent Sessions shows filtered matches / entire catalog, independent
  of the six-row local pager. Non-action header clicks toggle expansion; the
  existing chevron keeps keyboard activation and accessible expanded/panel state.
- Expanded cards darken; empty reports use one left-aligned message. Existing
  known balance curves remain available without requiring a full ledger.
- All shared popup search fields use a transparent background on the raised menu
  surface. Analytics parent text/icon and the continuous source underline use
  peach; the source-tab labels remain neutral.
- Remaining-days badges use soft peach. Session deletion uses filled red/white
  and retains exact-name/revision confirmation. Clear filters has the shared
  trash SVG and a neutral hover. Applying/resetting synchronizes every draft,
  including the session, with the committed filter state.
- Report series are mapped in Dashboard, Sessions, Analytics, Journal and the
  Research/data sparklines. Violet/gold are available for named comparison series,
  not arbitrarily applied to individual Monte Carlo paths.
- VI domain labels follow the accepted hybrid proposal: Backtest, Phiên backtest,
  Prop Firm, Thử thách prop firm, Ngày backtest. API identifiers and source names
  remain raw. Project palette and Testing component contracts are updated.

## Verification

- `npm run build`: passed on the final source revision.
- Focused Node tests: 14 passed (copy interpolation, Dashboard catalog/resume,
  UTC period calculations, ledger filter semantics).
- `primary/check.mjs`: actual GET-only card expansion/action isolation/keyboard,
  popup search, action/delete/hover colors, and demo Outcome Apply/Clear reset;
  dark/light passed, zero page errors or actual writes.
- Contrast: action text 5.45–8.97:1; delete text including hover 4.64–8.14:1;
  soft-peach text 5.91–7.90:1; report colors against surfaces 4.80–8.81:1.
- Session recovery browser fixtures: 11 passed, all writes fulfilled/aborted in
  the test transport. Success/lost response/conflict/Prop refusal/denied and old
  archived records retained. The conflict oracle now explicitly waits for React
  to re-enable the confirmation after catalog reconciliation.
- Independent source/visual/interaction review: PASS, 56 unique route cases
  (38 retained r4 +18 affected r5), eight final targeted journeys and 16 Axe scans
  with zero violations. See `independent/REVIEW.md` and final receipt for exact
  retained cases and revision boundaries; do not imply all56 ran after the final
  draft-state fix. Zero accepted page errors or actual writes.

## Findings and limits

Browser QA found that generic selector specificity outweighed semantic primary
colors. The local shared-control-role fix keeps consistent neutral geometry and
primary/danger colors at once. A final scan found the Dashboard win-rate series
and two Research/data sparkline mappings still using the trading blue; corrected.

An independent supplemental journey found that Clear filters retained an
uncommitted session choice while the report stayed on its original session.
`apply()` now synchronizes filter/extra/session drafts with the values committed,
including when the original session value has not changed. This prevents the
next Apply from unexpectedly committing the discarded session draft.

Initial reviewer failures are preserved in the independent reports. Mobile
44px controls were incorrectly compared with desktop40px, and outline-width was
read without outline-style; both were test-oracle issues. The primary harness
also corrected its translated chip label, from “Bỏ lọc” to “Bỏ bộ lọc”.

Research sparkline changes have source/token review; this slice does not prove
an end-to-end Research job. Actual requests are read-only. No stored session was
deleted, no database migrated, and no trading-chart engine or broker gate changed.
Loading/stale/error, report calculation and paging contracts are retained.

Rollback: revert this coherent product commit and restore the parent gitlink.
