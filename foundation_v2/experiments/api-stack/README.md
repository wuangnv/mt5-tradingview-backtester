# API stack comparison

This is an isolated technology-selection experiment, not a replacement API or a
benchmark of the whole product. It compares seven implementations of the same
small contract: FastAPI/Uvicorn, Axum, Gin, Fiber, Fastify, ASP.NET Core and Spring.
No existing services, user datasets, broker connections or application database
are restarted or modified.

## Contract and workloads

All routes require `X-Workspace-Id: tenant-a`. This is a **synthetic scope guard**,
not the product's trusted-identity/membership implementation. Returned trade
amounts are integer cents; comparisons assert complete parsed JSON equality.

- `/json`: small dynamic JSON response and scope check.
- `/trades?rows=10000|100000&page=1..100`: scan the same immutable synthetic data,
  select workspace + EURUSD, sort descending PnL then ascending ID, return 25 rows
  and the total. No per-request answer cache or pre-sorted projection.
  The 100,000-row source contains two equal workspaces. The CPU fixture loads the
  50,000 tenant-a rows at startup; 16,667 match EURUSD. At source size 10,000,
  5,000 tenant rows are considered and 1,667 match. This is not 100,000 matching
  trades or a benchmark of production membership lookup.
- `/db?rows=10000|100000&page=1..100`: one shared SQL template against the same
  indexed 100,000-row table, count plus page. Empty pages retain the total.

The DB fixture is a fresh PostgreSQL cluster bound to loopback, with its own
random port and directory under `.runtime/`. The application role can only read
the fixture and defaults to read-only transactions. The runner has no argument
for an existing database DSN. It stops owned processes after success or failure;
ignored fixture files remain available for inspection. There is no schema
migration, holdout/provider access or download action.

## Fairness and limits

On the six-core Windows machine, servers get CPUs 0–3 and the load generator gets
CPUs 4–5. The disposable database shares CPUs 0–3, representing API/DB contention
on one host. Affinity is checked, including child processes. Each API allows eight
DB connections in total: FastAPI/Fastify use four processes with two each, the
others use one process with eight. Rust and Go are release builds, .NET is Release,
Spring uses Java 21 and virtual threads, and Node runs four cluster workers.
Read-only Python pool connections use autocommit, matching the single-statement
reads in the other implementations. Spring disables Tomcat's default 100-request
keepalive limit for this persistent-connection comparison.

Autocannon uses HTTP/1.1 keepalive, pipelining 1, one or two generator workers,
and total concurrency 1, 32 or 128 as recorded. Repeats change framework/case order
with a fixed seed. Scope/parameter/output parity runs before and after load.
Each framework first warms JSON, CPU and DB routes. No profiling instrumentation
is installed in the handlers.

Record completed successful requests/sec, latency percentiles (including **p99**,
not an invented p95), errors/timeouts/non-2xx, CPU time and sampled working sets.
Windows working sets summed across processes can count shared pages more than
once. Short runs are diagnostic samples; warm caches, localhost, a shared host,
client saturation and chosen implementation details limit generalization.
Do not interpret request concurrency as the same number of active human users.

These fixtures omit production auth, immutable artifact/revision/cutoff semantics,
the real report projection, writes/transactions, chart rendering and real download
providers. They cannot establish product acceptance, distributed reliability,
maximum users or an end-to-end migration percentage. Use the chosen stack's real
endpoint parity/measurement gates before promoting it into the product.

## Reproduce on Windows

Portable Go, Java and Maven downloads use official upstream URLs and verify
published checksums; extraction rejects escaping paths. They are local to this
experiment. Existing Rust/.NET/Node toolchains are reused. Dependencies have
project lockfiles where their ecosystems support them. Maven resolves its BOM;
retain the actual dependency list with evidence. Package scripts are disabled
for the Node install.

```powershell
python bootstrap.py
uv venv .runtime/python --python 3.12
uv pip install --python .runtime/python/Scripts/python.exe -r requirements.lock
npm ci --ignore-scripts --no-audit --no-fund
Push-Location rust
cargo build --release --locked
Pop-Location
Push-Location go
& ../.runtime/go/go/bin/go.exe build -o server.exe .
Pop-Location
dotnet publish dotnet/Benchmark.csproj -c Release -o .runtime/dotnet-server
$env:JAVA_HOME = (Get-ChildItem .runtime/java -Directory | Select-Object -First 1).FullName
& .runtime/maven/apache-maven-3.9.16/bin/mvn.cmd -f java/pom.xml -B package -DskipTests
& .runtime/python/Scripts/python.exe run.py --pg-bin '<portable PostgreSQL bin>' --output '<evidence directory>' --seconds 4 --repeats 2
```

For a longer confirmation, use `--headline --only fastapi,spring,axum,dotnet
--soak-seconds 60 --soak-only axum,dotnet`. The headline matrix retains JSON/CPU/DB
at 128 connections plus CPU at one connection; soak applies on the first repeat
only. This is a bounded one-minute CPU-route check, not a long-run
memory leak or production stability certification.

The fixture servers are executable research assets and are **not** intended to
be exposed outside loopback or copied wholesale as product business logic.
