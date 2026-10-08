# Library transfer meter — 08/10/2026

Owner requested Valorant-style progress organization, icon-only Pause/Resume,
remaining-time estimate and removal of the separate Status column.

The grid now has nine columns. Actions combines the meter and two controls;
its 308px width replaces Status 112 + Actions 196 and keeps earlier columns stable.
The bar/percentage sits above transferred payload size, smoothed speed and ETA.
Generic Running text is omitted; queued/paused/failed/saving remain visible.
Download and update share the same meter. Controls retain callbacks, accessible
names, tooltips, disabled conditions and keyboard focus. Progress opens Details.

Frontend GET polling feeds a 30s rolling window. ETA needs 10s and 3 completed days,
uses remaining calendar days divided by observed day throughput, and expires
when day progress stalls for 15s. Transitions, rollback and long polling gaps
reset samples. ETA excludes final saving. Unknown total bytes stays unknown;
measured zero speed remains 0. Backend/data worker contracts are unchanged.

Performance audit: the pinned worker downloads three daily artifacts concurrently,
then pauses 1s per fetched batch; thousands of small requests make throughput
sensitive to request latency, source behavior and batching rather than just local
link capacity. Upstream guidance explicitly uses batching/pauses to avoid rate
limits: https://www.dukascopy-node.app/custom-batching . Raising concurrency or
removing cooldown without a real benchmark would not establish a safe improvement.
Seven GET-only observations over 12s found the current EUR/USD job already paused,
unchanged at 1356/8558 days and 28,500,614 transferred bytes. No current Internet
throughput claim is made. No resume/pause/cancel/restart or extra provider download
was performed. The earlier synthetic 5–6x benchmark is not an Internet benchmark.

Validation:
- Production build: PASS.
- Metrics/copy unit tests: 7/7 PASS.
- Parent actual GET-only screenshots: dark/light 1710, nine-column headers;
  visually reviewed the actual paused EUR/USD layout.
- Independent math and runnable browser review: see independent/REVIEW.md,
  metrics-results.json and results.json. Labeled fixtures are distinct from actual
  local GET-only service observations. External/live/mutation/WS routes blocked.
- Root inspected estimated-meter desktop and mobile fixture screenshots; normal
  and long values wrap within the meter, and controls use project interaction roles.

Screenshots are local visual artifacts; scripts/results/review are the durable receipt.
This scope does not establish real-network speed improvements or whole-product acceptance.
