# API platform direction — 09/10/2026

Status: **owner-approved architecture; local Axum cutover verified on 09/10/2026**.

The owner explicitly prefers choosing a durable API platform during development
and authorizes replacing the incumbent, rather than keeping FastAPI by default.
The bounded comparison lives in `../experiments/api-stack/`; source, raw timings,
failed attempts and confirmation are in `../evidence/api-stack-comparison-20261009/`.
This document owns the architecture decision, not product progress or acceptance;
the canonical Product Completion Plan remains the scope/status entrypoint.

On 09/10/2026 the owner confirmed this selection and requested an audit of queue,
storage, observability and remaining scale-related gaps. The source audit is in
[the platform gap receipt](../evidence/api-platform-gap-audit-20261009/RECEIPT.md).
It adds operational requirements. The subsequent implementation and local cutover
are recorded in [the integration receipt](../evidence/api-platform-implementation-20261009/RECEIPT.md);
production acceptance remains separate.

## Selected platform

| Responsibility | Target | Reason |
| --- | --- | --- |
| Public application API / control boundary | Rust + Axum + Tokio, Tower middleware | Strong CPU-read throughput with small working sets in this local comparison; explicit types and bounded resource ownership |
| Transactional metadata | PostgreSQL, bounded Rust connection pool | Preserve current schema/revisions and transaction semantics; reuse connections and batch scoped reads |
| Historical artifacts / analytical work | Existing immutable Parquet/Arrow + DuckDB | Preserve provenance, cutoff and efficient bounded historical reads; this experiment does not justify replacing the storage stack |
| Backtest / research / QDM adapter | Python workers and current isolated engine runtime | Retain tested domain/provider integration; these jobs execute outside request handling |
| Browser reads and commands | HTTP JSON with OpenAPI contracts | Native browser workflow, deterministic pagination and explicit endpoint permissions |
| Server-to-browser job/status updates | SSE, scoped stream with bounded buffers and reconnect/resync | Fits one-way progress notifications; keep commands on HTTP |
| Truly bidirectional streaming | WebSocket only for a concrete two-way feature | One-way job progress does not require two-way transport |
| Internal network RPC | No mandatory gRPC layer now | Existing local/durable worker boundary does not need another hop. If workers become independent network services, evaluate Tonic/gRPC there with a separate contract/load test |
| UI | Existing React/Vite and project chart integration | API experiments provide no reason to replace the UI or chart stack |

GraphQL is not selected: these product views have defined scope, page/filter/count
contracts, and a field-selection layer would still need correct source batching,
query budgets and authorization. It is not a prerequisite for speed or scale.
gRPC-Web is not selected as the browser interface: it adds generated clients and
transport integration without a measured benefit for these workflows. Neither
protocol is declared inherently slower; their relevant use cases are different.

Axum now serves the local public HTTP API on port 8010. FastAPI is retained only
inside the Python worker to extract the existing typed handler metadata at startup;
it is not a listening HTTP server or an ASGI proxy. Python remains a deliberate
worker choice, not a legacy layer to remove indiscriminately.

## Main data/state flow

Browser HTTP command → trusted identity and workspace authorization → Rust
validation/transaction → PostgreSQL job/state or metadata → bounded worker →
immutable result/artifact and durable job state → Rust read endpoint/SSE → browser.

Rust reads metadata directly. A synchronous Rust→Python HTTP round trip for every
existing endpoint would preserve current bottlenecks and is not the intended
migration. CPU-heavy reports/backtests use bounded workers or explicitly bounded
blocking work; they must not monopolize Tokio's request runtime.

SSE does not create another authoritative job store. Changes originate in the
durable job state. A stream sends a scoped current snapshot and subsequent
updates/invalidation; reconnect or expired event history resynchronizes from the
current revision. Bound connections, queues and message sizes; terminate slow
consumers and release resources on disconnect. Browser custom workspace headers
require a fetch-based SSE reader or a properly authenticated equivalent, rather
than moving identity/secrets into query strings.
Use one aggregated stream per relevant workspace/view instead of a connection
for every KPI or job. This limits connection pressure, especially with HTTP/1.1.
The comparison used HTTP/1.1; enabling HTTP/2 at deployment is a transport choice
to verify separately, not a measured speedup in this receipt.

If multiple API replicas are needed, event distribution and workers must use
shared durable state/leases. Process-local subscribers/caches cannot be assumed
to cover another replica. Redis/brokers/orchestration are not installed by this
decision; add a specific infrastructure dependency only when the cross-process
contract and deployment require it.

## Operational requirements of the approved platform

The baseline is a modular application API with separate bounded workers, not a
mandatory fleet of microservices. More API replicas may share PostgreSQL and
artifact storage without changing browser contracts. Replica count alone does
not establish capacity: database, storage and provider budgets still apply.

| Responsibility | Decision | Current source and remaining work |
| --- | --- | --- |
| PostgreSQL access | Bounded async pool; reuse the measured `deadpool-postgres` / `tokio-postgres` pairing as the initial Rust implementation | Current Python `PostgresStore.connect()` opens a new connection. Batch scoped reads, remove N+1 queries, page at the source and preserve transaction/revision behavior. SQLx is an alternative, not a second required driver or a measured upgrade |
| Durable jobs | Reuse PostgreSQL job authority and `FOR UPDATE SKIP LOCKED` | Research jobs already have short claims, lease token/attempt checks, heartbeat, cancellation, expired-lease recovery and candidate publication. QDM/download jobs use filesystem state and advisory locks. Extend the durable contract to these adapters without discarding checkpoints or provider constraints |
| Retries and admission | At-least-once attempts with idempotent effects, bounded retries and fair resource admission | Add scheduled retry/backoff with jitter, maximum attempts and explicit terminal failure/manual retry. Expired research leases currently requeue without a visible retry limit. Existing global active-job cap is useful but does not establish workspace fairness |
| Artifact storage | Server disk for local/single-host operation; private S3/object storage when API/workers span hosts | Existing local `ArtifactStore` has relative paths, hashes, temporary writes and attempt candidates. Define storage-neutral artifact IDs/manifest references; do not expose arbitrary paths. Browser `localStorage` is not the historical dataset store |
| Historical reads | Parquet/Arrow with bounded DuckDB or Arrow queries | `read_dataset_range()` currently hashes the full file and iterates all batches before filtering rows. Evaluate time/symbol partitions, row-group pruning and projection/filter pushdown. Preserve integrity and causal cutoff; merely changing the API language does not avoid these reads |
| Logging and measurement | Rust `tracing` + JSON logs, correlated Python logs, Prometheus-compatible metrics; selective trace export | Add request/job/attempt correlation, HTTP latency/errors, pool wait/query timing, queue age, lease failures, worker CPU/RAM, disk and SSE pressure. Research PnL metrics and a health response are not operational monitoring |
| Live progress | One scoped SSE stream per relevant view, backed by committed state | Implement snapshot/revision resync, bounded subscriptions and slow-consumer handling. PostgreSQL `LISTEN/NOTIFY` can wake listeners; durable state/events remain the truth. Do not assume missed notifications can be replayed |
| Frontend data lifecycle | Preserve the React shell during client-side navigation; scope requests and bounded caches | Lazy workspace imports already exist. Main navigation uses document links. Keep header/sidebar mounted, cancel obsolete reads and key caches by identity/workspace/filter/revision. Exact counts/facets cannot be computed only from the visible page |
| Contracts | HTTP JSON/OpenAPI, typed client, equivalent route-family tests | Freeze existing errors, units, nulls, dates, IDs and revisions. Preserve current idempotency receipts and optimistic writes. No exact-money conversion through an unchecked binary float or incompatible JSON number change during porting |
| Resource protection | Tower request/body/concurrency limits, timeouts and separately bounded worker CPU/RAM | Budget the whole deployment: API pools + worker/heartbeat/lock connections + SSE listeners + administrative reserve. A timeout must release/cancel underlying work where supported; it is not proof the task stopped |
| Database evolution | One versioned SQL migration authority shared by Rust and Python | Current initialization executes embedded CREATE/ALTER SQL. Move schema evolution into controlled migrations; preserve compatibility while both runtimes operate. Avoid two automatic migration owners |
| Recovery and lifecycle | Readiness distinct from liveness, graceful drain, consistent DB/artifact backup and restore | API lifespan cleanup and synthetic restore scripts/receipts already exist. Rehearse current schema, concurrent writes/deletes, failed upload/publication and restart. Define acceptable data loss/recovery time before hosted operation |
| Hosted security and delivery | Trusted login/session, workspace authorization on every route/stream/artifact, TLS, secrets, CI checks and reproducible builds | Current auth is explicitly local-only. Add hosted identity before multi-user exposure; a caller-selected workspace header alone is insufficient. CI must cover Rust/Python/browser contract parity and dependency/license review |

### Queue, publication and provider constraints

Commit command validation and job creation in one PostgreSQL transaction. Claim
and commit a lease before doing expensive work; do not hold a transaction during
a download/backtest. Fence progress/checkpoint/result writes with the current
attempt and lease token. A crashed process can cause another attempt, so effects
must tolerate duplicate execution; this is not an exactly-once promise.

Publish a checked immutable result candidate before recording its reference in
the database. Database rows and filesystem/S3 writes have no shared atomic
transaction. Preserve the existing lease-fenced result publication and add
reconciliation/retention for orphan candidates and interrupted uploads. Protect
objects still referenced by current manifests, revisions and backups; a local
atomic rename does not prove power-loss durability or concurrent no-overwrite
safety for every artifact writer.

Job payloads need a version and supported worker capabilities during mixed
deployments. Use job-kind/provider admission budgets rather than allowing a slow
provider or one workspace to occupy every worker. Reusing the queue does not mean
forcing every provider into identical controls: the current QDM adapter reports
no pause/cancel and unknown transferred bytes. Preserve those semantics, its
single-instance ownership and its Windows/runtime/license requirements. More
Axum replicas cannot remove provider throttling or the QDM instance constraint.

Advisory session locks require explicit connection ownership. Do not return a
locked session to a general request pool. Give listeners and long-lived locks
their own budget, and ensure lease heartbeats remain possible under foreground
load. Use PostgreSQL notifications only for small non-sensitive invalidations;
listeners authorize and reread scoped committed state.

For local immutable artifacts, verification caching is safe only when file
identity and invalidation make mutation detectable; a digest in the manifest
alone does not prove the file has remained unchanged. Before changing the read
path, compare exact output/cutoff/hash semantics and measure bytes scanned, RAM
and first/warm-read latency. For object storage, test range reads, multipart
failure cleanup, checksums and scoped short-lived access. AWS S3 consistency does
not imply identical semantics for every S3-compatible service, or atomicity with
PostgreSQL. Select a hosted provider and region only when deployment is defined.

### Observability, overload and acceptance

Use structured logs with redacted fields and bounded metric labels; never use
individual user/job IDs as Prometheus labels. Correlation IDs belong in logs and
sampled traces. Standard Rust `tracing` logging is the initial choice; the official
OpenTelemetry Rust page currently labels traces, metrics and logs Beta. Pin and
verify exporter compatibility separately rather than assuming all signals are
stable. Monitoring must not make telemetry failure block ordinary requests.

Bound CPU work separately from Tokio's async I/O. `spawn_blocking` alone is not
a CPU concurrency or cancellation policy; started tasks cannot simply be aborted.
Heavy computations need worker budgets/cooperative cancellation, and provider
process shutdown must preserve resumable state where supported. Reject excess
work explicitly with the existing error contract and retry guidance rather than
letting request/job queues grow without limit.

Reuse the original source findings while porting: pooling, scoped batching,
indexed journal joins, source pagination, historical read pruning and shell
preservation remain necessary. The prior fixture percentages are not new runtime
results from this audit. Measure real mixed journeys (catalog, filters/pages,
replay/history, download/import, research and SSE) at the declared dataset size,
cache state and concurrency, including p50/p95/p99, errors, queue time, CPU/RAM,
query count, scanned bytes and payload. Test disconnect, worker crash, expired
lease, database outage/recovery, disk-full and a noisy workspace, plus a longer
soak on the deployment OS. Define latency/availability/recovery targets with the
deployment profile; do not derive a human-user capacity from fixture req/s.

At hosted deployment, verify reverse-proxy TLS/HTTP settings, maximum payloads,
SSE buffering/idle timeouts and graceful reload. Compress suitable large ordinary
responses only after measuring CPU and bytes; do not buffer progress streams.
An API replica should stop taking new work during drain and release listeners,
pools and worker ownership safely. Freeze versioned contracts and reproducible
builds in CI before cutover; use an explicit rollback path compatible with the
database/artifact version rather than reverting binaries blindly.

Redis, a separate message broker, PgBouncer, Kubernetes and mandatory gRPC are
not baseline dependencies. Promote them for a measured need: cross-replica cache
coordination, queue contention/routing pressure, aggregate connection pressure,
operational replica management or a real network-service contract. This keeps
the selected public/storage/job boundaries usable without preinstalling every
scaling tool.

## Migration boundary and verification

### Implemented local platform, 09/10/2026

The native crate in `api-rust` now serves the entire frozen public domain route
inventory: catalog/status/job reads are native PostgreSQL handlers; remaining
domain operations enter `api_commands` and invoke existing typed Python functions
in a supervised worker. This is not an HTTP/ASGI proxy. FastAPI remains an internal
bootstrap/validation dependency so financial semantics have one implementation.
All 98 registered domain contracts are frozen; focused parity proves selected
valid/corrupt flows, not every possible journey across all 98 endpoints.

PostgreSQL owns research, command and download state. Python is the sole SQL
migration writer; Axum verifies all embedded migration hashes before starting.
Dedicated session locks are kept outside reusable pools. Admission is bounded;
expired mutations produce an unknown-outcome receipt rather than an automatic
retry. Frontend Idempotency-Key receipts persist bounded hashes/IDs in session
storage and reconcile pending commands without another mutation. OAuth payloads
are scrubbed after completion and are not persisted as browser command receipts.

The current local defaults are an 8-connection Rust pool, each Python store's
8-connection pool and up to 8 dedicated lock sessions, 4 command threads, 1
research job, 128 admitted HTTP requests, 128 active commands globally/32 per
workspace and 8 SSE bodies/workspace/64 per process. These per-process budgets
must be added across replicas before increasing deployment capacity. Structured
request logs omit payloads and use bounded route templates; token-protected
Prometheus metrics include latency and Rust pool pressure. Hosted identity/TLS,
fleet telemetry/exporters and production capacity remain deployment acceptance.

Parquet reads retain full-file SHA256 checks and prune/project row groups; local
backup/restore is checked. S3 is an optional injected backup adapter with 64 MiB
objects, not an enabled cloud store or a remote Parquet range-read implementation.
React keeps the shell mounted across ordinary pages, deduplicates scoped readers,
and shares SSE with disconnect polling fallback. Indexed trade/journal projection
is installed; full-ledger pagination and dashboard filter fanout still require
separate measured read-model work.

Real-process evidence, latency fixture limits and local cutover status are recorded
in `evidence/api-platform-implementation-20261009/RECEIPT.md`. The previous stack
benchmark is research evidence; it is not this implementation's whole-app speedup.

There are 98 decorated routes in the current `trading_workspace_v2/api.py`
snapshot (see the recorded route inventory); dynamically registered routes and
other modules require review during migration. The seven fixture servers are
research implementations, not a production API to copy into service.

Before replacing a route, freeze and compare its actual contract:

- trusted identity, workspace membership and tenant isolation; the benchmark's
  hardcoded workspace guard is not production authorization;
- IDs, revisions, optimistic concurrency, immutable hashes, lineage and cutoff;
- all filters/sorts/pages, full-scope counts/facets, empty/unknown/error semantics;
- exact financial units, numeric behavior, dates/timezones and null handling;
- writes/transactions, idempotency, worker leases, failure/retry/resume behavior;
- client cancellation and stale-response handling, SSE disconnect/reconnect and
  slow consumers, and real browser flows;
- actual endpoint latency, throughput, CPU/RAM, query count and repeated/long-run
  behavior on representative data and the deployment OS.

No live broker, holdout, public deployment, current database migration or production
capacity is authorized or accepted by a framework benchmark. The owner approved
technology changes; existing data/execution/deployment gates remain separate.

For the first product replacement, migrate a read-only catalog/page end to end,
including the Rust DB read and real auth, then expand by coherent route families.
Avoid a all-at-once rewrite or an indefinitely duplicated domain implementation.
Record acceptance in the existing product evidence/plan owner, not a competing
roadmap in this document.

## Why this choice and its limits

Axum is selected for this owner's priority: efficient API execution and a durable
typed boundary, while preserving the useful Python research ecosystem. .NET is
the measured alternative with a strong integrated application ecosystem. Rust
requires more implementation/compiler work, and ecosystem-specific correctness
checks still matter. Accept this tradeoff consciously; choosing Rust does not
remove database, algorithm, authorization or deployment work.

The test compares bounded loopback HTTP/1.1 synthetic workloads on the current
Windows machine. It is not a REST-vs-gRPC-vs-GraphQL protocol benchmark, not a
complete migration of the real report engine, and not a promise of a certain
number of simultaneous human users. Public benchmark ranks and fixture speedups
cannot be converted into a whole-product percentage.

Primary references: [Axum](https://docs.rs/axum/latest/axum/),
[GraphQL performance](https://graphql.org/learn/performance/),
[gRPC-Web](https://grpc.io/docs/platforms/web/basics/),
[SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events).

Operational references: [PostgreSQL queue locking](https://www.postgresql.org/docs/current/sql-select.html),
[NOTIFY semantics](https://www.postgresql.org/docs/current/sql-notify.html),
[Deadpool PostgreSQL](https://docs.rs/deadpool-postgres/latest/deadpool_postgres/),
[Tower limits](https://docs.rs/tower/latest/tower/limit/index.html),
[Tokio blocking work](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html),
[DuckDB Parquet pruning](https://duckdb.org/docs/current/data/parquet/overview),
[S3 storage semantics](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html),
[Rust structured logging](https://docs.rs/tracing-subscriber/latest/tracing_subscriber/fmt/index.html),
[OpenTelemetry Rust status](https://opentelemetry.io/docs/languages/rust/),
[PostgreSQL recovery](https://www.postgresql.org/docs/current/backup.html).
