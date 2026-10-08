# Pagination and download-status UI — 2026-10-08

Scope: owner browser comments on redundant completed download notification and inconsistent Library/Trades pagination. No dataset/session deletion, download request, broker call, or backend change.

Completed/cancelled download jobs are hidden from presentation; the original job collection still drives completion detection/catalog refresh. Queued/running/paused/failed jobs retain progress, errors, resume and cancel. Their scroll area shrinks on short viewports while reserving the grid header and pager.

`PaginationFooter` now owns the centered navigation and adjacent rows-per-page selector for Library, trade/analytics ledger, recent sessions, session performance and existing snapshot/catalog consumers. Desktop offers first/previous, up to five nearby pages with ellipses, next/last. Mobile keeps previous/current/next; mobile/coarse targets are circular 44px. Ordinary pages are transparent, the current page uses the project selected surface, and icons reuse TestingIcon. Empty/filter-miss Library grids retain the pager.

Library and full-page Trades use their remaining viewport for rows, with a stationary full-width top divider and pager at the bottom. Competing old pager CSS was removed. A remote ledger size change issues one `{pageSize, page:1}` patch; pending/unknown totals block navigation. Missing-dataset feedback sits above the grid so it cannot displace the pager.

Validation:

- `npm run build`: PASS on final source.
- `node --test tests/pagination.test.mjs`: PASS, window/boundary invariants for all current pages across 1–100 total pages.
- `node foundation_v2/evidence/pagination-20261008/qa.mjs`: 22 cases PASS, no runtime exceptions. Actual read-only Library/Trades at 360/768/1440 in dark/light; labeled browser fixtures cover last page, size reset, empty/filter-miss, active/failed downloads, table scroll, upward popup/Escape focus, missing dataset, short 360x600 and 320x600 layouts. Geometry and state assertions are in `qa.json`.
- Independent source/visual/interaction review: 17 cases PASS, including remote pending/unknown totals and single callback, Dashboard/SessionPerformance fixtures, desktop coarse targets, short active/error job recovery. See `independent/REVIEW.md`, `results.json`, `short-results.json`.
- Reviewed selected actual screenshots at desktop dark and mobile light, plus independent short/error evidence. Selected PNGs are saved with this receipt; the rest are local QA outputs.
- `git diff --check`: PASS.

The initial short-viewport check caught active/error jobs pushing the footer below 600px; reserving header/pager space fixed this, and both agents reran those cases. A historical `gridViewport.browser.mjs` run stopped at its stale English `Basic` selector in the current Vietnamese UI; it was not counted as passing acceptance and was left unchanged. Current scoped QA replaces that attempt for this change.

Limits: the actual Trades workspace currently has no closed trades; multi-page remote behavior and session lists use explicitly labeled browser-only fixtures. LiveBrokerSnapshot and historical MarketAssetCatalog were source reviewed/build checked without MT5 access. The special chart positions footer retains its separate account/status behavior.
