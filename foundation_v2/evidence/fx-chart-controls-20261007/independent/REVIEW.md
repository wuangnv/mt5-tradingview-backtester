# Independent FX Legacy controls review

PASS for this slice: 13 independent unit tests; 10 focused Axe scans with 0 violations; 17 source SHA-256 pins. No page errors or unexpected requests.

Two actual desktop cases passed before the final focus fix. `report.json` retains the historical resize-focus failure; it is not final acceptance by itself. Fresh `resize-report.json` confirms Layout at 768 px then resize to 1710 px closes the popup and restores visible New Layout focus without changing the cutoff. Fresh 360 px light/Vietnamese `mobile-report.json` passes. No fresh complete four-case independent matrix is claimed. The parent's final five-case matrix, build and 18 unit tests are separate evidence.

Actual widget checks cover text-only session name; clean Save disabled; manual save, autosave and Ctrl+S; single layout supported and multi-chart controls disabled; Layout -> Escape -> Camera PNG download; native Volume visibility; unknown Order cutoff disabling submit; modal inert, focus and Escape; invalid future Go To; Journal Month/Year/day filter; and native chart geometry. Desktop drawers shrink the entire widget and header, keeping the price axis visible without drawer overlap. Mobile drawers use an overlay.

Populated Journal fixtures pass dark desktop and light mobile checks for fractional 0.001/0.002 lot quantities, side search, UTC day PnL, losing and zero-PnL trades, month/year filters, and keyboard Arrow/Home/End with roving tab focus. Real useChartOrder and modal fixtures verify invalid SL rejection, rejected/false submit keeping the modal open, pending Save disabled, successful market save closing and invoking Journal, and protection updates preserving the position target. Blocked and non-FX quantity states pass.

The final edges report verifies localStorage quota failure and manual retry, iframe Ctrl+S, PNG Blob copy through a labeled clipboard fixture, clipboard denial feedback, deferred screenshot cancellation after resolution changes, PNG Download shortcut, and native drawing select/hide/remove using getProperties().visible. The final resolution-race status is empty after widget cleanup; a stale screenshot notice is not certified for disposal.

The application object tree is deliberate because the bundled vendor tree is unavailable through supported actions. Unlike FX's native tree, the desktop drawer occupies full height and shrinks the header. Native fullscreen and IAB readiness are not independently certified here. The parent reports a fresh IAB timeout with cause unconfirmed.

Order and populated Journal execution are labeled local fixtures. The browser permits only local GET/HEAD/OPTIONS and fulfills the exact current-session activity POST with a fixture. Other writes, external origins and WebSockets are blocked. No actual session or broker data was written. Axe checks cover application Order/Journal, not vendor chart or whole page. Final light mobile Order and populated Journal screenshots were inspected.

See final-receipt.json for source pins, reports, resolved findings and limits. Reviewer did not edit product source, stage, commit, restart services, use CUA or claim whole-product completion. Failed attempts remain diagnostic history.
