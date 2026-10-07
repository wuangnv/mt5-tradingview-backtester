# Legacy FX chart controls and layout Save

Scope: owner's chart comments 1–10 and final instruction to retain Save as in FX.
Product source remains `foundation_v2`; this is a scoped implementation checkpoint,
not whole-product or broker acceptance.

## Delivered behavior

Session title is plain text. Visible Save follows local dirty/saving/saved/error
state, with manual Ctrl+S and guarded autosave. Layout selector uses reference
rows 1–8 and sync controls, with unsupported arrangements disabled. Camera has
Download/Copy using client-only PNG. Native header separators and fullscreen sit
in the header. Object drawer uses public native entity APIs. Order opens the
existing simulator in a focus-trapped modal. Go To is an anchored menu preserving
safe historical navigation. Journal uses cutoff-safe closed trades for Trades
and Month/Year calendar. VI/EN, dark/light and responsive controls are retained.

The existing execution hook remains the authority for order validation/submission;
both SL and TP are required. Layout snapshots flow from the widget to browser
storage. Journal/Positions derive from the execution ledger, with unavailable data
distinct from empty and unknown commission shown as a dash.

## Verification

- `npm run build`: PASS after final source changes.
- `node --test tests/advancedChartSave.test.mjs tests/advancedChart.test.mjs tests/replayActivityClock.test.mjs`:
  18 PASS; includes timeout, stale callback, storage error, historical cutoff and clock tests.
- `verify.mjs` / `report.json`: actual local service reads, guarded five-case
  Chromium matrix at 1710/1611/768/360, VI/EN and dark/light. No real order/step,
  cloud or WebSocket writes. Activity receipt and clipboard are intercepted.
- Independent review under `independent/`: actual native objects and popup
  transitions; populated Journal precision/UTC/calendar/keyboard checks; Order
  success/error/pending with the real hook and intercepted submit callbacks;
  scoped accessibility scans; Save quota/retry and image export race checks.
- Resize anchor-loss race, popup currentTarget race, drawer specificity, light
  P/L contrast and required SL/TP affordances were fixed from review findings.

## Limits and unresolved runtime issue

The v23 public native Object Tree probe did not open the native panel. The current
app drawer wraps public `getAllShapes`/`getAllStudies`; desktop shrinks the entire
widget and keeps its price axis visible. FX's native tree starts below its header,
so this is not exact native/pixel parity. Unsupported layouts, presets, break-even,
strategy creation and future/news/session jumps stay disabled.

Save is browser-local; no cloud syncing is claimed. Clipboard QA uses real PNG
blobs with a labeled sink and permission-failure fixture, not the owner's OS clipboard.

The Codex in-app browser failed to load the Advanced Charts iframe after HMR and
again after deliberate reload and a fresh temporary tab. It shows the existing
timeout alert. No definitive cause was established. Fresh guarded Chromium
journeys loaded successfully; those results do not establish healthy IAB runtime.
The temporary diagnostic tab was closed; owner's tabs remain open.

Research and reference/source distinction: [RESEARCH.md](RESEARCH.md).
