# Offline library actions, stable columns and inline progress — 2026-10-08

Implemented fixed percentage columns with a stable scrollbar gutter, measured
Parquet size, details/update/delete menus, full-history downloads and inline
transfer progress. No range picker or per-asset CSV clone action remains. The
top-level CSV import remains available.

Full requests derive M1/Bid history from bundled earliest metadata through the
last completed UTC day. Partial saved history backfills; native full versions
append days into a new immutable version so existing sessions keep their pins.
Update availability is calendar-based, not proof the provider has published or
corrected data. Missing buckets/coverage remain reviewable, with no synthetic
candles. Network progress uses actual transferred payload bytes and sampled
MiB/s; total bytes are unknown, while percentage uses completed day buckets.

Delete only removes the selected version's canonical Parquet/raw CSV after
checking historical Replay/Prop and research pins. The public catalog and other
versions/cache remain. Same-ID reimport and publication serialize against deletion.
Disk cleanup errors retain the target ID/journal for explicit retry. Long ingest
steps remain cancellable and keep bounded gap detail with an exact total.

Validation:

- Web `npm run build`: PASS (final rerun recorded at completion).
- Independent UI `independent/qa.mjs`: 4/4 PASS, dark/light360VI and1440EN;
  varying pages1/2/3, fixed width/x, size, details, disabled update, confirmed
  delete success/conflict, full payload, bytes/rate/processing, job recovery,
  resume/cancel and completion refresh. Existing one-way source4/4 regression PASS.
- `integration.py`: actual API/store/artifacts on a created/dropped UUID loopback
  PostgreSQL DB with a synthetic offline Node worker; ten API checks and two
  actual fixture-service browser journeys PASS at1710dark/390light. No upstream
  requests or user database writes.
- Focused full-download Python11/11 + price-only regression1/1 PASS; Node7/7 PASS.
- Existing U2 ingest6/6 PASS on the same disposable DB after services stopped;
  payload4/4 and artifact-security3/3 PASS. No legacy TRUNCATE test used owner DB.
- Removal tests13PASS/1explicit symlink-privilege skip; artifact-security3PASS.
- Independent backend review initially found remote cancel/publication and empty
  weekend-tail bugs; preserved audit with final resolution. Frontend review found
  all-disabled menu Escape; fixed container focus and reran complete journeys.

Scope limits: no real multi-year transfer, speed/disk/coverage benchmark, no
broker/live action or product-wide acceptance. Current localAPI8010 was inspected:
offline launcher, noMT5switch, noactivejobs, noautoload. Runtime activation needs
that process to reload/restart; the UI gates full actions until supports_full is
present, preventing calls to an older backend.

Detailed evidence: `download/RECEIPT.md`, `delete/RECEIPT.md`,
`independent/REVIEW.md`, `backend-review.md`, `integration-results.json` and
`integration-ui-results.json`. Useful screenshots were inspected directly.
