# Independent review — dates and Data Library

08/10/2026. Scoped reviewer; no source edits, no active job changes, no service restart. All browser contexts were isolated, external origins/live API/WebSockets blocked, only loopback GETs allowed.

## Result

Approved for this scoped UI change. No unresolved blocking source or visual finding after parent fixes.

- `qa.mjs` / `results.json`: 7 successful journeys. Actual local cached catalog at dark 1710; explicit saved CSV/Dukascopy, catalog unknown, running and paused fixtures at 1710/768/360 in dark and light. Nine columns, separate data/status, padded dates, unknown candle/storage values, CSV without fabricated Bid, saved QA kept in Details and download dialog dates verified. No page errors or backend mutations.
- The running fixture advances received bytes across polling reads; actual UI-computed speed is exercised with 4.1 GiB received and approximately 32 MiB/s. Percentage/amount/speed remain bounded within 148px. This is a layout fixture, not a network benchmark.
- `date-input.mjs` / `date-input-results.json`: actual Vite component modules mounted in a clearly isolated browser fixture. Vietnamese leap date display, typed ISO callback, 24h wall time, invalid leap rejection, clear/blur recovery, changed max invalidity, native picker ISO-to-text conversion and showPicker click checked. Out-of-range value remains in controlled state until blur, with native validity false; this is expected draft behavior.
- `demo-dates.mjs` / `demo-results.json`: shipped labeled EN demo overview, trade ledger, session list, journal and analytics date-filter journeys. Full date values keep dd/mm/yyyy and 24h even under EN; no raw ISO dates/AM-PM visible in sampled loaded surfaces. Analytics Clear recovers invalid input; Apply produces formatted date-range chip.

## Review findings resolved

- Raw ISO date-range chip in AnalyticsFilterBar found during independent audit and repaired by parent; runtime regression passes.
- Initial provider-only Bid assertion was narrowed by parent to source export settings, preserving CSV unknown price type.
- Date input constraints are revalidated on min/max changes. Invalid draft clears on blur, making Clear interaction consistent.

## Visual review

Reviewed saved actual dark1710, fixture dark1710/dark360/light768, Details light360 and progress dark1710 screenshots. Table dates and metadata align without stacked status text. On narrow screens the table owns horizontal scroll while page remains bounded; existing stacked filter toolbar is unchanged. Dialog content remains scrollable. Progress status is separately visible; row progress percentage/amount uses its own cell.

## Limits and retained attempts

This is scoped date/grid QA, not full product acceptance. Advanced Chart `custom_formatters`/fallback localization were reviewed in source; an actual chart crosshair date render was not exercised. Session-list demo is not an active chart. Do not report chart visual correctness from source configuration alone. Actual download remains untouched, so transfer rates and persistence were not re-benchmarked.

`attempt-1-oracle-error.json` retains the first grid run which incorrectly attempted a mutation menu during a running fixture job; saved-symbol read-only details is the correct route. `date-input-attempt-*` retain Vite harness import/preamble errors, corrected before component checks. `demo-attempt-1-premature-skeleton.json` retains a premature demo observation; final script waits for loaded content and uses exact translated labels.
