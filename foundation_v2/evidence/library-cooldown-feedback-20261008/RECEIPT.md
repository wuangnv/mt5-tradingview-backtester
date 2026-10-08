# Paused download feedback — 08/10/2026

Actual local GET diagnosed `source_rate_limited`, paused at 1356/8558 days,
28,500,614 received bytes, with 239 seconds remaining at the first observation.
Backend correctly rejects Resume until retry_at expires. Data/cache is retained;
this was not an unavailable worker or broken click handler.

Removed the visible paused label above the meter while retaining state in its
accessible label, tooltip and details. Cooldown displays Chờ/Wait mm:ss below
the bar and explains the source error on Resume. Row and dialog now share one
receipt-based remaining-time helper, so Resume unlocks at expiry without reload.
No automatic retry/resume, provider call, backend change or restart was added.

Validation: production build and 8 metrics/copy tests PASS. Independent browser
review PASS 4/4 (cooldown expiry desktop/mobile VI/EN, manual pause, actual GET)
plus 7 timer boundaries. Fixtures prove expiry unlocks both row and dialog without
another poll. Actual requests remain GET-only with external/live/mutation/WS
blocked. Root visually inspected actual dark desktop and labeled cooldown layout.
See independent/REVIEW.md and results.json, primary/actual.mjs/results.
Successful real provider resume was not attempted and is not claimed.
