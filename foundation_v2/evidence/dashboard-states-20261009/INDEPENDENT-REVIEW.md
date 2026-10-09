# Independent review — optical alignment and Dashboard result states

Date: 09/10/2026. Reviewer: `dashboard_states_review`, independent read-only source/evidence review; this note is the only reviewer write.

## Result

No unresolved findings in the scoped final implementation.

- Reviewed final diff in `DashboardPerformance.jsx`, `dashboardModel.js`, `dashboard.css`, `component-reference.css`, and the new Vietnamese/English messages in `testing-copy.json`.
- Checkbox, radio, and switch share a 28px glyph slot, one center axis, and one caption start. Reviewed dark desktop and light mobile screenshots; measured centers/caption starts agree across all four variants in the final report. Glyph/caption vertical center difference is 0.5px, within the specified 1.5px tolerance.
- Performance derives its prerequisite states from its own overview response and scope. Loading, invalid scope, initial error, denied, unavailable/blocked, and no sessions render one owning state, without dependent placeholder KPIs/charts.
- Existing sessions with no closed trades retain measured practice/replay time, closed count 0, and unknown win rate `—`; charts share one empty message. Date-filtered emptiness uses scoped wording.
- Same-scope refresh keeps values and marks refresh/stale explicitly. Scope changes hide previous results immediately. A subsequent 401/403 clears cached payload. Invalid filter scope cannot remain `aria-busy=true`.
- Partial results now show the readable/total-session notice visibly.
- Retry restores the Performance group independently. Prop reports remain separate and can fail locally while Backtest has no sessions.

## Evidence inspected

- `tests/dashboardStates.browser.mjs`: real Dashboard response fixtures, external-origin and API-write guards, alignment measurement, grouped state assertions, stale/revoked permission, invalid dates, independent Prop state, and a separate actual-service read.
- `report.json`: 29 checks pass; errors and writes are empty. Actual local overview reports `session_count=0`, and the rendered group is `empty` without KPI placeholders.
- `smoke/report.json`: pass for the recorded VI/EN routes and reference journeys.
- Screenshots: `choices-dark-1440.png`, `choices-light-360.png`, `empty-dashboard-dark-360.png`, `no-trades-dark.png`, and `actual-dashboard.png`.
- Reviewer ran `git diff --check`; no whitespace errors (Git reports only expected LF/CRLF conversion notices).
- Prior `failure.json` records test-harness failures and remains historical failure evidence; final `report.json` is the successful rerun. The reviewer did not rerun the model tests/build; those executions are reported by the implementation owner.

## Limits

The migrated owner is the real Dashboard **Performance** source and its dependent KPIs/report charts. Recent Sessions catalog and Prop reports retain their independent reads and states; this change does not migrate their broader workspace-change/stale-data behavior. The actual service journey proves the current no-session state; nonempty/error/stale/denied journeys are explicitly labeled response fixtures. This scoped acceptance does not establish whole-product, trading-chart, provider, or broker acceptance.
