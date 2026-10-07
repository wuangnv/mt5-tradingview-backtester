# Independent Dukascopy catalog cache review — 2026-10-08

**PASS: 25 browser fixture journeys and 6 independent backend probe groups.** No remaining finding in metadata-cache scope. Reviewer changed evidence only; no product edits, commits, external requests or user database writes.

## Reproducibility

Run from product root:

```text
node foundation_v2/evidence/dukascopy-catalog-20261008/independent/review.mjs
foundation_v2/.venv/Scripts/python.exe foundation_v2/evidence/dukascopy-catalog-20261008/independent/backend_probe.py
foundation_v2/.venv/Scripts/python.exe foundation_v2/evidence/dukascopy-catalog-20261008/independent/cache_probe.py
```

Results: `review.json`, `backend-probe.json`, `cache-probe.json`. Python transports are httpx.MockTransport; cache fixtures are created only inside this evidence directory and removed after probes. Browser fixtures intercept all catalog refresh POSTs and dataset GETs, with explicit isolated-QA/offline fixture rows. External origins, other writes, provider/MT5/Live routes and WebSockets blocked; fresh contexts use no personal profiles.

## UI/data-flow findings

- Missing-key, cached, stale and rate-limited states each pass dark/light at 360/1710. Missing key disables refresh and displays reason; cached/stale/error reads issue no refresh POST. Existing offline datasets remain visible.
- Bootstrap success/failure and manual success/HTTP failure pass dark/light at 360. Empty configured bootstrap issues one intercepted POST. Cached bootstrap does not refresh. Manual success updates instruments, keeps datasets and applies cooldown; failed updates retain both previous metadata and offline datasets, with a status message.
- Cooldown expiry re-enables refresh through local timer, without polling or additional GET/POST. Request counts verified per journey during a bounded observation window.
- Download controls stay disabled. Unknown asset categories remain labeled unclassified rather than inferred.
- No page errors, forbidden requests or document horizontal overflow. Refresh/filter/sort/CSV controls fit viewport. Inspected `missing-dark-1710.png`, `stale-light-360.png`, `manual-http-error-dark-360.png` and `bootstrap-success-dark-360.png`; neutral controls/status and contained table scrolling remain consistent with the page.

## Backend/security/concurrency

- Missing key produces no transport call. Status/error output and persisted cache contain no fixture key or upstream extra-secret field.
- Persisted public fields round-trip as UTF8; cache source/version/timestamp/digest validation fails closed. Corrupt digest is rejected without network. Capabilities remain metadata-only; history, quotes, import, news and holdout are false.
- Held refresh transport does not block cached status/list reads: measured about 0.016ms. Two concurrent refresh callers cause one mocked request under cooldown. Separate refresh serialization and short memory lock avoid the earlier GET stall.
- 403, 429, redirect 302, 503, invalid JSON, empty list and oversized body preserve previous cached instruments. Generic errors are returned; no redirects followed by production client. Rate limit uses at least 299 seconds remaining; second refresh during cooldown issues no HTTP.
- API source review confirms POST refresh uses existing `workspace_id` authorization dependency. GET only reads registered providers' cached metadata and status. Launcher passes optional env key to fixed Dukascopy endpoint and stores cache under local artifact catalog; key is not sent to frontend.

## Resolved finding

Initial probe accepted a 1,390,000-byte upstream response, wrote a 3,205,229-byte cache containing both raw and normalized instruments, then rejected its own cache on reload. Parent changed persisted representation to sanitized raw fields only, bounded UTF8 bytes, with normalized items kept in memory. Final 5000-item cache is 1,390,218 bytes and reloads correctly without key. Initial proof retained in `cache-before-fix.json`.

## Limits and source fingerprints

No real issued Dukascopy key or successful upstream integration was tested. This receipt covers cached public metadata behavior and isolated transport contracts; it does not certify provider entitlement, categories, historical downloads, trading or dataset quality. Root owns primary API/unit/build acceptance.

Final fingerprints (full source hashes also in `review.json`):

```text
dukascopy_catalog.py e6abb4e6561e855829096c9ad56284191e0c0c4973cabc67e694ccd4aa0939d4
DataDeskWorkspace.jsx 3357b9009c813af443b7765e678a12c811ff72c103fbc86ab0b0ef67947d175c
dataDeskApi.js 3bb73cda3bd474e8a492f77776dbddfe290ad62af95c1bdc7b0da6a80b85007e
data-library.css 247e673246a6d12417a4465a3369ef4ff5cdc1fd3c2141504cea250e406338bf
api.py 106460fed73aff2f7a8f34ce0795d57e9467edcc3fe2f7b3a63972cd51a2b5cd
serve_exness_history.py 55e647dc419f47b85500abd39d31ff39686978571d4f092d40faf1dc46577e40
```
