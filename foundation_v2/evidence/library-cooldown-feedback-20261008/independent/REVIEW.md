# Independent review: paused download cooldown feedback

Result: PASS4/4 browser cases plus7 retry-time boundary cases. Run `node foundation_v2/evidence/library-cooldown-feedback-20261008/independent/qa.mjs` from the product root; results are in `results.json`.

Reviewed the shared `downloadRetrySeconds` helper and its row/dialog callers. Both use the same received timestamp and UI clock. The helper rounds positive fractional remaining seconds upward, clamps expired waits to zero, and prevents a backward clock from increasing wait beyond the received delay. Boundary cases cover immediate239 seconds, subsecond countdown, exact one-second advancement, expiry, long-after-expiry, backward clock, and absent wait.

Two labeled4-second fixtures cover dark1710 Vietnamese and light360 English. Initial row text shows `Chờ00:04` / `Wait00:04`, Resume is disabled, and its title explains the source rate limit. The dialog matches the row's disabled state. Both automatically become enabled after expiry, clear the wait text to an em dash, and restore the ordinary Resume title without reload, mutation, or additional downloads poll (one initial GET only).

A manual-pause fixture has no countdown and Resume is immediately enabled. The paused label above the meter is absent in every case; the full paused state remains in the meter accessible label and title. The actual GET-only light360 case showed a still-paused EUR/USD job at rounded16 percent/27.2 MiB with a remaining50-second source cooldown and correctly disabled Resume. No resume was attempted.

Visually inspected dark desktop and English mobile initial cooldown screenshots and the actual mobile final screenshot. Progress, amount, wait text, and play/cancel controls fit their fixed table cell. Native horizontal table scrolling is retained on mobile. Zero document overflow, browser errors, or attempted writes occurred; external origins, live routes, WebSockets, and non-read requests were blocked.

Acceptance is scoped to cooldown presentation and frontend expiry gating. The four-second expiry is labeled fixture evidence, not an operation on the real job. Provider recovery and successful real resume were not exercised. No source edit, commit, broker action, service restart, or network benchmark was performed.
