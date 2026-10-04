# Chart workbench — owner-approved FX Replay reference, 04/10/2026

## Behavior and ownership

The owner approved the previously proposed chart-workspace direction. Replay now owns one compact command row in the shell's header slot, two SVG tool rails, a dominant chart, two movable/pinnable/collapsible toolbars, an Order/Objects/Data/Context dock, and a bottom simulator trading/account bar. Toolbar preferences are local to the workspace. The original concern was floating controls obscuring candles; movement, pinning and collapse let the owner choose clear space. Mobile defaults separate the two controls.

Lightweight Charts 5 remains the renderer. No proprietary FX Replay source or assets were imported, and no new dependency was added. Native drawing/order primitives follow pan, zoom and scale changes. Light/dark themes cover the actual canvas and overlays. The order primitive shows entry, TP/SL, risk/reward regions and available floating P/L, with autoscale including protection levels.

## Data/state flow

Persisted session and dataset responses supply visible OHLC, instrument metadata and execution state at the selected cutoff. Historical execution reuses the existing analytics checkpoint reconstruction; an unavailable/mismatched checkpoint suppresses account and position values rather than exposing future state. Historical/completed/conflicted sessions cannot mutate through chart controls.

Simulator initialization and next-bar market orders reuse the existing service. New `orders/protection` changes queued/open protection through expected revision, target identity and unique operation ID. A typed `protection_change` ledger checkpoint preserves entry/quantity/account state; updated protection applies on subsequent bars. Pointer and keyboard changes are fenced by session/revision/cursor generation. Bid/ask and protection references reuse adverse tick rounding consistent with the backend's `quote_from_mid`. Stale revision receives 409 and requires reconciliation.

## Verification and receipts

- 98 focused Python execution/protection/margin/analytics tests; seven ReplayPropConnectionTests plus three subtests passed. 23 focused Node tests passed; the five order-model tests were rerun after the quote correction.
- Final production build passed, 101 modules. Vite retains the existing large-chunk advisory; no build failure.
- 36 actual read-only route/theme/width axe/reflow cases passed. Report hash `43161e63…` belongs to that probe's frontend manifest; it is not the independent composite hash below.
- Seven real UI/API/PostgreSQL journeys passed in a unique disposable database: initialize, queue, next-bar fill, pointer/keyboard protection, stale 409/refresh, reload and history. Eight light/dark layouts are included. Only generated synthetic mixed OHLC were used. The temporary database was dropped; existing owner QA data was not changed.
- Actual GET-only preview: five interaction journeys/eight layouts and six empty/missing/invalid-cursor state cases passed. The earlier API-mismatch probe deliberately verifies frontend suppression; it does not claim historical backend support before the restart.
- Independent visual/source review accepted six viewport/theme cases. Final quote correction passed 1,296 independent Decimal/backend/frontend fixtures and 2,592 BUY/SELL reference comparisons, 15 protection tests and renewed 1440/360 light browser checks with zero console errors/overflow/axe WCAG 2.2 AA violations. Final independent composite hash: `fec81b99fc901bd1d55fe297e011c6ffddb5591a7030a36e7c4bf4ea23e13e1b`.
- Root inspected the position desktop capture. After final restart, UI GET returned 200; historical GET #20 returned execution #20, balance 100025.0 and `execution_view_status=checkpoint`; protection route exists in OpenAPI.

Selected receipts and screenshots are retained alongside this checkpoint. Full root probe receipts remain under workspace `.artifacts/chart-workbench-20261004/{routes-final3,integration-61f5c0df,actual-api-final,edge-states-final}`; independent probe source and attempts remain under product `.artifacts/fx-chart-review-20261004`. Earlier failed contrast, source-drift and harness attempts remain separate, not counted as passing evidence.

## Runtime and limits

Owner preview: UI `http://127.0.0.1:5180`, managed session 53930; API `http://127.0.0.1:8020`, final managed session 15648/PID 20348. Verify liveness before later reuse. The existing loopback QA adapter retains GET/HEAD/OPTIONS-only middleware against `trading_workspace_v2_ui_20261001`, broker locked. The owner can inspect the new UI here; order writes are intentionally rejected. Write acceptance above belongs only to the disposable integration database.

Immediate same-cursor Prop branching after a protection amendment still fails closed until a new canonical price-mark/Prop checkpoint. No Prop contract widening, broker/provider authority, database reseed, shared-system/golden promotion, ledger/STATE update or whole-product acceptance is claimed. VI Dubber remains deferred. This checkpoint closes the requested chart implementation slice, not the entire product plan.
