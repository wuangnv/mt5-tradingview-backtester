# Independent review — three page refinements, 2026-10-06

**SCOPED_PASS: 45/45 browser checks on the final frozen source.** Main matrix 36/36, Prop firm tab matrix 6/6, actual GET-only journeys 3/3. No blocking finding remains. Reviewer edited only this evidence directory, with no product source change or commit.

## Final commands and receipts

Run from `projects/mt5-tradingview-backtester`:

```powershell
node foundation_v2/evidence/fx-page-polish-20261006/independent/review.mjs
node foundation_v2/evidence/fx-page-polish-20261006/independent/prop.mjs
node foundation_v2/evidence/fx-page-polish-20261006/independent/actual.mjs
```

All three return `pass:true`, `sourceUnchanged:true`, `errors:[]`, `blocked:[]`. `report.json` and `actual-report.json` pin nine related frontend files before/after, including all eight changed files plus unchanged `FxAnalytics.jsx`. `prop-report.json` separately pins the three tab-layout files.

## Main matrix and semantics

- Dashboard, Sessions, Analytics demo screenshots at **360/768/1710 × dark/light**: 18 cases. Demo requires no API traffic.
- Synthetic GET-only Dashboard partial payload **3/5 readable sessions** at all six viewport/theme combinations: the old partial body line is absent; the info SVG beside Performance is focusable and exposes the scope in its accessible label. Tooltip appears on hover and keyboard focus, contains 3/5, and fits its content bounds. Ready demo has no partial icon and no unnecessary body notice.
- Synthetic GET-only empty Sessions at all six combinations: empty-state and summary links both say **Go to chart**, have the same href and computed button style, and contain the same play SVG. URL targets the same QA session with `view=replay`, `surface=workspace`, and no `select` picker flag. Keyboard focus works. These links were inspected, not activated into replay execution.
- Six state cases: Dashboard blocked retains a visible status message and unknown metrics; Dashboard HTTP error retains an alert. Archived or unavailable-dataset sessions hide the empty-state chart CTA. An uninitialized execution payload still permits the chart link for a valid active session, while an analytics HTTP error shows its alert and does not render replacement performance data.

## Analytics geometry and keyboard

- Performance, Drawdown, Simulation occupy three equal columns, with width differences below 1px, on one row at every tested width/theme. The band has 8px top/bottom padding and a full-width 1px separator that reaches the actual content client edges.
- In Sessions analytics, measured button-top to preceding filter-divider spacing equals measured button-bottom to tab-divider spacing: **8px/8px**. This tests the visible region, not just the band's own padding.
- ArrowRight selects Drawdown, End selects Simulation, and Home returns to Performance with roving selected/focus state preserved.
- Prop firm analytics receives six additional width/theme checks. Equal tab widths and 8px band padding pass there too; Challenge objectives remain between filters and tabs with their original separation. ArrowRight/ArrowLeft selection passes.

## Actual GET-only evidence

UI5180 traffic is proxied to API8010 only for GET/HEAD/OPTIONS, with external traffic, writes, and WebSockets blocked. Actual workspace `tenant-a` session `476f4b498e1a49ed9d48a75719f4d270`:

- Dashboard reports partial **4/6 readable sessions** through its heading tooltip, with an empty body notice.
- Sessions empty CTA matches summary href exactly, and its play SVG is **18px**, not the empty illustration's 48px.
- Actual Analytics reports `blocked_by_data` for this session's uninitialized execution; no initialized-report tablist is expected. Demo/fixture reports cover the tab layout.
- Catalog and selected record GET snapshots are identical before/after. No actual write, broker/provider action, or replay initialization occurred.

## Finding resolved during review

The first geometry assertion checked only tab-band padding and passed, but screenshot review found visible space above the tabs was **28px margin + 8px padding**, versus 8px below. The root removed the redundant demo `.fxa-report` grid wrapper and cleared filter bottom margin only when the tab band is the immediate next sibling. Final geometry proves visible 8px/8px spacing; Prop objectives keep their separate spacing.

`report-r1-tabs-own-padding-only.json` retains the original incomplete oracle result. `actual-r1-no-initialized-analytics.json` retains an initial tablist wait timeout on the uninitialized actual session; the final actual oracle checks the explicit blocked state instead. These are distinct from the final passing receipts.

## Scope and limits

Screenshots for all tested sizes were generated and representative final Dashboard tooltip, Sessions CTA, Sessions/Prop analytics bands were visually reviewed. This does not assert full-product/whole-plan completion, initialized real analytics, broker execution, or live trading acceptance. Synthetic GET fixtures never become backend records. Existing unrelated Analytics360 report overflow is outside this slice; document overflow remains zero in the demo matrix.
