# Independent review: Dashboard parity

**SCOPED_PASS** on frozen candidate. 26 final checks passed: 15 controls checks, 7 lifecycle/data checks, 4 modal accessibility checks. Source hashes are unchanged during each run and match the final 19-file receipt. Zero page errors, writes, downloads or external traffic. Actual QA only issued GET/HEAD/OPTIONS; demo lifecycle changed local React state only.

## Accepted behavior

- Demo and real Dashboard share the source, period, sort and list-filter controls. Source is Backtesting/Battles(disabled)/Prop Firm/All; sessions are not repurposed as source choices. Dark/light at 1440/768/360: no document overflow; popups fit content; search has one border/focus treatment. Selected options retain ticks/checkboxes and no persistent fill when unhovered/unfocused. FxSelect, SessionFilter and native selected options were probed on related routes.
- Recent Sessions exposes inline archive/restore, edit, Analytics, copy, Summary and expansion. Demo edit persists name/description locally; copy has the source's 20 trades/960 USD while aggregate Dashboard stays 60 trades; archive/restore filters and archived copy-disable work. The exact Dashboard URL and API count stay unchanged through the entire local flow.
- Metadata matches the fixtures: dataset dates, balance 10,960 USD, progress 1401/1901/2401 of 30,000. Expansion contains only three charts; Summary contains the charts, six metrics and paginated Recent Trades.
- Summary/edit/confirmation dialogs stay within 360×600 and 1440×987, wrap Tab/ShiftTab, close by Escape/backdrop/button and restore opener focus. Axe WCAG 2 A/AA/2.1/2.2 checks pass on Summary and edit in both themes/sizes. Summary after choosing rows20 still closes by Escape.
- Demo Analytics link selects Gold Swing's 20 rows through `demo_session` while preserving the real session owner. Switching to real removes `demo_session` and keeps the real owner.
- Actual archived XAU displays one trade, net −0.24 USD and closed-trade balance 9,999.76 USD. Initialized-empty EUR shows empty trades and known Total P/L zero. Uninitialized active session shows six unknown metrics, unknown balance, three empty expansion charts, progress 501/93,810 and 93,309 remaining candles. Its entire persisted GET payload remained unchanged, including revision2/cursor500.

## Findings repaired and rechecked

1. Preview initially served cached `demoFixtures.js` without `DEMO_DATASETS`, causing a blank page. Root invalidated the watcher cache; final browser runs loaded candidate modules. Raw attempt retained in `controls-first-stale-runtime.json`.
2. Native modal Tab cycles could focus BODY. Root added explicit boundary wrapping/close/focus restoration. Stress checks now pass 34 forward + 34 reverse Tab presses per modal at desktop/mobile.
3. Closed FxSelect intercepted Escape and prevented Summary closing after page-size selection. Escape is now consumed only while the menu is open; the exact failure case passes.
4. Mobile demo monthly chart scrollers failed `scrollable-region-focusable`. Focusable named regions now pass axe in both themes.

Raw candidate failures remain in `controls-r1.json`, `lifecycle-r1.json` and `lifecycle-r2.json`; a reviewer SessionFilter oracle was corrected to read its accessible label rather than the intentionally compact visible text. No product source edits or commits were made by the reviewer.

## Data/state and scope boundary

Real catalog/dataset GETs feed cards; revision-keyed validated session analytics feed balances/three charts/Summary. Current dataset metadata supplies dates, cursor/row_count supplies progress, and validated analytics cutoff supplies remaining days only where available. Unknown values remain unavailable. Existing revision-aware PATCH/branch POST contracts are invoked only by explicit real submit; those submits were **not** performed by this reviewer. Actual dialog inspection was cancel-only.

Preview uses fixture analytics and a local catalog; copies retain source identity for their ledger while aggregate overview remains deduplicated. Performance Prop/All switches preserve preview isolation. Real Prop currently has zero reports, so no populated real Prop financial acceptance is claimed. No broker/order/import/history-update/restart or whole-product acceptance is included. Root owns synthetic real-mutation fixtures/build/model tests and final integration.

## Evidence

- `controls.json`: final 15 checks/12 Dashboard viewport cases; 19 stable source pins.
- `lifecycle-final-actions.json`: final 7 lifecycle/data/focus checks.
- `lifecycle.json`: final 4 modal theme/viewport accessibility checks.
- `final-receipt.json`: combined 26-check receipt and final source pins.
- Visually inspected `demo-expanded-1440.png`, `controls-demo-dark-360.png`, `controls-demo-light-1440.png`, `summary-top-dark-360.png`, `edit-light-360.png`, `actual-uninitialized-summary-1440.png`. Responsive actions wrap without clipping; Summary owns its vertical scroll.
