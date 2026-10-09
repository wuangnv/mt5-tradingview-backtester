# Bounded single/multi-asset replay creation

User session name1 was persisted after its command lease expired. Command receipt
`2062dde6-7e27-4ff8-af57-72b52e766bb5` reports failed503/command_outcome_unknown;
session `6428cf18b3f54a36b2e90207ef12392e` exists at revision1, EUR/USD+XAU/USD.
No retry or additional session was created in the user's database.

Root cause in source: create loaded primary OHLC history, then portfolio init
loaded every asset again and built millions of Python dictionaries. This is
unnecessary for initialization and can prevent timely worker heartbeat/result
publication. Logs confirm lease loss; CPU/GIL starvation is an inference, not a
separately profiled measurement.

Creation now resolves first/last/requested timestamp and closed-bar cursors from
verified timestamp row groups. Full SHA and unchanged-file checks remain; manifest
row-count drift fails before persist. Clock and account/execution semantics stay
unchanged. Existing adapters without the new native reader keep the older path.

Validation:61 tests and2 subtests passed (creation, portfolio, chart-window and
command-worker suites); independent review ran37 creation/portfolio/chart tests.
Native fixtures cover market gaps, boundaries, wrong hash and manifest drift.

Actual artifacts: EUR/USD8,755,235 rows, XAU/USD7,966,491 rows. Three in-memory
session-store samples:1,787.92 /1,857.05 /1,803.38ms; no full OHLC-history reads.
This excludes real PostgreSQL/HTTP/queue/browser latency and is not an end-to-end
speedup percentage. Disk cache was uncontrolled. The probe used GET API manifests
and existing files; all session writes were in memory.

Managed local API/workers restarted only after owned-process and idle-download/
queue preflight checks. No migration, live broker action or provider job was run.
The existing session GET then returned200 in702.57/413.43/492.14ms, revision1,
two assets; its replay state was not mutated. These are read-response timings,
not HTTP create benchmarks. Details are in runtime-read.json.

From the product root:

```powershell
foundation_v2/.venv/Scripts/python.exe -m pytest foundation_v2/tests/test_replay_creation_timing.py foundation_v2/tests/test_replay_portfolio.py foundation_v2/tests/test_replay_chart_window.py foundation_v2/tests/test_api_command_worker.py -q
```

Remaining limit: full SHA hashing still scales with bytes/assets. Trade stepping,
asset switching and some financial projections retain other full-history paths;
this checkpoint addresses session creation only, not all replay performance.
