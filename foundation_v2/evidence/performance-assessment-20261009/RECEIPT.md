# API / full-stack performance assessment — 09/10/2026

## Decision

Keep FastAPI/Uvicorn, PostgreSQL/psycopg, React/Vite and the existing worker boundary.
There is no measured Go/Rust/Node framework comparison justifying a migration.
Prioritize connection reuse and batch reads, then bounded projection/page work and
client navigation. The measured experiments below are not deployed optimizations.

## Current measurements

Final run: Python3.12, Windows, i5-9400F, six logical CPUs; 15 timed samples plus
warm-up/first request as labeled. Raw source/script hashes, Git base revision,
timestamp and cache notes are in `measurements-final.json`. Disk source hashes do
not prove the running API process has reloaded that revision. No service restart,
provider calls, data writes or schema initialization were performed.

| Current local GET, tenant-a | Median | Sample p95 | Returned data |
| --- | ---: | ---: | --- |
| `/health` | 1.61ms | 2.54ms | 246bytes |
| Session catalog | 662.98ms | 872.91ms | 0sessions,12bytes |
| Trades page1,size10 | 806.30ms | 1040.66ms | 0trades,797bytes |

All 48 responses were HTTP200. First requests are separate in the raw file. These
are sequential loopback requests with one reused HTTP client; not a browser journey,
production-build measurement, concurrency test or stable latency SLO. With n15,
nearest-rank sample p95 is the maximum sample. The earlier run (`measurements.json`)
also had empty data and median642.40/788.31ms for catalog/Trades.

| Isolated comparison | Before median | Candidate median | Latency change |
| --- | ---: | ---: | ---: |
| Loopback read-only `SELECT 1`, new connection vs reused connection | 71.52ms | 0.140ms | 99.80% reduction |
| Page projection,100trades/10journals | 2.26ms | 2.59ms | 14.5% slower |
| Page projection,1000trades/0journals | 16.30ms | 16.58ms | 1.7% slower |
| Page projection,1000trades/100journals | 50.38ms | 15.99ms | 68.3% reduction,3.15x |
| Page projection,5000trades/1000journals | 1909.83ms | 77.33ms | 96.0% reduction,24.70x |

The DB row uses the post-review `database-guarded.json` run. Initial final DB
measurement76.25→0.176ms remains in `measurements-final.json`. The guarded probe
explicitly pins a loopback network address as well as validating the DSN host,
preventing inherited libpq hostaddr from changing its target. Its recorded script
hash matches the final source; the earlier projection/API run retains its prior
script hash. Nine independent pure-function guard cases pass without connecting.

The connection experiment uses the configured local environment DSN, forced
read-only/autocommit and only `SELECT 1`. It measures connect/query/close versus
an already open connection. It is not an installed connection pool, pool load test
or attribution of the running API's latency. The substantial difference supports
testing bounded pooling; it cannot prove that pooling removes the entire663–806ms.

The projection candidate indexes journals by session/trade instead of rescanning
every journal for every row. Both timed candidates run the complete current page
projection; alternating order, output equality and immutable input checks apply.
24additional filter/sort/alias parity cases pass. It assumes valid string IDs; no
production migration is accepted. Small fixtures fluctuate (the earlier100/10run
improved12.9%); do not promote a microsecond-scale result as a stable benefit.

At5000rows the fixture JSON is2,148,238bytes full vs5,410bytes paged (99.75% fewer
bytes). This illustrates the **existing** page contract's payload benefit; it is not
a new fix, latency measurement or proof that the backend reads only10rows.

Latency reduction is `(before-after)/before`; speedup is `before/after`. Percentages
from different phases are not added. For example, hypothetically improving a phase
that takes20% of total time by10x reduces whole-request latency by18%, not90%.

## Verified source findings and priority

| Finding | Scope and recommended action |
| --- | --- |
| `PostgresStore.connect()` opens a fresh psycopg connection | Compare bounded pool acquisition/reset/lifecycle with current transactions; cap per-process totals and define timeout/shutdown |
| `list_records()` reads IDs, then calls `get_record()` once per ID | N+1queries/connections: Nrecords entails N+1reads inside this method. Batch join current revisions while preserving tenant, deletion and ordering semantics |
| Session catalog reads dataset metadata per session, sometimes twice for its primary asset | Batch or deduplicate dataset reads after revision-scoped correctness checks |
| Trades builds the full dashboard report before page slicing | Avoid repeated materialization. Design source pagination/read models while preserving lineage dedup, full-scope metrics, facets/counts and snapshot identity; raw SQL LIMIT alone is insufficient |
| Trades page nested journal scan is O(trades×journals) | Indexed lookup is a measured candidate, then exercise broader pages/directions/partial/null/auth/cutoff cases before promotion |
| Dashboard filter/profit sort can fetch all session details concurrently | Catalog projection for needed metadata, bounded fetches and abort/revision keys; page data reads normally remain scoped |
| Primary navigation uses document links | Keep shell mounted through client navigation and verify Back/Forward, query/hash, workspace switches and chart teardown; no route rewrite done here |
| Lazy workspace imports already exist | Preserve them; measure production bundles, requests, layout and retained heap before changing bundling |

N+1count reduction is query-count math, not a measured speed percentage. A one-query
batch has less round-trip work but may return more data or require a different plan.
Transactions, tenants, journals and immutable research provenance remain unchanged.

## Technology choices

| Candidate | Decision now | Evidence needed to adopt |
| --- | --- | --- |
| FastAPI → another framework/language | Keep current stack | Same endpoints/auth/validation/results, representative concurrency and total latency/CPU/RAM; migration/maintenance benefit |
| Bounded psycopg pooling | First implementation experiment recommended | Pool wait/reset/error/transaction parity, lifecycle and API latency under representative load |
| Source pagination/batch query/read model | High priority | Correct metrics/dedup/facets with fewer reads, `EXPLAIN` and growing scopes |
| All endpoints → async | No blanket conversion | Actual awaitable I/O and event-loop/queue evidence; sync driver paths currently use ordinary def |
| Faster JSON serialization | Only after serialization profiling | Equivalent timestamp/Decimal/NaN/null/error semantics and significant share of request time |
| Redis, distributed workers or new DB | No current evidence requiring them | Proven local bottleneck and benefits exceeding invalidation/deployment costs |
| WebSocket/SSE instead of polling | Evaluate for frequent updates | Reduced requests and reliable resume/auth; not a replacement for every read API |
| Native/compiled compute module | Isolate measured CPU hotspot | Same financial/cutoff outputs, OOS/cost constraints and realistic speed/RAM advantage |

The current FastAPI guidance distinguishes framework/server feature costs rather
than treating a bare response benchmark as an equivalent application. Sync/async
is selected according to I/O capabilities. Pooling reuses database connections;
its bounded operational behavior requires its own validation.

Primary references: [FastAPI benchmark scope](https://fastapi.tiangolo.com/benchmarks/),
[sync/async](https://fastapi.tiangolo.com/async/),
[psycopg pools](https://www.psycopg.org/psycopg3/docs/advanced/pool.html),
[PostgreSQL query plans](https://www.postgresql.org/docs/current/using-explain.html),
[LIMIT/OFFSET](https://www.postgresql.org/docs/current/queries-limit.html),
[React Profiler](https://react.dev/reference/react/Profiler).

## Reproduce and remaining limits

From `foundation_v2`, using the existing virtual environment and local database
configuration (never print credentials):

```powershell
.\.venv\Scripts\python.exe scripts/api_performance_probe.py --output evidence/<run>/measurements.json --api-base http://127.0.0.1:8010 --db-probe
```

Omit both optional flags for fixture-only measurement. Default15samples, bounded5–30.
Existing tests/fixtures are reused; prototype code stays in an isolated namespace.
[Independent review](INDEPENDENT-REVIEW.md) reviews scope/math and positive/negative
skill routing. No production source behavior was changed.

Validation also passed29existing Trades page tests and three negative API-root
checks (external HTTPS, URL credentials and non-root paths rejected before requests).
The existing test suite emitted two dependency deprecation warnings; no dependencies
were upgraded to hide them.

Unmeasured: API DB phases using the running process's exact config, actual pool,
query plans/index changes, concurrent load, process CPU/RAM attribution, production
browser navigation/render/frame timing, huge chart histories and alternate stack.
The report is a diagnostic checkpoint, not a second plan or whole-product acceptance.
