# Independent review: replay timing and native chart

PASS for this slice. No remaining actionable finding on the final source.

Independently executed 13 browser cases and 14 focused tests:

- Real hook, held old POST, same-key effect teardown/re-entry, new pending intervals: the disposed owner cannot overwrite the new owner's outbox. Old acknowledged event remains durable for an idempotent retry.
- Four real replay journeys: advanced/fallback, dark/light, VI/EN, desktop/mobile. Reload keeps event identity and interval; hidden/blur fixture stops accumulation; foreground focus resumes.
- Four native chart cases: advanced chart uses exact native candle/background colors, changes theme and preserves it through reload, and disables `widget_logo`. Fallback renders exact native green/red/background pixels and no attribution link.
- Four invalid success receipts: wrong schema, event ID, session ID, or duration cannot discard the pending event; a valid retry retains the original interval.
- Backend tests: 9 pass, 1 database case intentionally deselected. Clock tests: 5 pass. Focused diff check passes.

Source audit covered tenant-specific activity identity/FK and deletion, interval validation/union, optimistic revision conflicts, branch timing reset, legacy baseline semantics, hook listeners/queue lifecycle, native palette restoration, and fallback palette flow. `chartSeriesPalette` only maps roles supplied by `nativeChartPalette`; it does not inject app colors. Practice time unions selected-session activity; historical time sums successful forward timestamp deltas. Trade filters do not rewrite timing. Missing legacy history remains unknown.

All browser activity POSTs returned labeled fixtures. GET/HEAD/OPTIONS were restricted to ports 5180/8010; other writes/external requests/WebSockets were blocked. Final runs had no page errors or unexpected requests. No service restart, broker/MT5 access, replay step/order/create mutation, product edit, staging, or commit was performed by this reviewer.

The backend's disposable PostgreSQL regression was executed separately by root/backend agents; it is not counted as independently executed here. Hidden/focus browser coverage uses explicit getter/event fixtures, not an OS minimized-window test. Root's primary script covers idle/iframe wake; independent clock tests also exercise idle, suspension, and wall-clock discontinuities. No new Axe scan was run for this focused timing/palette slice.

Harness corrections retained in `report-attempt2-fallback-selector.json`, `native-extra-attempt1-theme-settle.json`, and `native-extra-attempt2-preference-reseed.json`: fallback has no `data-chart-engine`; the initial native harness reseeded the original theme at every reload. The earlier hook import initially addressed `createRoot` as a named export rather than the Vite CJS default and was corrected. These were harness failures, not product regressions.

Screenshots named `chart-advanced-<initial-theme>-<width>.png` show the opposite theme after toggle/reload; the corresponding JSON records the three verified theme states. `final-receipt.json` pins 19 final source/test/document files. This receipt does not claim whole-product completion.
