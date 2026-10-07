# Foundation v2 — PATH-2 development

This is the current development foundation approved by PATH-2. It started with
the F6 reference slice and now contains the FastAPI/PostgreSQL services, research
engine integration and React WMReplay UI. The legacy Flask runtime remains a
reference for capability and semantic comparison, not the development entrypoint.
See the [root README](../README.md) for setup, current UI gates and the canonical
workspace plans. The capability notes below do not claim full product acceptance.

The first slice proves one complete local workflow:

`workspace -> immutable dataset manifest -> durable research job -> bounded worker -> immutable result -> typed API -> web client`

The slice uses PostgreSQL as the transactional authority. Dataset and result
artifacts are content-addressed and immutable. Tenant-facing/API metadata reads
and foreign keys are scoped by `workspace_id`; the internal worker scheduler
claims queued jobs across workspaces and carries the claimed `workspace_id`
through execution. The worker has no MT5 or broker capability.

The Data Desk now has a bounded local CSV seam in addition to the read-only
catalog: `POST /api/v2/data/csv/preview` returns the deterministic quality,
range, normalized hash, dataset identity and holdout report without writing an
artifact, while `POST /api/v2/data/csv/import` persists the same validated
payload as an immutable raw-source plus normalized Parquet dataset. Both routes
accept CSV text in JSON (10 MiB UTF-8 limit), never accept a server-side path,
and remain workspace-scoped through `X-Workspace-Id`; importing does not enable
broker or holdout access.

Selective PATH-2 reuse is explicit in `retained.py`: the existing pure
`data_contracts` and `evidence_metrics` modules remain the semantic source for
this slice while the new runtime, storage, process and API boundaries are built
around them. Acceptance tests guard that those retained modules do not acquire
Flask or SQLite imports.

This foundation does not enable live execution, read holdout data or deploy to
cloud. Existing root launch scripts still start Flask legacy; they do not launch
PATH-2. Follow the root README when developing this foundation.

## Offline instrument catalog

The local imported-history launcher configures the public, keyless Dukascopy
catalog at `https://jetta.dukascopy.com/v1/instruments`. Trading Tools keys are
not used. The catalog preserves display symbols, API codes, upstream group
classification and unknown metadata; it does not establish history coverage.

Authorized GET `/api/v2/data/datasets` reads cached `catalog_items` and
`catalog_state`; it makes no Dukascopy request. The first UI open without a cache
requests POST `/api/v2/data/catalog/refresh`. Later refreshes
require **Cập nhật danh sách**. There is no scheduler, quote stream or automatic
refresh of stale data. Snapshots survive API restarts under the artifact root at
`catalog/dukascopy-instruments.json`; a failed request retains the previous file.
A 60-second server cooldown prevents repeated requests; 429 extends it to five
minutes. Seven-day-old metadata is marked stale but remains usable offline.

Install the separate data worker from the locked npm release of
[dukascopy-node](https://github.com/Leo4815162342/dukascopy-node/tree/v1.50.0):

```powershell
npm ci --prefix foundation_v2/data_worker --ignore-scripts --no-audit --no-fund
npm test --prefix foundation_v2/data_worker
```

The worker requires Node >=18 and pins `dukascopy-node` 1.50.0. It is not bundled
into the web client. POST `/api/v2/data/downloads` accepts an upstream-supported
instrument and inclusive UTC dates, up to 366 completed days. This slice imports
M1/Bid candles only. GET `/api/v2/data/downloads`, POST `/{job_id}/resume` and
POST `/{job_id}/cancel` restore progress across reload/restart. All routes are
workspace-authorized; PostgreSQL advisory locks enforce one network worker and
identify the active job across API processes. Restarted orphan jobs pause until
explicit resume, never automatically retry. A 429 sets a shared cooldown;
timeouts/unavailable responses retain completed raw buckets and never complete
a partial job. No background quote or MT5 collector is enabled by this feature.

Raw day responses and checksums are retained at
`dukascopy/<workspace-hash>/<job-id>/raw`, with `buckets.json` provenance. Only
original timestamps survive the library decoder; inserted flat candles are
removed while original zero-volume candles are preserved. CSV validation and
immutable Parquet ingest are reused. Job completion means every requested day
bucket was fetched and decoded; internal and requested-range boundary gaps remain
visible as `quality.disposition=review`,
not asserted complete market coverage. Each range import creates an immutable
version. Same-job retries recover its existing dataset identity.

These are price-only datasets (`instrument_spec=null`): public quotes do not
establish broker contract/lot sizes. Replay chart viewing works; execution needs
a separately configured instrument spec and cost model. Bid candles do not prove
spread or intrabar stop/target ordering. The library's MIT license covers code,
not permission to redistribute market data; this local owner-requested research
integration does not grant public/commercial data rights.

Scoped checks and limitations: [integration receipt](evidence/dukascopy-integration-20261008/RECEIPT.md).

Session management in Dashboard and Sessions distinguishes archive/restore from
delete. `POST /api/v2/replay/sessions/{id}/delete` requires a strict positive
`expected_revision` and the exact current `confirmation_name`. It appends a
deleted revision; canonical reads, reports and mutations no longer expose that
session, and UI restore cannot revive it. Immutable revisions remain internal
audit evidence; this is not a physical storage purge. Shared Market Data,
independent journal/annotations and other replay branches are preserved.
Deletion is blocked when any persisted Prop attempt revision references the
session. Binding writers lock replay before Prop to prevent a new dependency
from racing deletion. Existing invalid/missing replay bindings are now rejected
when writing a bundle/resume; no schema migration is required.

F7 now has a first software-baseline slice on top of the same foundation:

- tenant-scoped dataset catalog with provenance and an explicit holdout lock;
- validated instrument snapshots, deterministic bid/ask cost preview and point-in-time news visibility;
- immutable-revision Playbook, Journal and chart-annotation records in PostgreSQL;
- replay sessions that expose only the prefix up to the cursor, branch on rewind, and validate annotation cutoffs;
- session metadata updates use `expected_revision`; replay analytics JSON/CSV accept optional
  `cursor_index`, `cutoff_timestamp` (integer dataset bar timestamp), and `event_sequence`.
  Exact event reads require a canonical price-mark/phase/protection checkpoint (or initialization sequence0)
  at the selected cursor. Historical reads project
  the execution checkpoint without updating the session; a mismatched or future bound returns 422.
  Overview aggregates closed trades with branch-origin deduplication and keeps unavailable money/risk fields unknown;
- read-only replay price experiments at `GET /api/v2/replay/sessions/{id}/analytics/experiments`
  share Analytics filters and historical bounds. `stop_distance_ticks`, `stop_multiplier`, and
  `target_r` configure hypothetical stops/targets; they are assumptions, not original planned risk.
  Responses distinguish ready/ambiguous/unsupported results, retain cost and dataset provenance,
  and exclude terminal intrabar extrema from observed excursion to avoid prices after the original exit.
  No ledger, account or broker state is changed;
- chart orders reuse the replay simulator: market orders queue at the decision cutoff and
  fill at the next bar open. `POST /api/v2/replay/sessions/{id}/orders/protection`
  requires `expected_revision`, `target_id`, a new `operation_id`, `stop_loss` and `take_profit`.
  It amends one queued order or open position against the current closeable quote and records
  a typed `protection_change` checkpoint. It does not refill the current bar or change
  balance/equity; the revised protection is evaluated starting with the next bar.
  Historical chart GETs project execution at the selected cursor; unavailable pre-initialization
  checkpoints expose unknown execution instead of canonical future money/positions.
  Prop lifecycle continues to consume price-mark events; same-cursor Prop branching after an
  amendment requires a subsequent price-mark/Prop receipt and is not broadened by this route;
- durable queued/running research cancellation with no result artifact after a successful cancel gate;
- versioned prop-profile evaluation that reports missing equity/HWM inputs as `blocked_by_data`;
- provider-neutral AI boundary, offline by default, with sensitive/holdout guards;
- overview/status read model with explicit blocked reasons;
- execution capability endpoint hard-locked to no broker actions.

This is not U0-U9 product acceptance. The owner-approved visual system, real data
QA/providers, full renderer/drawing acceptance, tenant-safe Learn progress migration,
real AI provider evaluation, broker demo/live acceptance, Miro update and final user
acceptance remain separate gates.

The research API also exposes the latest worker checkpoint through the
read-only `GET /api/v2/research/jobs/{job_id}/checkpoint` route. It is scoped
by `X-Workspace-Id`, returns `checkpoint_not_found` until a worker has persisted
one, and never exposes lease tokens or a resume/execute command. The payload is
progress evidence only (`execution_capability=false`); a future resume workflow
must remain a separately authorized worker operation.

The U3 backend contract now also makes Playbook lifecycle explicit: new records start
as drafts, freezing is an optimistic-revision transition, frozen records are immutable,
and a changed setup is a new draft fork with server-owned parent record/revision
lineage. Journal review revisions cannot rewrite their source context. This hardening
does not claim the supported Playbook/Journal UI or the tenant-safe Learn bridge.

The U5 engine slice adds `/api/v2/research/engine-jobs`. Each job pins a frozen
Playbook record and exact revision, dataset/source/QA/instrument snapshots,
half-open time range, split, cost assumptions, seed, code closure hash and budget.
`bar-breakout-v1` remains the deterministic reference backend while NautilusTrader
1.231.0 is the primary adapter for new supported engine requests. The original
`close-delta-v1` reference route remains separate and unchanged.

The reference strategy decides on closed bars, enters at the next bar open and,
by default, exits at a fixed-horizon close. An optional `protective` mode pins a
stop-market distance, take-profit limit distance and fixed research leverage in
the immutable protocol. The stop distance must equal the planned R denominator.
If one OHLC bar can hit both protective levels without lower-timeframe ordering,
the run fails closed; gap-through stops use the executable modeled opening quote,
while take-profit limits never improve past their limit price. The leverage model
is a research-only starting-balance admission assumption, not broker margin
evidence. Midpoint bars plus constant assumed spread use adverse tick rounding;
slippage is a separate modeled monetary cost. Cost component/net
rounding differences remain explicit as `rounding_adjustment`. Decimal
reconciliation and source-fill checks run before immutable result publication.

The offline paper-account seam is separate from the execution transport. The
`trading_workspace_v2.paper_accounting` module projects immutable paper intents
and explicit fill observations into long-only spot cash/positions with Decimal
fees, partial-fill deltas, duplicate receipt idempotency and unknown-to-
reconciliation handling. It is `PREP_ONLY_OFFLINE`; it does not connect a
broker, provider or network and does not grant paper/demo/live authority.
The Nautilus runtime is project-isolated from the control environment, pins its
lock/runtime identity into the protocol, and runs in a worker-owned Windows Job
Object lifecycle. The engine process additionally applies a 1-process hard limit
and the requested memory ceiling. Native order/fill IDs, nanosecond timestamps,
prices, sides and quantities are bound back to each published ledger trade and
independently reconciled before result publication.

U5 validation is synthetic software/local PostgreSQL integration only. The
Nautilus primary-adapter slice covers next-open timing, independent long/short
cost/tick oracles, real contingent bracket orders for supported protective cases,
gap/horizon/margin/dual-hit fixtures, cancel/deadline/worker-crash cleanup and
hard process memory/count limits. Full U5 still requires replay comparison,
durable progress/restart checkpoints, chronological OOS/walk-forward/stress and
approved real data. Runtime duration is
still enforced by the supervising worker rather than an OS CPU-time cap; input
loading remains batch/row bounded. U2 import QA v3 now classifies
sub-timeframe overlapping bars as review-required without rewriting old manifests.

## Owner-absence host inspection

The owner-absence reducer and hash-chained journal expose a read-only CLI for
cold-start and backup checks. From this directory, run:

```powershell
python -m trading_workspace_v2.owner_absence_host_cli status --journal .\runtime\owner-absence.jsonl
python -m trading_workspace_v2.owner_absence_host_cli cold-start --journal .\runtime\owner-absence.jsonl
python -m trading_workspace_v2.owner_absence_host_cli verify --journal .\runtime\owner-absence.jsonl
```

`status` and `cold-start` replay the journal through the host boundary and
report a persisted running attempt as `ready=false` until a new fence is
presented after boot. `verify` checks the complete hash chain without applying
that boot rule. All commands are inspection-only: they never start or restart
processes, renew leases, contact a provider/broker, send orders, or change the
literal `execution_capability=false` contract. Corrupt or busy journal state
returns a non-zero exit code and is never repaired automatically.

The Python environment is project-local and locked by `uv.lock`:

```powershell
uv sync --project foundation_v2 --python 3.12
```

`foundation_v2/.runtime/` is disposable local acceptance state and is ignored by
Git. Production/user data must not be placed there.
