# Catalog source selection — 2026-10-08

Outside source filtering updates the drawer selection in one direction. Drawer
selection controls catalog facts and refresh eligibility only; it never changes
the outside filter or grid. Reopening preserves the drawer choice until an outside
source change or filter reset. No backend contract changes.

Shared source options include cached Dukascopy even with zero instruments. Counts
deduplicate dataset versions by source/instrument. CSV sources show their latest
save time and cannot refresh Dukascopy. All sources explicitly label the Dukascopy
update timestamp. Popup clipping now respects its nearest native dialog.

Validation:

- `npm run build` from `foundation_v2/web`: PASS.
- `node foundation_v2/evidence/catalog-source-20261008/qa.mjs`: 7/7 PASS,
  dark/light at 360/768/1440, VI/EN, empty cached catalog, mixed-source filtering,
  independent drawer state, deduplicated counts, timestamps, popup fit, keyboard
  Escape, disabled CSV refresh and modal refresh blocker with mocked POST.
- `node foundation_v2/evidence/catalog-source-20261008/actual.mjs`: 2/2 PASS,
  actual cached local API GET on desktop dark/mobile light; no mutation requests.
- Independent reviewer: 4/4 PASS; see `independent/REVIEW.md` and `results.json`.
- Reviewed actual dark desktop/light mobile screenshots and popup mobile image.
- `git diff --check`: PASS.

Initial primary QA failed from an incorrect table class and an EN timestamp
expectation requiring a leading zero. Evidence retained in
`attempt1-oracle-errors.json`; corrected the oracle, then reran all seven cases.

No real catalog refresh, history download, CSV import, broker/live action or
dataset mutation occurred. This is scoped UI validation, not full-product acceptance.
