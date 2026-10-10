# Dashboard recent-session priority — 10 October 2026

Owner feedback on the sample dashboard applies to actual data mode as well. The shared `DashboardSessions` now renders quick actions → Recent Sessions → Performance. Recent Sessions shows at most three cards per page; the same `DASHBOARD_PAGE_SIZE` governs local preview slices, actual list requests and response validation. The count describes cards displayed against all matching sessions. Filters/search still cover the complete catalog; Performance has an independent scope.

The Overview preview selector includes “Nhiều phiên mẫu” (`demo=1&ui_state=many`): 12 unique sessions, four pages of three. Nine additional sessions have no trades, preserving the original 60-trade financial oracle. Sessions and Analytics resolve these extra fixtures through the shared `demoSessionItems()` catalog rather than falling back to an unrelated original session. The option is disabled outside Overview; a selected extra session remains readable through its Summary/Analytics links.

## Verification

- Focused frontend tests: 24 passed, covering the three-item request/response contract, fixture financial totals and extra-session catalog resolution.
- Backend test: two cases passed against 1,000 in-memory records at page sizes 3/6. Summaries are computed only for the requested page, cached reads do not compute again, facets remain complete and pages do not overlap. No database mutation.
- Actual local GET accepted `page_size=3`, returned the current single owner session, and retained `dashboard-session-list-v1`.
- Browser report: 97 cases passed, covering dark/light at 1440/390/360/320px, all simulated states and eight additional pages; pagination visits all 12 IDs once, search finds a session outside the initial page, Performance remains at 60 trades, and actual mode uses the same section order. A separate journey opens an extra session's Summary, reloads and opens Analytics. No page errors, preview API requests or writes. External origins and writes were blocked.
- Production Vite build passed under `.runtime/dashboard-recents/dist` (not committed).
- Independent review `/root/state_preview_review` approved source/layout and verified Practice 12 → Summary → reload → Analytics: correct session and 10,000 USD balance, P/L/trade count 0, win rate/R unknown as `—`, no API requests or writes.

Review caught and corrected the initial extra-session fallback to London Breakout. Test oracles were also corrected to account for the day badge in a card heading, translated Analytics titles and the session name being in `aria-label` rather than the generic visible trigger text. Fixture checks are simulation evidence; actual data mode was checked read-only against current local services.
