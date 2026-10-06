# Dashboard notice, session chart action and Analytics tab alignment

Scope: the owner's three browser comments. Product baseline: `659555e`.

The long partial-data line is removed from the Dashboard body. A neutral info icon beside Performance retains the readable/total session count through its accessible name and hover/focus tooltip. Partial results are still partial; blocked data, loading, errors and empty results keep their existing explicit notices and unknown values. No aggregation or filter state changed.

Both session chart actions now reuse `SessionChartLink`: the same Go to chart label, play SVG, pill style and existing chart URL. The empty-state illustration rule targets only its direct SVG, so it cannot resize or recolor the button icon. Archived/missing-dataset availability and the demo-disabled chart gate are preserved.

Analytics uses three equal grid columns, matching heights, spacing and rounded controls. The outer tab-bar surface is removed. The filter-to-tabs margin is removed only when the tabs immediately follow the filter; state messages and Prop objectives retain their separation. The redundant demo report wrapper was removed so demo and actual reports use the same layout and avoid a second grid gap. Mouse/keyboard selection and report calculation are unchanged.

Validation:

- From `foundation_v2/web`: `node tests/pagePolish.browser.mjs` — 20 checks PASS, zero page errors or API writes. Tests cover dark/light at 360/768/1710px: labeled partial fixture with keyboard tooltip, actual read-only empty Session chart CTA style/route, demo Analytics equal tabs and keyboard selection, plus blocked/error fixtures preserving unknown values.
- The final tab spacing oracle measures the whole region: row top minus preceding filter bottom equals band bottom minus row bottom (8px), rather than checking only the band's own padding.
- Independent review: 45 checks PASS (36 main, 6 Prop tabs, 3 actual GET-only journeys), zero page errors or write attempts, source unchanged. Final pins and evidence: `independent/REVIEW.md` and reports in that directory. The actual selected session remains blocked for Analytics because execution has not been initialized; its tab layout is verified with demo/fixtures, not claimed as an initialized actual report.
- `npm run build` — PASS, existing Vite large-chunk warning. `node --check tests/dashboardSessions.browser.mjs` and `git diff --check` — PASS. The legacy Dashboard harness's two partial-state assertions were updated to the new accessible indicator; the whole legacy fixture journey was not rerun against today's catalog.

Visual review caught a first-pass 28px gap above the tabs from the analytics-filter margin and a redundant demo grid wrapper. Those causes were fixed and final runtime checks rerun. `primary/report-r1-spacing.json` and `primary/analytics-r1-spacing-dark-1710.png` preserve the initial evidence; the initial DOM checks were insufficient for that spacing, so they do not establish visual acceptance.

Reviewed final images include `primary/analytics-dark-1710.png`, `primary/analytics-light-360.png`, `primary/chart-cta-light-768.png` and `primary/dashboard-dark-360.png`. Keyboard focus outlines in these images are intentional.

No actual session was edited, archived or deleted; browser QA allows read-only API calls and labeled intercepted fixtures only. This is acceptance of these three UI changes, not whole-product, broker or full WCAG acceptance. The existing narrow Analytics report overflow remains outside this scope. Revert the page-polish commit to roll back; no migration is required.
