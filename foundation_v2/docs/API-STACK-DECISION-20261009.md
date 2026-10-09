# API platform direction — 09/10/2026

Status: **selected target architecture; product migration not executed**.

The owner explicitly prefers choosing a durable API platform during development
and authorizes replacing the incumbent, rather than keeping FastAPI by default.
The bounded comparison lives in `../experiments/api-stack/`; source, raw timings,
failed attempts and confirmation are in `../evidence/api-stack-comparison-20261009/`.
This document owns the architecture decision, not product progress or acceptance;
the canonical Product Completion Plan remains the scope/status entrypoint.

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

The architecture target is Axum, not a permanent public FastAPI gateway in front
of Axum. During migration, FastAPI remains the **currently running implementation**
until each replacement passes its contract tests. Python remains a deliberate
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

## Migration boundary and verification

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
