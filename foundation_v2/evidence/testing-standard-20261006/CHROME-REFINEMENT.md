# Testing chrome and control refinement — 06/10/2026

Owner requested neutral dark-theme chrome, sidebar separators and useful context,
and button/select geometry aligned with Go to chart and duplicate-session actions.
This continues the approved Testing direction; it is not whole-product acceptance.

## Result and ownership

- Sidebar shows the actual workspace ID and links to the existing Settings route.
  The primary group has top/bottom separators. Collapse and mobile drawer retain
  navigation labels, focus and the workspace link; no fabricated profile/tier.
- Shared shell tokens own neutral canvas, surfaces, lines, active icons and focus.
  Generic action/series accents are white/black. Semantic P/L, warning and meaningful
  data-series colors remain available; no additional brand accent is introduced.
- Testing ordinary select triggers and buttons share pill geometry, gray surfaces
  and a transparent 1px border. Primary actions retain Go-to-chart contrast.
  Rich selectors and popup/input panels retain their relevant field geometry.
- Duplicate-session is the circle reference: 32px desktop with 16px SVG icons,
  44px targets on narrow/coarse devices. Header, reset/columns, detail, edit, archive,
  delete and pager circles follow it. Inline Settings retains underline behavior.
- Compact ledger paging shows previous/current/next; desktop keeps nearby pages
  and first/last. Existing local/remote paging callbacks still own page state.
- Settings/Education labels, rail aria labels and collapsed tooltips use EN/VI.
  Workspace/session names remain raw data.

## Verification

- `npm run build`: PASS on final source.
- 13 focused Node tests: copy/enums, shell preferences, demo modes and ledger filters.
- `tests/testing-standard.browser.mjs`: 12 demo route checks and 2 reference journeys.
- `tests/neutralControls.browser.mjs`: 75 checks plus 12 navigation journeys; EN/VI,
  dark/light, 1320/768/390 and supplemental 320/360/coarse1320. No JS errors/writes.
  Final row-size token correction was additionally measured at 320/360/coarse1320:
  selector44px and footer fully inside viewport. Independent final run includes it.
- Independent frozen-source review: 87 browser cases, 8 Axe scans with 0 violations,
  0 failures, source fingerprints
  unchanged; see `chrome-review/REVIEW.md` and `chrome-review/final-receipt.json`.
- Review caught and repaired header flex-basis stretching circles and pager
  height overrides. Earlier failed/mixed-source exploratory results remain local.
  A focus-width false alarm was traced to UA styles on a non-focus-visible element;
  the final harness enters keyboard modality and verifies visible focus.

Root report: `chrome-root/report.json`; raw independent request/style logs and
screenshots remain local beside the scripts and in `root/`. Curated receipts and
scripts are committed; generated builds/cache are not.

## Runtime boundary

The old screenshot's generic route-load error did not reproduce in clean actual
or demo journeys. API8010 is currently unavailable, so actual pages display honest
read/retry errors instead of demo data. Real-service success and mutation journeys
are not claimed in this receipt. No database writes, session actions, provider
refresh, replay stepping, order execution or broker access were exercised.

UI dev server is available at 127.0.0.1:5180. API startup was not added to UI QA.
Rollback uses the coherent product commit and previous superproject gitlink.
