# Independent review: download meter and estimated remaining time

Result: **PASS 9/9 UI cases and 10 independent metrics scenarios**. Runnable commands from the product root:

```text
node foundation_v2/evidence/library-download-meter-20261008/independent/qa.mjs
node foundation_v2/evidence/library-download-meter-20261008/independent/metrics.mjs
```

Machine evidence: `results.json` and `metrics-results.json`. No source edit or commit was made by this review lane.

## UI coverage and actual versus fixture evidence

Six labeled Vietnamese fixture cases cover dark/light at 1710, 768, and 360 px, plus English dark desktop. Two actual local GET-only cases cover dark1710 and light360. The actual EUR/USD job remained paused, at rounded16 percent and27.2 MiB; no resume, pause, cancel, or new download was triggered.

Fixtures include paused cooldown, running, update of a saved dataset, failure, queued, pausing, processing, cache progress with zero network byte rate, zero-progress stall, and insufficient day progress for ETA. One fixture waits through real10-second warmup to show estimated remaining time for running/update/cache. Artificial GiB and very large MiB/s values stress layout; they are not download benchmarks.

All isolated contexts block external origins, live routes, WebSockets, and non-read requests. Zero attempted writes and zero browser errors occurred. Progress detail dialog opening and local search filtering were the only non-read UI interactions; these do not mutate backend state.

## Accepted layout and behavior

- The table has nine columns. A fixed308 px Actions column groups the meter and two icon-only controls. Its width remains the same across ordinary, active transfer, update, and error rows.
- Transfer meter width is188 px desktop and180 px mobile. The neutral4 px progress track and percentage sit above the transfer figures and ETA. Lower metadata fits inside the meter and wraps when required; bar and metadata never overlap. Percent fill matches day-based progress, including0 and100 percent.
- Running transfers omit the visible redundant downloading label. State distinctions such as paused, queued, pausing, failed, and saving remain visible. Accessible labels still include the full state, percentage, amount, speed when measured, and estimated remaining time.
- Pause/Resume and Cancel are icon-only, with nonempty accessible names and matching titles. Icons have zero center delta; controls remain circular32 px desktop /44 px mobile, separated from the meter by8 px. Controls stay inside the308 px cell and retain disabled rules. Keyboard focus is visible; the progress dialog opens locally, and Escape restores invoking focus.
- Actual and fixture layouts have no document or cell overflow. Real250 px table scroll preserves sticky header position.
- Unknown ETA displays an em dash. Warmup, zero/stalled progress, paused/error/queued/pausing, and saving states do not fabricate a remaining time. Measured zero byte speed displays0 MiB/s. Cache progress can produce ETA from completed-day throughput while its measured network byte speed remains zero.

## Source and metrics review

Reviewed `DataLibraryProgress.jsx`, `dataLibraryDownloadMetrics.js`, and the sampling/control wiring in `DataDeskWorkspace.jsx`. The source keeps existing mutation callbacks and gates. The new helper estimates byte rate from a rolling30-second window and estimates remaining calendar days from recent completed-day throughput, not from an invented total download byte size.

Independent runnable checks passed for10 scenario groups:10-second /3-day warmup; loss of ETA after more than15 seconds without day advancement; pause/resume reset; polling gap over10 seconds; byte/day rollback and nonmonotonic clock; cached-day progress with valid zero byte rate; processing/error states; unknown total calendar days; rolling30-second history; and rounded duration units with rejection of unknown/nonpositive values.

The estimate is approximate because daily artifact sizes and processing costs vary. The component's tooltip explains that ETA follows recent day throughput and excludes final saving time. No false known total byte amount is shown. This helper improves the stability and honesty of the displayed metrics; it does not make the download worker faster.

## Visual inspection and limits

Inspected `fixture-dark-1710-vi-estimate.png`, `fixture-light-360-vi.png`, `fixture-dark-768-vi.png`, and `actual-dark-1710-vi.png`. The layout follows the reference's top-meter /lower-detail hierarchy while retaining project colors, typography, and focus treatment. Desktop ETA and transfer text remain readable; mobile icons and metadata fit their table cell.

The308 px tail is slightly wider than the292 px content viewport at360 with the collapsed sidebar. Native horizontal table scrolling is intentionally preserved; the final screenshot may clip Cancel until the user scrolls farther right. This is not a missing control or document overflow. The1390 px table minimum remains unchanged.

Acceptance is scoped to the Library meter presentation and frontend metrics math. The real job was paused, so there is no current network-performance measurement or confirmation that the downloader is faster. Backend downloads, mutation/resume persistence, provider behavior, broker execution, and whole-product acceptance were not exercised.
