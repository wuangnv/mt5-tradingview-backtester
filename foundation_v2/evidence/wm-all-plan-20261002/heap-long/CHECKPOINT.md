# Precise one-hour Analytics heap diagnostic — 2026-10-02

**LONG_DURATION_FIXTURE_PASS / FULL_CHART_PERFORMANCE_NOT_ACCEPTED.**

The existing detached worker PID24164 ran from19:46:04 to20:46:15+07 and exited.
Final source before/after is unchanged:
`71373c3a4a02e1d3cd68ff3e6bffbd92a8dfdb153a5f3c8d39aa3ac5cc8030fa`.
Measured duration is3,601,275ms,2,620 complete interactions and61 precise heap
samples. Every sample uses CDP `HeapProfiler.collectGarbage` twice and actual
`Runtime.getHeapUsage` bytes. Host time is monotonic; one document/timeOrigin
remains throughout. Filter/pagination/scroll interactions use a5,000-row
intercepted Analytics fixture; external requests and API writes are denied.

Post-GC baseline13,235,596bytes (12.62MiB), final14,352,668bytes (13.69MiB),
peak14,794,656bytes (14.11MiB). Final delta1,117,072bytes (1.07MiB) meets the
historical12MiB gate; DOM delta0, zero page/interaction errors or overflow.
The retained final heap snapshot is40,225,974bytes; its absolute locator/hash and
all report/log hashes are in `receipt.json`. Large snapshot bytes stay in the
ignored workspace artifact directory, not in Git.

Frame p95 is33.2ms; maximum observed long task103ms. These are observations,
not a60Hz/whole-chart verdict. The diagnostic's pass decision checks duration,
precise bytes, document/host-clock stability, heap delta, interactions/errors,
overflow and read-only scope; it does not silently include a frame budget.
Other browser QA and cached local ASR ran during parts of the measurement.

This reconciles the long-duration heap gate for the current **Analytics fixture**.
The historical74.3min coarse-heap failure remains immutable at the workspace
W8 checkpoint. This run uses corrected measurement and current source; it neither
rewrites that observation nor proves every chart/replay lifetime or cause of the
old failure. Chart pan/replay/crosshair60Hz and full W8/U9 remain open.

Exact command, launched from `foundation_v2/web`:

```powershell
node tests/wm-integration-quality-heap.mjs --arms=full --seconds=3600 --checkpoint-seconds=60 --dwell=1000 --snapshot=true --out=D:/ANNAM/TradingWorkspace/.artifacts/wm-all-plan-20261002/heap-long
```

No duplicate worker was launched, no frontend source changed during sampling,
and no provider/broker/database/user state was touched. Subsequent CSS repair is
a separate revision with its own verification; this receipt stays bound to the
measured source. Do not restart this completed soak merely to replace its status.
