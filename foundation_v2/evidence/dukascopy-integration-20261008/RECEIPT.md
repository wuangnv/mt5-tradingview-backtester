# Dukascopy offline integration — 08/10/2026

Scope: owner-requested integration of `dukascopy-node` into the existing
Trading Workspace product. No MT5, live account, broker execution, holdout,
public deployment, new key/account or paid service was enabled.

## Result and data flow

Keyless public catalog → local atomic cache → explicit date-range request →
pinned Node worker → checksummed raw day buckets → original M1/Bid candles →
existing CSV validation → immutable Parquet/manifest → Kho dữ liệu/replay.

The npm release is pinned at `dukascopy-node@1.50.0` with lockfile integrity in
`foundation_v2/data_worker`, outside the frontend dependency graph. Source:
https://github.com/Leo4815162342/dukascopy-node/tree/v1.50.0 . MIT covers library
code; no blanket market-data redistribution permission is inferred. Package
install used `--ignore-scripts`; npm production dependency audit reported zero
advisories at verification time.

Catalog uses anonymous `https://jetta.dukascopy.com/v1/instruments`; actual HTTP200
returned1504 entries. Display symbols and API codes differ (`EUR/USD` vs
`EUR-USD`); group hierarchy and missing precision are preserved, not guessed.
Catalog count does not establish downloadable history for every asset. The
library's bundled metadata determines supported symbols and earliest M1 dates.

Downloads have inclusive UTC dates, maximum366 completed days, one network
worker, fifteen-second request timeout, bounded responses, one-second pauses
between uncached days, progress, cancel and explicit resume. PostgreSQL session
advisory locks cover global admission and individual job ownership across API
processes. No automatic provider retries or scheduled updates.429 imposes a
shared cooldown; interruptions preserve raw buckets and hashes. Completed
buckets are reused; corrupt cache fails closed. Restarted orphan jobs pause.

The upstream decoder can insert flat candles. This adapter intersects decoded
rows with actual source timestamps, retaining original zero-volume rows while
discarding synthesized rows. HTTP failures cannot become successful empty
buckets. Valid HTTP200 empty weekend buckets remain empty.

Raw responses/bucket manifest remain local alongside the job. Source export
settings pin library/version, UTC/Bid/M1, requested interval and raw-bucket hash.
Public price feeds do not establish broker lot/contract sizes, so these imports
have `instrument_spec=null` instead of fabricated trading metadata.

Internal gaps and absent requested-range edges are reported with unknown
classification and review disposition. No market-calendar closure is invented.
Job completion means all requested day requests decoded and import succeeded;
it does not certify complete expected market coverage or execution fidelity.
M1/Bid does not supply spread, ticks or intrabar SL/TP order.

## Verification

- Sixteen Python focused tests pass:15 keyless catalog +1 price-only/boundary
  coverage regression. Six existing U2 CSV/ingest tests pass on a UUID disposable
  PostgreSQL database; the user database was never used for TRUNCATE tests.
- Four Node worker tests pass: original timestamps/zero volume, malformed OHLC/
  duplicate deltas,429/redirect/body limit, raw cache resume and checksum tamper.
- Nine frontend Node tests pass; Vite production build and diff whitespace
  checks pass. No build, node_modules or runtime cache is staged.
- `verify_dukascopy_integration.py`: actual anonymous catalog and one EUR/USD
  day05/10/2026 UTC download/import.1438 source bars, internal gap1 and trailing
  minute1 absent, review required. Auth/cross-workspace denial, date/support
  checks, idempotent same-job request, restart read and replay creation pass.
- Explicitly labeled fault injection covers429 cooldown, no phantom dataset,
  cancel, orphan recovery and remote-owner resume denial. No provider requests
  were made by fault fixtures. Disposable API8031/DB were removed afterward.
- Primary mocked UI4 journeys: start error/success, completion, idle polling,
  reload paused, resume failure/success, cancellation and quality display.
- Independent review:8 mocked cases,6 real-data cases at360/768/1440 dark/light,
  actual legacy chart candles, then2 real boundary-coverage delta cases and
  mobile focus token check. See `independent/REVIEW.md` and its scripts/reports.
  Root inspected representative desktop/mobile screenshots.
- Actual runtime8010 restarted with no MT5 options. Catalog1504 cached,
  one owner EUR/USD dataset1438 rows and completed job retained; both5180 and
  8010 listeners verified. This initial owner sample predates the final boundary
  field addition; its immutable manifest was preserved, not rewritten.

## Decisions and limits

Reuse the audited release through a separate worker instead of copying upstream
source or adding a downloader to the web bundle. Reuse ingest/quality/manifest
contracts. Store price-only data honestly; chart viewing is verified, broker
spec/cost configuration remains separate. MT5 and online work remain deferred.

No bulk/all-asset or multi-year availability claim. Download resume was verified
for completed raw buckets and service interruption; power-loss durability and
artifact-publication crash recovery inherited from ingest are not certified by
this slice. Public/commercial data use requires its own entitlement review.

Rollback code through the integration commit; keep user runtime/catalog/raw
files and dataset manifests. Runtime lives in the existing artifact root and is
not treated as disposable QA output.
