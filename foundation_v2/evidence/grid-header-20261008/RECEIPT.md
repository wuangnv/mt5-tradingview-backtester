# Grid header cleanup — 2026-10-08

Owner request: remove the apparent duplicate Trades header box and make Trades/Data Library headers use the page canvas instead of a lighter surface.

The ledger already rendered one header row. Extra filter-to-table margin, nested vertical button/cell padding and an inset divider plus bottom border produced the apparent extra frame. The header now has one 44px row with one sticky inset bottom divider; the extra 12px filter-section margin is gone. Sort buttons retain 44px keyboard/click targets. Data Library uses the same 44px canvas header in both themes, with a page-scoped selector that wins the general light-theme table preference rule. No data/state/API changes.

Validation:

- `npm run build`: PASS.
- `node foundation_v2/evidence/grid-header-20261008/qa.mjs`: 14 cases PASS; actual read-only Library/Trades in dark/light at 360/768/1440, plus two separately labeled built-in demo ledger fixtures for scrolling and sorting/focus. Headers match canvas RGB exactly, single `thead`, 44px height, filter-section gap zero, no duplicate ledger border, no document overflow; footer remains at viewport bottom.
- Independent review: 12 cases PASS, including four browser-only ledger fixtures for sticky positioning and keyboard sort. See `independent/REVIEW.md` and `results.json`.
- Selected screenshots visually reviewed: actual dark Trades desktop and light Library mobile; independent desktop/light Library and mobile/dark Library checks.
- `git diff --check`: PASS.

Initial QA found the generic light-theme library rule still applying a raised surface; the page selector was corrected and the full matrix rerun. QA selectors were also corrected to account for the sort arrow in the accessible name and to enter keyboard modality before checking focus-visible. Final runs have no failures or browser exceptions. No real trades, datasets or sessions were changed; actual empty Trades and labeled fixture data are separate.
