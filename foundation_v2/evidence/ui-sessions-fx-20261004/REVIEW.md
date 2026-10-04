# Sessions FX reference redesign independent review

Status: SOURCE CONTRACT PRE-REVIEW; final visual/runtime evidence pending.
Reviewer ownership: read-only product inspection; only this receipt may be written.

Reviewed instructions: parent/project AGENTS; ui-platform-workflow; trading-ui-qa; project-ui.json; PRODUCT-COMPLETION-PLAN; EXECUTION-ENTRYPOINT; WMREPLAY UI scope.
Reference: owner supplied FX Replay Sessions screenshot, layout/workflow only. Do not copy reference financial numbers or imply account/live broker data.

Data and state risks communicated to root before implementation:

- Existing replay analytics uses persisted closed-trade ledger and a closed-trade balance curve. Floating P/L and phase balance resets are excluded. Calling this curve Equity would overstate its semantics; use closed-trade balance.
- Planned risk and realized R are null on replay protective fills. Payoff ratio is average profit/average loss, not planned Risk/Reward. Keep unavailable planned R/R explicit.
- Month/week/day buckets must state UTC and historical scope anchor; QA replay close dates can predate current calendar year.
- Preserve summary sessionAnalyticsQuery filter/cutoff clearing, workspace header, exact selected record ID and dataset provenance. Switching session must not carry stale research job/trade/cutoff.
- Preserve blocked_by_data/stale/partial/empty distinction; unavailable performance must not be rendered as successful zero values.
- Existing PATCH/branch mutations use expected_revision, report 409 conflicts and uncertain write results, and prevent blind retry. GET-only preview may reject writes; render that denial accurately.

Initial inspection covered SessionPicker.jsx, sessionCatalog.js, AnalyticsWorkspace.jsx, replay_analytics.py, analytics_read_model.py and sessionPicker.test.mjs. No product edits or broker/provider operations performed.

Final source and visual review will be appended when root provides the finished change and its evidence.

## Final implementation review, round 1

Source reviewed at root-reported UI hash `303cc39e356c6cc7e6e4f0ad1b266a305c5d1fc981f2828cfd7fcffec16562ed`: SessionPicker.jsx, SessionPerformance.jsx, sessionPerformanceModel.js, session-performance.css; reused dashboard model/read validation and analyticsViewResult.

Semantics: closed-trade balance is correctly named and excludes floating P/L; payoff ratio is distinct from planned R/R; period summaries are anchored to latest close UTC; unavailable source/time/PnL remain unknown; partial/stale notices persist. Session metadata/branch mutation contract remains intact and Trades/Analytics routes retain existing renderer.

Viewed root captures: journeys-final/sessions-dark-1440.png, charts-dark-1440.png, charts-light-320.png, trades-light-1440.png, trades-light-320.png. Main hierarchy matches requested selection/actions → summary/description → three performance panels → six metrics → recent trades. No nested surfaces or decorative left stripe. Mobile charts stack and table stays within intentional horizontally scrollable region.

Two P2 findings sent to root:

1. Bare Recent Trades pagination arrow buttons render black/gray square blocks in light theme, inconsistent with shared neutral rounded controls. Reuse existing secondary button class and verify hover/focus/disabled.
2. Monthly chart fixed-height flex column uses `justify-content:center`; when multiple months overflow, first months extend above scroll origin and cannot be read. Independent labeled DOM-only 12-month rendering fixture confirmed height 220px, scrollHeight 355px, firstTop -135px at scrollTop 0. Evidence `monthly-overflow-probe.json` beside this receipt. Use safe centering/start on overflow; no API or database mutation was performed.

Evidence read: routes-final report scoped read-only service scans; management receipt reports 11 synthetic intercepted API checks (not actual write acceptance). Root final journeys/selected/zoom checks still running at round 1, so acceptance pending fixes and final receipts.

## Independent fix verification and final source pre-acceptance

Both round-1 P2 findings resolved by root; independently rechecked using the live GET-only app and a labeled DOM-only 12-month CSS fixture:

- Safe monthly centering: firstTop 0px at scrollTop 0; scrollHeight 490px for 12 rows, so first and last months are reachable. `justifyContent = safe center`.
- Light pagination buttons: existing secondary button style; 44px wide, 6px radius, white rest, neutral hover, no pointer outline, solid keyboard focus outline. Viewed `independent-pagination-light.png`; disabled previous arrow retains intentional disabled appearance. Data/API responses untouched.
- Results stored in `monthly-overflow-rerun.json` beside this receipt; initial reproduction retained.

Reviewed final root scope guard at source `b941605a08967dbaada546d2402e64d3caebb4461392c813b83f31fcf3fad047`: performance response is keyed to workspace, record ID, catalog revision and reload token, stale previous-scope response hidden immediately, AbortController still rejects late fetches. No remaining source blocker found.

Optional future polish: mobile 320px SVG axis text scales smaller than surrounding chart labels. This is a legibility note, not a financial-data or navigation defect; no full chart-label/WCAG acceptance is claimed.

R3 runtime receipts intentionally retained as diagnostic: journeys timed out on a 10s report wait, without browser errors; zoom case checks pass but source drift invalidates run acceptance. Root is running stable-source serial r4 journeys and then selected route/zoom checks. Do not relabel these earlier failures PASS. Final source/visual review is satisfied; overall scoped runtime acceptance remains conditional on current-source final reports, with no DB write/broker/full-product authority.

## Final scoped decision — PASS

Final UI source `b00bb075c167466012e27ccad88bafe97beff98f4bbff8e6eb32510fd4d9a141` reviewed. No remaining actionable blocker in Sessions redesign scope. This is local Sessions UI acceptance; it does not accept live MT5 account data, backend writes, broker execution, full WCAG/product, canonical visual golden or whole-plan completion.

Final evidence read directly:

- `routes-r5/report.json`: 8 selected Sessions route/theme/width observations SCOPED_PASS, zero failures; source before/after both final b00bb hash.
- `zoom-r5/report.json`: 6 selected native zoom observations SCOPED_PASS, zero failures; source before/after both final b00bb hash.
- `journeys-r4/report.json`: 17 PASS cases, no browser errors or blocked requests: 8 actual GET-only local QA cases, actual trade Analytics/chart-resume journey, and 8 labeled state fixtures. Journey run spans the final scope guard before the small mobile text CSS patch; current-source selected scans and fresh independent mobile rendering verify that last patch.
- `management-final/receipt.json`: 11 intercepted synthetic API checks PASS; no actual local database writes proved or attempted.
- Root reports build 84 modules and 85 unit tests PASS; these counts are root validation, not reviewer reruns.

Fresh independent final mobile check: 320px light theme, actual GET-only service; computed balance SVG text 18px, chart width 196px, document overflow 0. Viewed `independent-chart-light-320-final.png`: larger axis captions remain inside available panel padding, readable relative to previous scaled text, with balance line/month/weekday panels intact. Details in `mobile-chart-final.json`. Optional text finding closed by root CSS patch.

The two P2 findings are resolved and independently verified. Unknown payoff/RR remains a dash; current QA 60 closed trades/net P/L 75 USD is stored synthetic replay data, not actual account performance. Historical UTC month/week/day labels, closed-trade balance scope, lineage/read-state guards and archive-as-preserve semantics are consistent with product contracts. Earlier malformed accessibility markup, timeouts and source-drift attempts remain historical diagnostic FAIL receipts; final pass does not rewrite them.

Product source untouched by reviewer. Only this receipt and independent review artifacts written under reviewer-owned artifact path. No external requests, broker/provider actions, data reseeding, worker/service restart or global configuration changes.
