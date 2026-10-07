# Offline library grid — 2026-10-07

Implemented the approved single-table presentation with category column,
left-aligned search and right-aligned Recent Sessions-style filters/sort/CSV.
Removed the count and create-session action. The row ellipsis is a dropdown
action menu; it opens details or prefilled CSV import only after an action is
selected. Category is saved in instrument_spec; CSV updates use new immutable
dataset IDs. Old versions remain usable. No tenant-a data was imported.

Removed exactly the redundant zero-closed-trades Dashboard notice. Loading,
error, stale and blocked notices remain.

## Scope and actual source state

The dataset API includes optional catalog_items from configured providers only.
This metadata extension performs no provider discovery, changes no entitlement,
and grants no historical-download or broker capability. Default local catalog
has no unloaded instruments; the real library remains empty after the approved
purge. Populated catalog screenshots are explicitly QA fixtures, not Dukascopy
data. Loaded rows show disabled Downloaded; unloaded fixture metadata shows
disabled Download with a source-unavailable tooltip. Direct download, automatic
update, editing/deletion of stored versions, and a real Dukascopy inventory are
not implemented by this UI slice. The row CSV update path is functional.

Official Dukascopy sources inspected on this date:

- [Instruments API documentation](https://www.dukascopy.com/trading-tools/api/documentation/instruments)
  and its documentation JSON: instrumentList supports the full list when the
  optional instruments filter is omitted; it requires an issued key. No key was
  registered or supplied, and the actual instrument list/count was not fetched.
- [Historical Data Export](https://www.dukascopy.com/swiss/english/marketwatch/historical/)
  offers CSV history. This is distinct from authenticated trading APIs.
- [Terms](https://www.dukascopy.com/swiss/english/legal-pages/terms-of-use/)
  and [Historical Price Data guide](https://www.dukascopy.com/wiki/en/development/data-export/)
  were checked. The latter describes AWS requester-pays access; it is not a free
  anonymous adapter. Existing storage/network readiness gate remains unchanged.

No guessed asset count, fictional source, provider dependency, key/account
registration, MT5 polling or live execution was introduced.

## Verification

- Vite production build passes.
- Eight focused Node tests cover CSV API scope, category metadata, composed
  filters, deterministic sort and dataset-version retention.
- Eighteen Python tests pass in a disposable loopback PostgreSQL database:
  provider boundary/readiness, CSV payload and ingest. A real TestClient journey
  verifies metal-category preview/import, two changed CSV versions, byte-identical
  preservation of the first artifact and denial of another workspace. The temporary
  database and artifact root are removed afterward. See api-verification.json.
- Primary Playwright: 11 journeys pass, including real empty local service and
  Dashboard, dark/light, VI/EN, widths 360/768/1260/1428/1710, filter/sort/search,
  action menu, focus/Escape, pending preview locking and CSV-refresh fixtures.
- Independent review: 10 journeys and eight offscreen menu-entry regressions pass.
  Review found a real delayed-scroll menu dismissal; final code repositions the
  menu on scrolling, and both failed journeys pass afterward. See
  [independent review](independent/REVIEW.md). No remaining scoped finding.

Runnable commands from the product root:

```powershell
node foundation_v2/evidence/offline-library-grid-20261007/verify.mjs
foundation_v2/.venv/Scripts/python.exe foundation_v2/evidence/offline-library-grid-20261007/api_verify.py
node foundation_v2/evidence/offline-library-grid-20261007/independent/review.mjs
node foundation_v2/evidence/offline-library-grid-20261007/independent/menu-scroll-race.mjs
```

The local API was restarted with its same offline-only launcher on 8010, with no
MT5/ticks flags. Vite remains on 5180. Real provider/history completeness, other
asset-class engine support and whole-product acceptance remain separate.
