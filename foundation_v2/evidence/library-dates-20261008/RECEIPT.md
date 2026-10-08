# Vietnamese date/time and offline grid receipt

08/10/2026 — scoped UI change in foundation_v2.

- Full-date display uses dd/mm/yyyy; time uses 24-hour HH:mm or HH:mm:ss. Same under VI/EN. Shared formatter and input parsing contract documented in ui/workspace-patterns.md.
- Date/time fields show Vietnamese-format text, retain native picker and emit existing ISO form values. Storage, API, timezone, sorting and actual download jobs remain unchanged.
- Grid separates data type/status/history, keeps unknown counts and replay sizes as —, moves QA solely to Details. Price type comes from provenance, not provider-name inference.
- Progress is a flat two-line percentage/bytes/speed action with thin baseline. Status lives in its own column; pause/resume/cancel remain separate. Unknown upstream total bytes are not fabricated.

Validation: Vite production build passed; 24 focused formatter/model/analytics/session regression tests passed; independent review approved 7 grid browser journeys (actual cached catalog + explicit fixtures, dark/light,1710/768/360), isolated date-input interactions, and 5 representative shipped demo page journeys in EN. Read-only contexts blocked external/live/mutations. See independent/REVIEW.md, scripts, results and screenshots.

Limit: chart custom formatters were checked against installed v23 API typings and fallback configuration; actual chart crosshair date appearance was not exercised. This does not claim whole-product acceptance or a new download performance benchmark. Existing actual paused EUR/USD job untouched.
