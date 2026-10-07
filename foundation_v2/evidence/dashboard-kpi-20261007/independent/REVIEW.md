# Independent Dashboard KPI review

Scoped PASS, 07/10/2026. The final repaired source passed the assigned Dashboard UI scope. No Live/Market acceptance rerun, source edits, commits, service changes, actual mutations, or broker/provider calls were performed by this reviewer.

## Acceptance evidence

- `report.json`: 26 fresh frozen-source cases after the scrollbar-axis repair. Actual/demo × dark/light × EN/VI × 1440/768/360 gives 24 cases; two additional desktop coarse-pointer demo cases verify 44px touch controls. Twelve source/contract fingerprints remain unchanged before/after this broad run.
- `duration-copy-report.json`: final 8-case subtitle delta, null/invalid/zero/positive duration fields in dark EN desktop and light VI mobile. Its 12 source pins match final files. The only delta from the broad matrix is `DashboardPerformance.jsx` (two subtitle expressions) and `testing-copy.json` (Recorded time copy); geometry/styles remain pinned to the broad acceptance.
- 14 Axe scans in total: 10 broad and 4 final copy-delta scans, zero violations. Zero page errors, external/write requests or page-level horizontal overflow. Native scrollbars remain enabled.
- `states-report.json`: 14 final synthetic GET-state cases, dark EN desktop and light VI mobile for seven states: positive with empty session, unknown/invalid data, zero, blocked, loading, initial error, stale refresh. Source unchanged. These are explicitly intercepted fixtures, not positive actual-feed claims.
- `axis-detail.json`: final native-scrollbar regression. Y ticks align with grid lines within one pixel; keyboard ArrowRight scrolls both monthly charts, and sticky Y-axis X position remains unchanged at maximum horizontal scroll. Source unchanged.
- 12 pure duration oracles include zero, under-one-minute, minute/hour/day decomposition, the demo durations, null/string/bool/negative/nonfinite rejection.

## Outcomes verified

KPI values use 32px/600 hierarchy; units are smaller and localize correctly. Current actual API timing stays unknown (`—`). Demo timing is numeric: 67,200 seconds becomes 18hr 40min; 3,135,600 seconds becomes 36d 7hr. No Buy/Sell metrics were fabricated. The monthly count chart remains labeled closed trade counts.

Count bars use solid peach; win-rate bars use blue and fixed 0–100% with 20% ticks; symbol counts use violet. Computed fills match their named report tokens with no gradients. Bar heights/widths match percentage geometry, grid lines are dashed and align with ticks, and zero bars occupy exactly zero pixels. Invalid/unknown values do not produce fake bars. The independent positive fixture verifies 50% occupies half the plot height.

Summary uses the component font at 13px/500, 32px desktop/768 height equal to adjacent icon controls, and 44px on narrow/coarse-pointer contexts. Keyboard focus has the standard visible outline. Progress text is centered against the actions at desktop. Source uses the sea-blue primary role for progress; text contrast is covered by Axe.

Empty expanded sessions measure about 40px on desktop and remain compact on mobile. Populated demo sessions expose their chart details and collapse again. Unknown/blocked/loading/error/stale states preserve their appropriate notices and busy/error semantics.

## Confirmed defect and repair

The first stable-source matrix caught a real mobile chart defect in all four 360px demo theme/locale combinations: a native 15px horizontal scrollbar shortened the plot but not the sibling Y-axis. The zero tick was 15px below the bar/grid baseline and the middle tick 7.5px below its grid line.

Root repaired the layout by moving the Y-axis into the same flex scroll container as the bars, with a sticky left axis and opaque surface background. No hard-coded scrollbar size or hidden scrollbar was added. Fresh 26-case and 14-state matrices and the keyboard/max-scroll regression passed afterward.

Visual review also caught a subtitle inconsistency for synthetic known actual-mode timing: a numeric zero/positive duration was shown alongside unavailable-data detail. Root now selects subtitle copy using the same typed-duration check as the value. Known actual-mode values say Recorded time; demo known values retain sample copy; null/invalid values retain unavailable copy. The final 8-case delta verifies these branches and zero/positive values, with four additional Axe scans.

Earlier evidence remains separate: `diagnostic-attempt1.json` crossed announced source edits and also contained an overly strict fixed-padding clipping oracle; `confirmed-axis-attempt2.json` retains the real scrollbar-axis failure; `states-pre-axis-fix.json` retains the earlier state pass. Final acceptance uses only the repaired-source reports above.

## Scope and limitation

The existing API does not publish practice/replay durations. Numeric timing fields and their supporting copy were verified with typed demo/synthetic data only. This receipt does not claim current backend timing support. Actual-mode catalog/performance rendering was read-only against the local service; synthetic states are labeled separately.

Representative screenshots inspected: `demo-dark-vi-1440.png`, `demo-light-en-768.png`, mobile demo/expanded captures, `positive-empty-session-dark-en-1440-empty-expanded.png`, `zero-light-vi-360.png`, `mobile-axis-detail.png`, and `mobile-axis-scrolled.png`. Internal chart scrolling is intentional; KPI values and controls fit their surfaces. Build and root test results are owned by the primary checkpoint, not asserted as independently executed here.

`duration-copy-diagnostic1.json` preserves an initial QA copy-oracle failure (expected No, actual translation unavailable); no product repair was needed for that assertion.
