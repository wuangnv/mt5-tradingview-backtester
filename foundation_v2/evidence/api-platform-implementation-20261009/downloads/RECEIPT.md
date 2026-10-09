# Durable download authority

The Python adapters now persist private job state and an allowlisted public snapshot in
PostgreSQL. `job.json` remains a restart checkpoint; ordinary GET/list no longer scans
the filesystem. `download_sources` records truthful availability and control support.
`download_job_snapshots` reconciles lost physical worker ownership to interrupted/paused,
adds revision, and computes source cooldown remaining time. Queued jobs have a 30-second
startup grace; a dead process does not advertise permanent progress.

Downloads retain their original provider/job advisory locks on dedicated connections.
Per-workspace admission locks serialize equivalent requests across worker processes;
matching covers all existing jobs rather than only the latest 20 shown by the UI.
Revision comparisons reject stale writes. Completing a dataset and its job uses one
PostgreSQL transaction through the existing ingestion publication guard. Publication
failure rolls back both records. Retry remains bounded by the existing Node per-bucket
retry policy; no new automatic resume of a user-paused or QDM job is introduced.

Legacy jobs require the explicit `adopt_legacy(workspace)` operation under provider and
job ownership locks. Import is idempotent; modifying a checkpoint afterward cannot
override an existing PostgreSQL row. Old active states are adopted paused. QDM still
reports unsupported pause/cancel and unknown transfer bytes; its licensed CLI and
provider throttling remain unchanged.

Validation: 42 focused tests and 2 subtests passed (see `tests.txt`), including six tests
against fresh disposable loopback PostgreSQL and synthetic QDM exports. They cover
revision conflict, workspace isolation, crash ownership, queued grace, cooldown,
transaction rollback/retry, explicit legacy adoption, and a losing executor unable to
overwrite a remote owner's newer progress. Failure/pause reconciliation also acquires
the physical job lock after source ownership closes. Existing offline Node fixture
tests continue to pass. No real QDM/Dukascopy download or user database was used. Fixture
PostgreSQL processes were stopped and temporary clusters removed. One additional pure
projection test verifies unknown secrets/paths are private and nested fields fail closed.

Windows fixture correction: a long temporary test workspace exceeded practical path
length when raw artifacts were materialized; the atomicity fixture now uses a short,
unique workspace ID. This receipt does not establish arbitrary long-path support.
