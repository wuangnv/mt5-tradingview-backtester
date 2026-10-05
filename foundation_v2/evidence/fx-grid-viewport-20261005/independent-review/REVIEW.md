# Independent review — SCOPED_PASS

2026-10-05. Reviewer owns evidence only; no product source edits or commits. Root owns implementation and integration. UI 5180/API 8010, tenant-a, browser GET-only. No market update/history, order/broker, session mutation, import/download or external traffic executed.

## Result and evidence

- `browser-attempt1.json`: 25 passing cases, 2 failing demo-dialog Tab containment cases; no runtime errors or blocked traffic; nine source hashes stable during run. Kept raw failure evidence, never relabeled as full pass.
- `browser.json`: final focused rerun, 10 passing cases, zero failures/runtime errors/blocked traffic. Nine source hashes stable before/after.
- Only `FxTradeLedger.jsx` changed between runs: explicit first/last Tab wrapping and `model.result` scroll-reset dependency. All eight other hashed files identical. Final rerun covers affected dialog/grid/real ledger behavior; unchanged Market/Analytics cases retain attempt1 evidence.
- `progress.json`, `browser.mjs`, screenshots and source hashes in JSON preserve reproducible checks.

## Behavior verified

Trades footer touches content bottom within 1px; only row scroller moves while `.fx-content` scrollTop remains zero. Sticky table header/footer stay at the same coordinates. Demo sizes 10/25/100 yield 10/25/60 rows. Tested dark/light at 1710x987, 1440x987, 360x987, 1440x600 and 360x600. Final rerun covers all four short-height/theme combinations with Basic+Tags expanded and actual `.fxa-ledger-filter-panel` scrolled to bottom: Tags control fully reachable, table body usable, pagination unclipped. Top columns and bottom size popups fit the content bounds. Page/size/sort/search transitions reset row scroll to zero.

Trades inspector is native `:modal`, fits desktop/mobile viewport, keeps Tab/Shift+Tab focus inside, dismisses through Escape/close/backdrop and restores opener focus. Opening/closing retains underlying footer and row scroll. Analytics detail remains a section, outside Trades grid viewport rules. Trades/Analytics Sessions/Prop filter separators match shell line color.

Market source paragraph/countfacts removed, update action in search/filter row. Demo has 12 local assets; search/group/empty results work, update disabled and no replay links. Actual cached toolbar action alignment inspected without clicking. Labeled GET fixtures cover running/queued, connection/tick/asset errors, empty response and GET500. Labeled Trades delayed GET500 confirms loading/error retain hidden ledger and disabled CSV. Axe WCAG checks returned no violations on inspected cases; representative desktop/mobile, light/dark and actual Market screenshots reviewed.

## Data/state and boundaries

Actual aggregate ledger has one persisted closed trade; single archived XAU session uses canonical cursor1061. Initialized-empty session has zero rows; uninitialized session blocks ledger/CSV. No financial rows fabricated. Old active session full GET payload unchanged (revision2, visible501). Demo cases caused zero API reads; write/download/external/WebSocket paths guarded.

The row viewport uses available shell height; expanded filters share a bounded scroll region so small screens preserve table/footer access. Dialog is separate top layer, so detail content cannot displace the grid. Unknown financial values and unavailable real Prop performance remain outside this acceptance.

No whole-product, broker/live, populated Prop evaluation, native zoom or canonical visual-golden acceptance claimed. Synthetic loading/error cases are explicitly labeled and do not prove provider execution. Root build/regression results are not reviewer-run claims.
