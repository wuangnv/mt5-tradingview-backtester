# Independent review — 09/10/2026

Verdict: no unresolved findings in the bounded shared-menu, live reporting metadata typography, and Dashboard source-state changes reviewed here. This is not whole-product, broker, provider, or account acceptance.

Reviewer worked read-only on source; only this review and browser evidence were saved. Source ownership stayed with the root and Dashboard source-state worker. Browser journeys used fresh Playwright contexts, local origins, and read-only API guards.

## Shared controls

- Reproduced the reported FxSelect alignment discrepancy and checked the final owner rules: checkbox edges and label starts match select-all/options; 8px gaps and 20px caption lines; selected checks retain their semantics. Enabled-choice counts use 2/2 rather than counting the disabled third choice. Disabled marks are faded once by the owning row.
- Reproduced SessionFilter clipping at 360×360 and a compact analytics popup collapsing to an 85px trigger width at 360×640. Final popups are 278px wide, remain inside the viewport, and expose lower options through their own scrolling list. Keyboard navigation reaches the final option.
- Checked motion while paused 20ms into the entrance animation: dark/light compact popups retain horizontal clamp x=70/right=348 and inline translateX(-93.0625px). Individual translate animates the entrance without replacing positioning transform.
- Found clipped keyboard focus after list padding was consolidated. Final focused option uses a complete 2px inset ring (offset -2px); visually inspected `independent-menu/focus-inset-final.png`.
- Independently executed `tests/menuAlignment.browser.mjs`: 14 cases passed, errors=[], writes=[] in `independent-menu/menu-report.json`. Root's later added motion/focus assertions are additional evidence; this independent run plus the final targeted motion/focus checks establish the reviewed behavior.

## Reporting text and reflow

Found live 11px badge, asset/day, bar-label, and mobile-calendar text that conflicted with the readable 12px metadata standard. Reviewed the owning CSS changes and reran a bounded scan across VI demo overview/trade/analytics/market-data at 1710px and 360px, dark/light: all 16 route/theme/width combinations have no visible text below 12px and no page/content horizontal overflow. `independent-menu/report-meta.json` records the metrics. The mobile calendar is readable and stays within its seven-column grid; labels wrap within cells rather than escaping them. Trading-chart vendor geometry and unloaded/legacy features are excluded.

## Dashboard sources

- Reviewed successful-read markers, same-scope refresh/stale retention, initial source-local errors, known-empty refresh failures, retry behavior, open-dialog/card mutation blocking, and permission-revocation clearing.
- Independently reproduced malformed Prop scalar IDs and dataset `items:[null]` crashing the route before the read-boundary fixes. Final validation rejects them as source-local failures.
- Reviewed local failed-detail retry: only failed entries are evicted, preserving valid ready siblings. Independent fixture assertions prove failed analytics GET count increases from 1 to 2 while the ready sibling stays at 1. Both card and aggregate retry are unavailable while the catalog is refreshing/stale, and the handler also checks the catalog gate; failed entries remain cached until the catalog is verified, then aggregate retry recovers them without rereading ready siblings.
- Reviewed dataset metadata's separate state owner and local retry. Transient failures retain verified metadata with a warning; its own permission failure clears it. Metadata errors never mean the session catalog is empty. Local retry increments only the dataset GET and preserves other read counts.
- Independently executed final `tests/dashboardSourceStates.browser.mjs`: 26 cases passed, errors=[], writes=[] in `independent-source/report.json`, including the guarded aggregate-retry regression in both themes. Reviewed stale catalog screenshots and source receipt. Fixtures exercise actual components with labeled responses; they do not prove external backend/provider behavior.

## Explicit limits

This review excludes broker operations, provider downloads, unrelated form conflict flows, unkeyed consumers' workspace transitions, full report-renderer tooltip/legend contracts, and full accessibility/zoom/performance qualification. Optional replay-context metadata remains best-effort within the detail read. No claim of complete project synchronization follows from these scoped passes.
