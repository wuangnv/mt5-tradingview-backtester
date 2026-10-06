# Independent review — Live/Market dividers and Dashboard refinement

Scoped PASS on 07/10/2026. No unresolved implementation findings in the assigned slice. This receipt does not claim whole-product, broker, provider, import, or account-connect acceptance.

## Source and scope

Reviewed the root-owned divider, clutter-removal and Dashboard interaction changes. Evidence scripts only were written by the reviewer; no product source edits, commits, service starts/restarts or user-data mutations.

`report.json` contains 24 SHA-256 source pins before/after the r3 supplemental run. Source was unchanged during each browser run. The explicit r2 → r3 delta is one line in `FxReplayShell.jsx`: include Dashboard/overview in the existing `role=main` whitelist. Twenty-two successful r2 route cases are retained; ten affected/representative cases were rerun on r3. A separate r3 `main-landmarks-report.json` checks all 32 routes for exactly one main landmark and no nested main.

Routes: Live Calendar, Trades, Notes, Tag analytics, Analytics, Trading accounts; canonical Testing Market data; Dashboard. Each covers dark VI 1440, light EN 1440, dark EN 360 and light VI 360. Calendar-cell gutters are intentional interactive units and excluded from structural zero-gap checks.

## Verified outcomes

- 32 layout/interaction route cases PASS; 16 Axe scans with zero violations. Native scrollbars retained. No page-level horizontal overflow or JavaScript errors.
- Live topbar/filter lines span the usable workspace width. Split/sidebar borders touch their adjoining boundaries; headings span the sidebar width. Accounts desktop headings align. Mobile stacked sections use connected top borders.
- Market filter/table/pager lines reach the usable content edges, including the native 15px scrollbar allowance on mobile.
- Demo/ready Live status text and repeated visible Live heading are absent. Accessible heading remains. Read-only, cost, unpaired-deal and incomplete-history caveats remain in the source disclosure.
- Actual Live endpoint remains unavailable; the visible account-unavailable state remains honest. Synthetic GET fixtures verify ready → stale (data retained, warning shown) → denied (data cleared, warning shown). This is not a real positive broker-feed result.
- Dashboard hover and expanded surfaces resolve to the canvas token after the 140ms transition. Expand/collapse, chart details, asset filter, clear, search/no-match/recovery pass in four viewport/theme/locale combinations.
- Status filter is absent. An intercepted actual-mode catalog verifies legacy `dashboard_status=archived` is ignored, does not open filters, and is removed by Clear. Default list includes all non-archived sessions, including completed sessions; archived entries are hidden.
- Six Dashboard GET/state checks PASS: held same-scope online refresh sets `aria-busy`, keeps metrics and omits refresh copy; failed refresh shows stale warning, retains metrics and clears busy; retry recovers; initial failure remains an alert with Retry.
- r3 main-landmark checks: 32/32 exactly one main, zero nested main; zero errors or blocked requests.

All browser contexts restricted to GET/HEAD/OPTIONS on local ports 5180/8010; WebSockets closed. Zero write/external requests observed. Preview dialogs were not submitted, no sessions created, no market downloads or broker/provider calls initiated.

## Findings and corrections

One moderate Axe finding was confirmed in Dashboard: missing main landmark. Root repaired the existing shell whitelist; four Dashboard combinations and representative Live/Market cases passed afterward. The final 32-route shell inventory also passed.

Initial harness failures are retained in `attempt1-report.json`, `attempt2-report.json` and `dashboard-states-attempt1.json`. Corrections were to QA oracles: exact Vietnamese/English copy, the account toolbar's left-column scope, usable width excluding native scrollbar, and waiting for the existing background transition. They were not product repairs.

## Selected visual evidence

- `r2-demo-calendar-dark-vi-1440.png`: r3 capture, connected calendar/sidebar structure.
- `r2-demo-trading-accounts-dark-vi-1440.png`: r3 capture, joined 73px account/sidebar headings.
- `r2-demo-market-data-dark-vi-1440.png`: r3 capture, full-width filters/table/pager.
- `r2-demo-market-data-dark-en-360.png`: r3 capture, native scrollbar and localized mobile controls.
- `r2-demo-calendar-light-vi-360.png`: r3 capture, mobile stacked structure and local calendar scrolling.
- `r2-demo-dashboard-light-vi-360-expanded.png`: r3 capture, expanded chart details/canvas surface.
- `dashboard-refresh-held.png`, `dashboard-initial-error.png`, `synthetic-stale.png`, `synthetic-denied.png`: labeled synthetic state evidence.

Filenames retain `r2-demo-*` to match route IDs; the r3 rerun boundary is explicitly recorded in `report.json`. Older accepted arithmetic/integration evidence was not rerun as a substitute for this focused slice.
