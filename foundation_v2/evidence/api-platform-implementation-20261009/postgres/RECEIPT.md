# PostgreSQL worker foundations — 09/10/2026

Implementation scoped to metadata access and research-job lifecycle. No current
owner database was migrated or written during validation.

- `PostgresStore.connect()` lazily creates a psycopg pool: zero initial connections,
  maximum eight, five-second acquisition/connect timeout and 64 waiting borrowers.
  Contexts commit/rollback as before. `close()` is explicit; a finalizer also closes
  abandoned store pools. Store construction alone starts no pool worker.
- Session advisory locks use dedicated autocommit physical connections, closed
  after use; they never return a locked physical session to the query pool.
  Their budget is separate from the eight pooled connections: configurable
  maximum eight dedicated sessions per store with five-second bounded acquisition.
  Slots release on timeout/connection error/body failure. Deployment budgets must
  account for both caps across processes.
- `list_records()` joins current revisions in one SQL query and preserves scope,
  ordering, revision payloads and exclusion of deleted rows.
- `put_dataset(..., conn=connection)` can participate in the download owner's
  publication transaction without independently committing it.
- `0001_baseline.sql` preserves the previous embedded initialization schema;
  `0002_job_retry.sql` adds bounded research retries and idempotency. The Python
  migrator scans versioned SQL, takes one PostgreSQL transaction advisory lock,
  records raw SHA256 and fails on missing/newer versions or checksum mismatch.
  `.gitattributes` pins migration SQL to LF across Windows/Linux. Rust verifies
  this same ledger; it does not maintain another migration authority.
- Expired research attempts requeue only below `max_attempts` (default three).
  `available_at_utc` schedules capped exponential delay with 20% jitter;
  `retry_base_seconds` defaults to two seconds. Exhaustion fails visibly.
  Cancellation wins. Lease owner/token/attempt fence retries and completion.
  Deterministic failures retain terminal `fail_job`; only explicitly classified
  transient errors call `retry_job`. Database OperationalError is classified
  transient by research; outage recovery still relies on lease expiry if the
  retry state itself cannot be written.
- Optional research idempotency keys are workspace-scoped, atomically deduplicated,
  and reject reuse with different content. Existing API contracts remain unchanged.
- Persistent research worker logs sanitized error type, continues after a failed
  attempt, and closes its store on shutdown. A one-shot invocation still raises
  failed work to its caller.

## Validation

Started a fresh portable PostgreSQL 17 cluster in `.runtime/platform-pg-<uuid>`,
on a random loopback port with trust authentication for the disposable fixture.
Tests supplied only its DSN and `TW_V2_ALLOW_DESTRUCTIVE_TEST_DB=1`; every cluster
was stopped with `pg_ctl -D <exact fixture path> -m fast stop` in `finally`.

Command: `.venv/Scripts/python.exe -m pytest -q` with:

- `tests/test_postgres_platform.py`: eight PostgreSQL boundary tests.
- `tests/test_fh1_job_lifecycle.py`: leases, crashes, cancellation, publication fencing.
- `tests/test_local_dataset_removal.py`: exact removal and reference protection.
- `tests/test_ps01_prop_persistence.py`: prop transactional persistence.
- `tests/test_replay_portfolio_postgres.py`: shared-account multiasset behavior.

Final result: **55 passed, one skipped** (Windows symlink privilege), two existing
Starlette deprecation warnings. All four current migrations applied on an empty
fixture and the legacy-schema adoption test preserved existing workspace rows.
Raw output: `tests-r3.txt`, including dedicated-cap checks and worker lifecycle.
Earlier `tests-r2.txt` passed 54 cases before the dedicated-cap change.
Earlier `tests.txt` retains the concurrent Windows
quarantine failure fixed by the artifact lane before the passing rerun.

Focused worker failure/poll/shutdown tests: **three passed**, `worker-tests.txt`.
Optional `TW_V2_SHUTDOWN_FILE` drains after the current job and checks idle waits
every 250 ms, including when poll time is 30 seconds. Marker tests cover both
idle shutdown and between-job draining under one second; active work is not
force-aborted by this launcher hook. Marker is not deleted by the worker.
Diff whitespace check passed. No throughput or whole-product speed percentage is
claimed by this receipt; pool/query reductions require integrated measurements.

## Persisted prop contract scope

Native catalog review found that an SQL-scoped row could contain a different
workspace/session/attempt identity inside its stored JSON. Python prop get/list
reads now compare stored identities with the SQL scope before model decoding;
resume additionally verifies phase identity and matching session/attempt/phase
profile hashes. Historical mutation-receipt reads check attempt/phase identities.
Invalid stored models raise the same typed `StoredContractUntrusted` failure,
without exposing payload contents. Resume data itself remains opaque exact JSON.

Fresh disposable PostgreSQL rerun: **50 tests and 18 subtests passed**, including
PS01 persistence, PS02 lifecycle, platform boundaries and scoped corruption cases.
Raw output `tests-scope.txt`; two existing Starlette warnings only. This receipt
does not claim all direct mutation internals have been independently hardened;
the scope here is persisted prop inspection and receipt reads.
