# Local API platform implementation — 09/10/2026

Public API implementation: Rust/Axum/Tokio. Python executes the existing typed
financial/domain handlers through a bounded PostgreSQL command queue; no Python
HTTP server or ASGI proxy is required. Research has its own worker. PostgreSQL
owns queue/download state; artifacts remain immutable local Parquet/JSON with
checked publication and backup. React navigation preserves the ordinary page
shell, shares scoped reads/SSE and reconciles unknown mutation outcomes.

## Evidence

- `integrated/receipt.json`: actual supervised Axum/domain/research processes and
  fresh disposable PostgreSQL. HTTP CSV preview/import hash parity, multiasset
  session/order idempotency, exact Decimal fill/balance/revision/cutoff, Prop
  monetary snapshots, playbook CAS, research completion/result, genuine blocked
  write -> 504 receipt -> reconciliation -> same-key retry, auth/errors/OpenAPI,
  mixed native/worker reads, owned marker drain all PASS.
- `integrated/browser.json`: actual React UI created a two-asset session through
  public Axum, navigated ordinary pages with the same shell/header/rail, one
  document navigation, real SSE snapshot and zero JavaScript errors. The
  full-bleed chart intentionally removes/recreates navigation chrome; shell is
  preserved. API responses are not mocked.
- Native catalog: 60 HTTP parity cases including 28 corrupted-snapshot cases;
  `../axum-migration-20261009/catalog-parity.json`. Native jobs/socket SSE:
  16 parity cases plus tenant, reconnect, checksum, schema-startup and 8/64
  stream-budget tests; `../api-platform-migration-20261009/native-events-parity.json`.
- Python command worker: 20 unit + 10 real disposable-PG tests, including claims,
  fencing, expired mutation unknown, no replay, workspace locks and exact financial
  execution. DB/queue/storage/projection receipts are in this folder and
  `../readmodel-performance-20261009/`.
- Root focused Python validation: 107 tests + 4 subtests initially; launcher/backup
  guard followup: 18 tests + 4 subtests. Transport/annotation/DataDesk/session tests:
  27 PASS; navigation/read/SSE/dashboard tests: 22 PASS. Production Vite build PASS.
- Rust: 24 tests PASS. Dedicated DB integration tests intentionally require their
  disposable fixture runners. Frozen domain and native OpenAPI guards PASS.
- Final worker regression: 35 tests + 2 subtests PASS, including a real PostgreSQL
  commit followed by a handler exception. Mutating commands preserve an unknown
  outcome and are not replayed; pure reads retain their ordinary failure status.
  Frontend transport/navigation/state regression: 49 tests PASS.
- Final restart guard: 14 tests + 4 subtests PASS. A Windows process can exit while
  its identity is being queried; an exited process is now recognized without
  weakening the creation-time/executable ownership check. Actual managed restart
  and subsequent readiness/read-only local UI checks PASS.

The mixed-load fixture contains 2 synthetic datasets of 40 rows, 80 requests and
8 concurrent clients. Its p50/p95/p99 are stored in the JSON receipt. It mixes
native reads with Python command reads, including polling/queue latency, and has
zero HTTP errors. It is neither a speed percentage versus the old runtime nor a
human-user capacity claim. Projection/range-read speedups elsewhere are scoped
synthetic measurements, not a whole-product speed percentage.

## Acceptance boundary

Local runtime cutover passed and is recorded in `local-cutover.json`: four checksum
migrations, 2 existing datasets, 725 catalog instruments and 2 completed QDM jobs
were preserved. The verified pre-migration backup contains 4,135 artifact files
and 3,255,646,482 bytes. `local-ui.json` confirms the actual user workspace dialog,
asset options, ordinary shell navigation and zero JavaScript errors with no
provider download or user-data mutation.
This implementation does not enable hosted auth/TLS, broker execution, holdout,
cloud credentials, WebSocket/gRPC services or unlimited scaling. Optional S3 is
only a bounded backup adapter; provider deployment is untested. Financial report
pagination still starts with a complete financial read model and some dashboard
filters retain detail fanout. GitHub CI is defined, not yet reported as executed.
