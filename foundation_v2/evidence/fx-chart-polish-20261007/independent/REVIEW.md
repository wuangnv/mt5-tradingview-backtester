# Independent review — FX Legacy polish

Status: PASS for this scoped change. `final-receipt.json` records source hashes and the focused validation; `validate-report.mjs` asserts the saved browser report.

The reviewer ran `node foundation_v2/evidence/fx-chart-polish-20261007/independent/review.mjs` against real local API GETs. All POSTs except a clearly intercepted activity receipt were blocked. No owner session step/order writes or external browser/profile access occurred.

Five browser cases: 1920×940 dark Vietnamese, 1611×1259 dark English, 768×987 dark Vietnamese, 360×987 light English, 1920×940 light English. No page errors, unexpected requests or document horizontal overflow. The inspected report and screenshots are adjacent to this file.

## Findings resolved during review

- The full-width native header initially had correct DOM rectangles but was clipped by `.chart-canvas` and the narrowed native iframe body. The root corrected overflow on both scopes. The final screenshot shows all right controls, and iframe hit tests at viewport-right−18, y18 resolve to Fullscreen on desktop and responsive Chart tools on narrower widths, before and after opening the tree.
- The document capture replay shortcuts initially guarded only native HTML buttons/inputs. The replay implementer expanded guards to native roles/menu/listbox/dialog/slider, preserving native interaction ownership. Final source checks include this correction.

## Verified frontend behavior

- Native header reaches viewport right; right rail starts at y42 after the 38px header plus 4px divider. On desktop the native center's right equals drawer left (1592 at width1920, 1283 at width1611). Native canvases resize and the price scale remains visible.
- At 360px the drawer intentionally overlays the chart to respect the library minimum body width; it stays below the header and before the rail. No document overflow.
- Speed slider has sixteen positions, Home=1 and End=16; keyboard adjustment does not step replay. M1 data disables unsupported sub-minute intervals.
- Actual read-only navigation with selected5m moves500→495→500. No replay mutations are sent during this journey.
- Footer Buy/Sell labels are white, quantity has a single rounded outline, positions grip opens a130px panel, and maximize expands positions below the header. The floating replay toolbar remains above the maximized table.
- Unknown execution balance displays a dash; its popover keeps Equity, Realized PnL and Unrealized PnL unknown. No fabricated balance.
- Scalper settings open and dismiss in dark/light at representative widths. The current scope applies protection distances to a confirmation draft; it does not imply broker or instant execution.

## Final interval contract review

The server extension preserves existing bar-count steps and accepts an optional strict interval in seconds. Interval and a nondefault bar count cannot be combined. The helper finds the first available timestamp in the next UTC bucket, handles gaps without inventing bars, bounds work to1000 underlying bars, validates dataset resolution, and retains tenant/revision checks. Historical GET advancement clamps to the canonical cursor and cannot update a record. The execution loop processes every underlying bar, including an intermediate protective fill.

Independently ran14 backend interval tests and13 JavaScript replay/scalper model tests: all passed. The first backend command from the foundation directory could not import the existing fixture namespace; rerunning from the repository root with `PYTHONPATH=foundation_v2` passed. The final5-case browser run occurred after the API restart and includes actual interval GET navigation. No live session step/order mutations were performed by the reviewer.

## Proposed consistency direction, not implemented

Keep native Legacy trading density, candles and Buy/Sell semantics. Unify app-owned interaction states around the existing project hover/focus/disabled rules, reduced-motion handling, text baseline and icon boxes. Testing uses pill buttons and peach navigation, whereas native chart tools use squared compact controls and blue active states. Those differences are purposeful for this chart reference; converting every native button to Testing's40px pill would undermine the approved FX Legacy direction.

Recommend one shared app control/focus rule for the chart's React portals/popovers and Testing, while preserving native chart fonts/layout and blue replay/scalper action semantics. Do not introduce new wrappers or replace the native toolbar for this consistency task.

Limits: this is a local GET-based UI review plus isolated engine tests, not broker, live-owner mutation-engine, complete FX parity, unsupported multi-layout, Auto Break-even, or cloud-save acceptance. Mobile positions use a horizontally scrollable table; a long unknown-state row may require horizontal scrolling to read fully. The final footer settings use persistent session/workspace-scoped presets and off-by-default switches with disabled distance inputs.

## Optional srcdoc compatibility follow-up

Reviewed the explicit `chart_iframe=srcdoc` branch: it reads only the app-generated v23 blob document, checks frame existence/blob protocol and response success, preserves the original encoded widget hash before initialization, escapes `<` in the injected JSON string, and refuses assignment after cleanup or iframe detachment. The source has the same local origin as the original blob widget; no additional remote document is loaded and vendor files stay unchanged. Cancellation does not abort a small blob read, but it prevents stale assignment/state updates.

Focused Chromium actualGET verification in `srcdoc.mjs` passed initial load and reload at1920×940. The instrumented native readiness callback fired once per load; no duplicate initialization was observed. Native screenshot menu opened with two actions, chart interval changed to5m, Ctrl+S saved only to the disposable browser's localStorage, and reload restored5m while preserving the exact cutoff. The full-width header remains hit-testable and the object drawer resizes center to1592px. No page errors or unapproved requests. `srcdoc-report.json` and the two screenshots record this check.

The default blob path remains unchanged. This review establishes local Chromium compatibility for the explicit flag; the root's separate Codex IAB evidence confirms that environment. Activity calls use a labeled intercepted receipt with matching duration so the reviewer never writes owner activity or introduces an artificial warning state.
