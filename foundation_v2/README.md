# Foundation v2 reference slice

This directory is the F6 PATH-2 reference slice. It is intentionally isolated
from the current Flask runtime while that runtime remains a read-only reference
for capability and semantic comparison.

The first slice proves one complete local workflow:

`workspace -> immutable dataset manifest -> durable research job -> bounded worker -> immutable result -> typed API -> web client`

The slice uses PostgreSQL as the transactional authority. Dataset and result
artifacts are content-addressed and immutable. Tenant-facing/API metadata reads
and foreign keys are scoped by `workspace_id`; the internal worker scheduler
claims queued jobs across workspaces and carries the claimed `workspace_id`
through execution. The worker has no MT5 or broker capability.

Selective PATH-2 reuse is explicit in `retained.py`: the existing pure
`data_contracts` and `evidence_metrics` modules remain the semantic source for
this slice while the new runtime, storage, process and API boundaries are built
around them. Acceptance tests guard that those retained modules do not acquire
Flask or SQLite imports.

Nothing here enables live execution, reads holdout data, deploys to cloud, or
replaces the supported legacy launcher yet.

F7 now has a first software-baseline slice on top of the same foundation:

- tenant-scoped dataset catalog with provenance and an explicit holdout lock;
- validated instrument snapshots, deterministic bid/ask cost preview and point-in-time news visibility;
- immutable-revision Playbook, Journal and chart-annotation records in PostgreSQL;
- replay sessions that expose only the prefix up to the cursor, branch on rewind, and validate annotation cutoffs;
- durable queued/running research cancellation with no result artifact after a successful cancel gate;
- versioned prop-profile evaluation that reports missing equity/HWM inputs as `blocked_by_data`;
- provider-neutral AI boundary, offline by default, with sensitive/holdout guards;
- overview/status read model with explicit blocked reasons;
- execution capability endpoint hard-locked to no broker actions.

This is not U0-U9 product acceptance. The owner-approved visual system, real data
QA/providers, full renderer/drawing acceptance, tenant-safe Learn progress migration,
real AI provider evaluation, broker demo/live acceptance, Miro update and final user
acceptance remain separate gates.

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

The reference strategy decides on closed bars, enters at the next bar open and
exits at a fixed-horizon close. Midpoint bars plus constant assumed spread use
adverse tick rounding; slippage is a separate modeled monetary cost. The planned
stop distance is only the R denominator: protective orders and margin are not
implemented, and unsupported rule fields are rejected. Cost component/net
rounding differences remain explicit as `rounding_adjustment`. Decimal
reconciliation and source-fill checks run before immutable result publication.
The Nautilus runtime is project-isolated from the control environment, pins its
lock/runtime identity into the protocol, and runs in a worker-owned Windows Job
Object lifecycle. The engine process additionally applies a 1-process hard limit
and the requested memory ceiling. Native order/fill IDs, nanosecond timestamps,
prices, sides and quantities are bound back to each published ledger trade and
independently reconciled before result publication.

U5 validation is synthetic software/local PostgreSQL integration only. The
Nautilus primary-adapter slice covers next-open timing, independent long/short
cost/tick oracles, cancel/deadline/worker-crash cleanup and hard process memory/
count limits. Full U5 still requires the protective-order/margin/simultaneous-
event corpus, replay comparison, durable progress/restart checkpoints,
chronological OOS/walk-forward/stress and approved real data. Runtime duration is
still enforced by the supervising worker rather than an OS CPU-time cap; input
loading remains batch/row bounded. U2 import QA v3 now classifies
sub-timeframe overlapping bars as review-required without rewriting old manifests.

The Python environment is project-local and locked by `uv.lock`:

```powershell
uv sync --project foundation_v2 --python 3.12
```

`foundation_v2/.runtime/` is disposable local acceptance state and is ignored by
Git. Production/user data must not be placed there.
