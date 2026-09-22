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

The Python environment is project-local and locked by `uv.lock`:

```powershell
uv sync --project foundation_v2 --python 3.12
```

`foundation_v2/.runtime/` is disposable local acceptance state and is ignored by
Git. Production/user data must not be placed there.
