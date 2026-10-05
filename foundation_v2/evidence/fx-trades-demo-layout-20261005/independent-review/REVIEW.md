# Independent review — Trades, demo mode and shared page layout

**SCOPED_PASS** for this UI slice, based on the comprehensive observations and the final focused reruns below. Reviewer edited only this evidence directory. Product implementation, fixes, builds, tests and commits remain root-owned.

## What is accepted

- Shared content gutters: 56 actual route/theme/width cases and 56 demo route/theme/width cases, covering 360px and 1440px, dark and light. Expected gutters are 16px mobile and 32px desktop; document overflow is zero. Actual routes cover Dashboard, Sessions, Trades, session Analytics, Prop Analytics, Market Data, Live calendar, Strategies, Journal, Learn, Settings, Research, Data Desk and Risk. Chart/order workspaces are intentional exceptions and were not exercised here.
- Analytics navigation: flattened order is Dashboard → Sessions → Trades → Analytics → Sessions source → Prop firm source → Market Data. Source tabs share the same row. Selected source remains visible on mobile after direct navigation, reload, resize and source switching. A 0.016px edge difference is normal geometry rounding and fits the 1px tolerance.
- Trades: actual GET oracle has six sessions, four readable, one closed trade; UI matches that ledger and explicitly retains the partial-data state. Technical row IDs and the redundant ledger note are removed from visible table copy. Source labels remain readable, while provenance stays available in actual details.
- Demo Trades: the deterministic 60-row ledger matches the displayed default order; pagination, 10/25/100 row sizes, return sorting, selected rows, column selection, detail open/close, side/outcome/asset/tag/session filters, exact-ID search and empty search results work. Selection and details do not create replay/journal links for fake identities.
- Demo mode is explicitly labeled `Demo · Dữ liệu mẫu` and controlled by `demo=1`. Supported preview routes issue **zero API reads**, mutations, downloads or external requests during the tested journeys. Market Data preview has no chart links and no enabled history/update actions; its handler also exits for preview input. Real readers unmount while fixtures are mounted.
- Real-data restoration preserves the genuine XAU tick session, cursor 1061 and dataset identity. The one real trade returns, and demo rows/labels disappear. Reload and Analytics source navigation retain the requested demo mode and existing real context. Demo report tab/filter state is intentionally local, so it does not alter saved real route filters.
- Demo Drawdown and Simulation render. SL/RR inputs have the correct configuration shape; the SL/RR action is disabled with an explanation that price paths are absent. The local Monte Carlo calculation runs 200 iterations with seed 42 and produces results without API access.
- Representative accessibility checks pass after the Journal fix. Frozen comprehensive run checked 48 route/theme/width states, including actual Trades/Analytics/Prop and populated demo pages. Journal and Live Notes received eight final theme/width contrast, gutter and overflow checks; local Monte Carlo and mobile Analytics navigation also pass axe.
- The old active replay session remains revision 2 with its original SHA-256, 501 visible rows and exactly equal full GET payload before/after comprehensive testing. No session or database write was attempted.

## Findings and final resolution

1. Static navigation issues were corrected by root: the React import and prioritizing the selected Analytics source when revealing a narrow navigation row.
2. Root corrected the preview simulation configuration and kept unavailable price-path SL/RR computation disabled. Source labels now show UI demo/Replay/Research rather than opaque IDs.
3. Populated demo Journal initially missed the original Journal root classes and therefore missed semantic theme colors. This produced contrast failures in dark desktop and light mobile/desktop. Root reused `journal-page ja-story-page`; final Journal and Live Notes rechecks pass without extra color overrides.

Only `DemoPreview.jsx` changed between the stable comprehensive source snapshot and the final source snapshot, for the Journal root-class correction. Seventeen final source hashes are recorded in `summary.json`; focused source hashes stay unchanged through their runs.

## Honest treatment of raw attempts

- `browser-attempt1.json` and `browser.json` retain **exit 1**: four reviewer Settings selectors were wrong, one reviewer restoration fixture used an invalid tick cursor, and three real demo Journal contrast failures were subsequently fixed. Its unaffected layout, data, Trades interaction, navigation, isolation and preservation assertions passed. It is not relabeled a full passing run.
- `focused-attempt1.json` retains **exit 1** for the invalid tick cursor and a reviewer selector that treated a tab as a button. Correct Settings and Journal/Live Notes observations passed.
- `focused-attempt2.json` retains **exit 1** only for a reviewer expectation that a demo report tab would update `analytics_tab`; preview state intentionally remains local. Restoration using actual cursor/dataset, Settings and Journal/Live Notes passed.
- `simulation.json` records the corrected local-preview tab oracle, populated input values, disabled SL/RR action, local Monte Carlo and accessibility pass.
- `focused.json` is the final corrected focused run, including explicit post-fix Journal/Live Notes overflow and gutters. `summary.json` composes the accepted scope without changing any earlier raw outcome.

## Evidence and practical limits

Harnesses are `browser.mjs`, `smoke.mjs`, `focused.mjs` and `finalize.mjs`. Selected visual evidence includes actual `trades-*`/`analytics-*`, `demo-trades-desktop-details-sort.png`, `inline-analytics-session-source-mobile.png`, `restored-real-trades-ready.png`, final `focused-journal-*`/`focused-live-notes-*`, and `demo-montecarlo-local.png`. The page content scroller was moved for lower sections; a document screenshot alone was not treated as full-page proof.

Actual Prop report inventory is empty. Demo Prop Practice and Prop Analytics are **report/objectives presentation previews**, not challenge creation, evaluation or evidence of financial correctness. CSV export is a local preview capability and was not clicked. No broker/provider/SDK call, order action, import/download, execution, native zoom, canonical golden or whole-product acceptance is claimed. Root's separate build and 35 focused tests are not represented as reviewer-run checks.

The state boundary is simple: actual pages read existing local APIs; preview replaces them with deterministic UI fixtures and reuses presentation components. Fake record IDs remain in component state. The trade-off is that unavailable path-dependent calculations remain visibly unavailable instead of presenting invented results.
