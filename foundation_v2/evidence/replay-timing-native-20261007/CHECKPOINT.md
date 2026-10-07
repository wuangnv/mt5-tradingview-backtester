# Replay timing and native chart — 07/10/2026

Owner request: follow FX Replay's measured time definitions, restore normal strong
TradingView chart colors independent of the project background, and hide the logo.
The owner explicitly confirmed logo-removal rights in this task.

## Research and decisions

- [FX Replay FAQ](https://support.fxreplay.com/faqs), fetched 07/10/2026,
  defines Time Invested as active interaction and Historical Time Replayed as
  market time moved through during backtesting. It does not publish an exact
  idle threshold, multi-tab algorithm or skip/fork aggregation policy.
- Our rule: replay-workspace interaction while visible/focused, including
  paused analysis and same-origin chart iframe input; 120-second idle cutoff;
  real timestamp differences on successful canonical forward replay steps.
  Read-only seek/reload is not forward replay. Branch counters start at zero.
- [TradingView customization](https://www.tradingview.com/charting-library-docs/latest/customization/#tradingview-logo)
  makes logo visibility conditional on the license. With the owner's confirmed
  right, the pinned v23 `widget_logo` feature is disabled through widget options.
  Vendor assets/source remain untouched. Lightweight uses attributionLogo:false.
- Trading chart colors now use native teal #26A69A, red #EF5350, blue #2962FF,
  dark #131722 / light #FFFFFF; ordinary app/report palettes stay separate.
  Saved pastel layouts repaint candles and existing Volume after restore/theme
  change without changing their interval, drawings or cutoff.

## Data/state flow

The browser clock uses monotonic elapsed time, rejects suspended/clock-jump gaps,
and submits at most 30-second immutable activity segments every ten seconds.
Failed saves retry the same UUID/interval; successful receipts must match the
schema, session, event and duration. A replaced effect cannot modify the new
effect's outbox. Per-tab sessionStorage retains at most 120 pending events;
tracking pauses when full, expired events older than 24 hours are discarded.
Unavailable browser storage permits in-memory retries only. A crash/close can
lose an unsaved short tail; this is telemetry, not account/execution authority.

The additive replay_activity_intervals table has tenant/session keys, UUID
idempotency, duration checks and record FK. Same event/payload is idempotent;
changed payload conflicts. Deleted/wrong-tenant sessions are rejected. A heartbeat
locks the record but does not increment its execution revision. SQL merges
per-session intervals; Dashboard unions across selected sessions so simultaneous
tabs do not double-count practice time. Historical seconds update atomically
with the canonical cursor revision. No historical values are inferred from
creation dates or pre-tracking cursor positions.

Dashboard exposes since-tracking/partially measured scope. Timing totals are for
selected sessions, independently of trade date/side/outcome filters. Legacy
practice becomes known after its first accepted activity interval; legacy
historical time remains unknown until its next actual successful forward step.
The running imported-history API now exposes actual practice data (read snapshot:
16.258 seconds, one measured session); historical time is still null for the
owner's paused legacy sessions. This snapshot is not a fixed expected total.

## Verification

- Final production web build passed; 28 focused web model/datafeed/storage/clock
  tests passed. Five clock cases cover pause, hidden/focus, idle boundary,
  suspension/wall-clock changes and bounded segment coalescing.
- Backend worker: 59 initial focused core tests passed; new activity suite 10
  passed, including real PostgreSQL/FastAPI idempotency, concurrent duplicates,
  overlap union, tenant/deletion boundaries and persistence in a disposable DB.
  A broader run had 138 passes + 3 subtests and one missing-method FakeStore
  adapter failure. Adapter repaired explicitly; all 29 Trades tests then passed.
  Exact 13 legacy QA workspaces created by that run were removed; tenant-a was
  preserved. New integration uses and drops its own database.
- Native chart worker: nine read-only actual-service browser checks across
  1710/768/390 widths, dark/light, saved layout and reload; screenshots reviewed.
  Source/options plus canvas screenshots verify logo removal. Scoped evidence:
  ../chart-native-20261007/RECEIPT.md.
- Primary activity-ui.mjs: two real-GET/intercepted-POST browser cases, dark VI
  desktop and light EN mobile, passed offline retry with immutable event,
  receipt validation, idle stopping and iframe input resumption. No persisted
  QA writes. Initial harness iframe URL assumption and strict unknown-request
  classification failed; both diagnostic reports remain local. Final guard
  separately records and blocks the pinned vendor's Google Analytics GET.
- Independent review passed 13 browser cases: five activity/lifecycle cases,
  four native advanced/fallback palette/logo cases and four invalid-receipt
  cases. Nine non-database backend cases and five clock tests passed; no page
  errors or unexpected requests. All 19 final source/test/document SHA256 pins
  match the reviewed files. Evidence and limitations are in independent/.
  Hidden/focus checks use deterministic browser fixtures; no OS-minimized-window
  journey or new Axe scan. Database checks are separately attributed above.

## Runtime / resume

UI remains on 127.0.0.1:5180. Imported-history API remains on 127.0.0.1:8010,
paper replay only, with no --mt5-python or broker/sync arguments. It was restarted
to load the additive schema. The root .venv launcher lacked psycopg; recovery used
the verified foundation_v2/.venv/Scripts/python.exe with the same inherited local
database environment and serve_exness_history.py --port 8010. Launcher PID 24140
(child 22760 at checkpoint); stdout/stderr retained locally beside this file.
Never print the database environment. No provider, broker, holdout, trading order,
vendor source rewrite, external upload or production deployment was performed.

This is scoped UI/telemetry acceptance, not whole-product or broker acceptance.
