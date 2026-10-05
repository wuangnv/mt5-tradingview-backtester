# Testing Market Data navigation — 05/10/2026

Owner-approved scope: name the Testing history inventory **Market Data** and
put it last in Testing's sub-header. Further history downloads remain deferred.
This receipt covers navigation and existing inventory UI, not whole-product,
history-quality, broker-execution or complete Prop acceptance.

## Behavior and data flow

- Testing order: Dashboard, Sessions, Trades, Analytics, Market Data.
- `view=market-data` defaults to Testing, including a bare deep link. The
  Sessions toolbar also points here. No duplicate visible page title.
- Reuses `MarketAssetCatalog`, its `/api/v2/data/market-assets` read API and
  five-second inventory refresh. This does not fetch market ticks every five
  seconds; historical download/catch-up remains the existing collector flow.
- Search, group and full-broker filters remain local UI state. Actual snapshot:
  35 enabled/downloaded assets, 356 broker symbols. Existing M1 and tick practice
  links use each asset's saved dataset and tick start index without changing old
  sessions. Explicit download/update actions remain available.
- `view=data` retains Data Desk CSV/provenance tooling. Keeping a separate
  Testing route avoids mixing import/research forms into the inventory page.
- Sub-header reveals the selected tab after resizing, so the fifth tab stays
  visible on narrow screens. Uses existing hover/focus/selected styles.

## Verification

Root actual-service Playwright journey passed ten grouped checks: Dashboard
navigation and tab order; API-backed enabled/all counts and search/group/empty
filters; latest dataset/tick-start links and fresh form without creating;
bare link/reload/focus; Sessions link/return to Dashboard; retained Data Desk
CSV form; 360px layout. Labeled simulated network loss retained stale inventory
with a warning, 403 cleared inventory, and unavailable source showed empty state.
No page exceptions, external requests, POSTs, downloads or session creation.

Desktop/mobile screenshots were inspected locally. Build passed (108 modules),
with the existing large-JavaScript-chunk advisory; `git diff --check` passed.
Independent read-only review and six theme/width checks are recorded separately
in `INDEPENDENT-REVIEW.md`. An initial real selected-tab resize failure was fixed
with a ResizeObserver and rechecked; it was not counted as a pass.

Reproduction assets (untracked/private):
`.artifacts/market-data-nav-20261005/root-journey.mjs`, root `report.json` and
screenshots; independent browser script/reports. Screenshots and raw catalog
payloads are intentionally kept local.

## Boundaries

No backend, broker, collector, source-data, licensed chart-vendor or global
configuration changes. No download expansion. Existing data coverage, history
fee/gap validation and intraminute Prop equity limitations are unchanged; see
the previous `tick-replay-20261005/CHECKPOINT.md` for that separate scope.
