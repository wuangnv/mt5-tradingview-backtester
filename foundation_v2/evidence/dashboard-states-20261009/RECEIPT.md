# Dashboard state ownership and choice alignment — 09/10/2026

Scope: owner's follow-up on optical alignment and whether the prior data-state
brief was implemented. Prior Compact0.1.1 defined the contract/specimen only.
This change applies that contract to the actual Dashboard Performance component.

Choices: same28px grid slot centers16px checkbox/radio and28px switch; captions
share one start edge and20px line height. No per-control optical offsets.

Performance owns the overview response, not the independent recent-session
catalog or Prop report. Initial reads show one skeleton. Error/denied/unavailable,
blocked execution and no sessions show one shared state with no dependent KPI
or charts. No closed trades retains measured timing, count0 and unknown win rate,
with one chart-group empty message. Date-filtered zero uses date-scope wording.
Partial scope is visible; same-scope refresh retains known results and marks
failed refresh stale; scope change hides prior values.401/403 clear cached data.
Invalid dates show one alert, no false busy state. API schema/calculations remain
unchanged; HTTP status is retained on the existing overview error for UI decisions.

Validation:
- `node tests/dashboardStates.browser.mjs`:29 checks PASS, no runtime errors/writes.
  Fixtures exercise the real Dashboard component in dark/light; grouped states,
  retry, no-trade timing/zero/unknown, partial, refresh/stale/denied, scope loading,
  invalid dates and independently failed Prop reports. Choice centers/caption
  alignment measured at1440/360px; Dashboard screenshots have no page overflow.
- Actual local read against tenant-a overview confirmed session_count0 and the
  real empty group; actual-dashboard.png records that read with no API mutations.
- `node --test tests/dashboardModel.test.mjs tests/dashboardSessions.test.mjs`:
  16 PASS.
- Testing smoke:12 routes +2 reference journeys PASS, VI/EN, no writes.
- `npm run build`:PASS. Final diff check and independent review recorded separately.

Two initial harness failures were repaired and the full focused journey rerun:
the locator used an old untranslated period label; the actual-read wait treated
an absent DOM node as a completed state. Neither was accepted as product success.

Limits: source/state acceptance is scoped to Performance and the reference choice
layout. Other component flows are not globally migrated. Recent-session catalog
and Prop cache/workspace transitions remain separate work; an independent review
noted their pre-existing workspace-state risks. Fixture success is distinguished
from the real no-session read; no broker, provider or financial execution occurred.
