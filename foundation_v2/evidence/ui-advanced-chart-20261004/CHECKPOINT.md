# Advanced Charts migration — 04/10/2026

## Behavior and authorization

The owner confirmed that Advanced Charts access has already been granted for this
project and requested it as the fallback to FX Replay Alpha. Public research found no
external FXR Charts SDK/distribution offer. No FX Replay code was copied. The existing
ignored local Advanced Charts v23.040 distribution now runs as the default replay engine;
no library upgrade, account registration, vendor publication or provider integration
was performed. Proprietary files remain ignored and outside the application bundle.

Native tools now provide drawings, indicators, chart types, settings and supported
intervals. Overlapping custom rails/menus were removed for this engine. WMReplay owns
the session/replay toolbar, app dock and simulation bar. Native chart interaction pauses
replay before gestures. Entry/SL/TP use native trading lines; protection fits the price
scale and can be fitted again with "Vừa lệnh". The old Lightweight engine remains an
explicit `chart_engine=lightweight` rollback, including when licensed assets are absent.

## Data/state and trade-offs

The API owns sessions, revisions, execution, datasets and workspace annotations. The
datafeed receives only `visible_rows` at the selected cutoff, clones bars, honors
countBack from older visible data and causally aggregates supported higher intervals.
It never retrieves market data from TradingView or creates lower-resolution candles.
Unknown constituent volume does not become a misleading partial total. Rewind rebuilds
the widget and invalidates datafeed callbacks; forward updates emit all missed bars in
order. Symbol, instrument tick and asset class stay bound to the current dataset.

Native drawings/layouts/indicators save locally by workspace/session/dataset with
bounded cutoff snapshots (24). History cannot restore a later snapshot. They are
browser-local, not synchronized to PostgreSQL. Existing API annotations retain their
owner and render as readonly imports for all eight types; native save/delete does not
duplicate or delete those records. Theme overrides apply after native layout restoration.
Order drags retain target identity, current session/revision/cursor fences, next-bar fill
and protection semantics. Historical/completed/conflicted states cannot mutate.

## Verification

- 18 focused Node adapter/storage/order/drawing tests passed. They cover causal
  partial buckets, backfill, clone isolation, rewind then forward, unknown volume,
  declared precision/resolutions and cutoff-local snapshot restore.
- Final actual GET-only preview: 7 native journeys passed, including two real pointer
  clicks from the native drawing toolbar, indicator dialog/RSI, settings, style/interval,
  save/reload, history cache/cutoff, current theme after restoring layout, six responsive
  theme/width cases and explicit missing-asset rollback. Zero page errors.
- Final unique disposable PostgreSQL integration: 11 checks passed against real UI/API,
  using labeled synthetic mixed OHLC. All eight persisted annotation types rendered
  and remained excluded from native serialization; deleting all native shapes restored
  readonly imports. Simulator initialization, queue, next-bar fill, native SL pointer
  drag, protection ledger/unchanged entry and balance, stale 409, reconcile/reload and
  historical edit locks passed. The generated database was dropped; preview data was
  not reseeded or changed. Final full receipt:
  workspace `.artifacts/advanced-chart-20261004/integration-a1888ba1/`.
- Root inspected desktop native/tools, light mobile and the real post-drag position
  screenshot. The saved dark-layout/light-shell mismatch found during inspection was
  repaired and rerun before acceptance.
- Custom native-header controls have button semantics/tab focus: Enter saves the
  layout and Space fits entry/SL/TP with a verified price-range oracle. The embedded
  chart frame and document have explicit titles.
- Independent review accepted the scoped local migration with a frozen six-file
  composite `67c495e19d807e4b83994a32f7f722b18ec8c90d67de550eb6a8a6732dd3fb83`.
  Six responsive/theme cases plus cutoff/save/theme/rollback, four keyboard checks
  and five independent helper tests passed. Native 5-second history/reset/forward
  was also verified on a separately labeled synthetic fixture. Reviewed final
  screenshots and the root's real disposable receipt agree. See INDEPENDENT-REVIEW.md.
  The remaining vendor dark auto-scale text contrast is 3.65 versus 4.5 at desktop/
  tablet; titles and mobile scroll-focus checks are clear. This is not full WCAG
  acceptance; no vendor asset was patched to hide the limitation.
- Production build passed (104 modules); existing large-chunk advisory remains.
  Build excludes proprietary assets; a standalone server must mount the authorized
  distribution separately at `/charting_library/`. Vite dev/preview already does this.
- Vite production-preview smoke passed for build HTML and licensed asset HEAD;
  missing assets, path escape and unsupported methods returned 404/404/405.
  The temporary preview listener was closed. The explicit Lightweight rollback
  retained five GET-only journeys/eight responsive theme/width layouts, zero page
  errors; receipt workspace `.artifacts/advanced-chart-20261004/rollback-readonly-final/`.

Selected reports/screenshots beside this checkpoint are scoped receipts, not promoted
goldens. Earlier failed harness and theme/cache attempts remain under root/product
`.artifacts/advanced-chart-20261004/`; they are not counted as passing evidence.

## Runtime and remaining scope

Preview UI is `http://127.0.0.1:5180`, API is `http://127.0.0.1:8020`. The API preview
remains GET/HEAD/OPTIONS-only and broker locked. Native drawing/local save is usable;
order write acceptance above belongs to the disposable integration environment.
The owner browser/profile was not used for testing. Native snapshots created by QA
belong only to isolated test browser contexts.

This closes the requested local engine migration slice. It does not close full U4,
whole-product acceptance, chart performance at scale, manual WCAG, real-data/OOS,
provider/broker/deploy or Trading Platform order-flow/depth capabilities. VI Dubber
remains deferred. Canonical ledger/STATE and vendor assets were not modified.
