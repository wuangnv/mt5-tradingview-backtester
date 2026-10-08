# Decimal sizes, M1 and compact progress — 08/10/2026

Owner requested M1 rather than 60s, MB/GB rather than MiB/GiB, and a bar with
downloaded bytes @ MB/s on the left and ETA on the right; total only when known.

Shared `dataDisplay.js` normalizes display timeframes (60s / 60 seconds / 1m → M1)
and decimal data sizes. Used in catalog/saved grid, details, delete confirmation,
session picker/creation and replay display labels. Underlying timeframe fields,
drawing scope, hashes, prices and datasets are unchanged. CSV file size and
compressed market-data size reuse the same formatter; import byte limit unchanged.
Existing EUR/USD replay bytes 140,930,011 now display 140.9 MB, not 134.4 MiB.

Progress has a bar above, downloaded amount @ speed left, ETA right. Known totals
use matching units (0.6/28.8 GB); unknown totals have downloaded only (600 MB).
No adjacent percentage, elapsed clock or state text. Existing indeterminate and
reduced-motion behavior retained. API-provided valid speed/ETA take priority over
local estimates. QDM phases remain phase percentages, not whole-job progress.
Missing byte counts, speed and ETA stay explicit unknowns; zero remains distinct.

Capability check: installed QDM help, adapter and observed 08/10 CLI log, plus
official https://strategyquant.com/doc/cli-command-line/data-manage-data/.
The installed help/doc do not expose transfer telemetry; observed log has phase
percentages, no numeric MB/GB transfer tokens. Current adapter returns null bytes
and no total. No basis to promise a known pre-download total or live MB/s for QDM.
No new download, QDM command, process restart or unsafe cache-size approximation.

Validation: 25 focused formatter/model/date/metrics tests and production build
pass. `qa.mjs` labels telemetry fixtures: known total, downloaded only, real QDM
unknown shape, measured zero, processing, reduced motion. Tests left/right geometry
and one-line metadata, no numeric unknown progress, no false processing ETA.
Live read-only UI/API at owner width 1587: saved row and details both M1 / 140.9 MB.
Screenshots reviewed; no API writes. Active telemetry images are fixtures, not
measured performance. Historical replay QA expectation updated to M1; full
realHistory journey not rerun in this display-only task.
