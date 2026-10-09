# Python domain command worker — 09/10/2026

This receipt covers the direct domain-worker boundary and disposable PostgreSQL
queue tests. It does not establish whole-product migration acceptance or a
production throughput improvement.

## Implemented boundary

- Native API producers enqueue `api-command-v1` commands into `api_commands`.
  A single worker process bootstraps the existing tested domain service closures
  once, then runs four bounded threads. No public Python listening server,
  HTTP/ASGI dispatch, HTTP self-request or subprocess-per-request is used.
- The internal registry freezes 98 route/handler registrations. FastAPI remains
  an internal validation/metadata dependency; transport-independent extraction
  of these closures has not been completed.
- Every command rechecks trusted local identity and workspace membership before
  invoking a handler. Body/path/query validation, Decimal inputs, response-model
  defaults, error mapping, status, UTF-8 CSV and declared plaintext formatting
  retain their reference contracts. Corrupt stored contracts return the explicit
  `503 stored_contract_untrusted` response without exporting stored data.
- Claims are short transactions with `FOR UPDATE SKIP LOCKED`, global admission,
  workspace mutation exclusion, lease token/attempt heartbeat and fenced results.
  Workspace mutations also own a dedicated physical advisory-lock connection.
  Expired unsafe commands never retry automatically: their outcome is unknown.
- Request payloads are bounded at 32 MiB and results at 16 MiB; over-limit results
  return an explicit error. These limits are admission/response limits, not a
  claim that domain execution itself has zero allocation growth.
- OAuth query/body/origin fields are scrubbed on completed/failed commands; their
  retained response receipt expires after five minutes, bounded below by the
  original queue deadline. Pending OAuth nonces still belong to one worker
  process; horizontally distributed OAuth needs explicit ownership/state routing.
- Supervisor-owned stop-file and process signals stop new claims and drain
  current operations. Disconnecting an HTTP caller does not cancel domain work.

## Validation

Command:

```powershell
.venv/Scripts/python.exe -m pytest tests/test_api_command_worker.py tests/test_api_command_worker_pg.py -q
.venv/Scripts/python.exe scripts/export_api_command_contracts.py --check
```

Run from `foundation_v2`.

Final result: **32 tests passed**, 13.52 seconds, two existing reference TestClient
deprecation warnings. The offline contract export/check also passed all 98 frozen
registrations and reference OpenAPI schemas without opening a database/provider.

The 22 focused tests cover validation parity for every required-body route,
forged-identity rejection across all 98 registrations, query bounds/duplicate
parameters, typed financial inputs, catalog defaults, revoked membership, safe
error handling, OAuth local-origin errors, CSV/plaintext formatting, size limits,
publication fences and workspace execution guards.

The ten actual PostgreSQL tests cover:

- claim/heartbeat/result persistence and reconnect;
- expired safe-read retry with changed token/attempt and stale-result rejection;
- expired mutation outcome-unknown handling and OAuth sensitive-field scrubbing;
- completed OAuth scrubbing and UTF-8 CSV persistence;
- global concurrency cap and same-workspace mutation exclusion;
- physical session lock retention across queue lease expiry;
- queued deadline, unique idempotency receipt and expired-result cleanup;
- worker readiness manifests;
- real queued replay create → execution initialize → BUY order → stale-revision
  conflict → bar step, preserving fill `1.1001`, balance `100000.00`, revisions
  1–4 and causal cutoff; playbook create/revision/conflict;
- prop simulation session creation, exact initial-capital serialization and
  cross-workspace rejection.

## Fixture isolation and failed attempt

The integration suite creates its own temporary PostgreSQL 17.11 cluster using
the previously audited portable distribution, binds a random loopback port,
creates synthetic artifacts and stops/deletes only that owned cluster. It never
reads `TW_V2_DATABASE_URL` or accepts a caller's DSN. The final teardown verifies
that the fixture `postmaster.pid` is gone. No provider, broker, holdout or external
OAuth request was performed.

The initial cluster-launch attempt failed because Windows inherited captured
stdout/stderr pipes from `pg_ctl` into the long-lived child. The database itself
was ready, but `subprocess.communicate` waited for those inherited pipes. Only
that named temporary cluster was stopped; the helper now directs its streams to
`DEVNULL`, and the subsequent integration runs passed and cleaned up.

## Remaining acceptance

These are selective financial/queue tests, not successful user journeys for all
98 operations. Native Axum producer parity, SSE/browser workflow, long-running
worker crash/recovery and representative mixed-load measurements remain owned
by the parent migration validation. Python's shared GIL is not removed by the
four-thread configuration; no CPU-heavy throughput promise is made here.
