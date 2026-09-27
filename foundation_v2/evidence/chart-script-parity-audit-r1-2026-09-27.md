# Chart script parity audit — r1

**Status:** `AUDIT_FINDINGS_OPEN / PREP_ONLY`, 27/09/2026
**Scope:** Pine Script/TradingView and MQL5 indicator adapters over the
canonical `foundation_v2` SMC/ICT event engine. This is an engineering audit;
it is not a strategy, broker integration, provider evaluation, or evidence of
trading edge.

## Decision

Keep one deterministic, closed-bar engine as the semantic authority. Pine,
TradingView Advanced Charts, and MQL5 are projections that must pass the same
parity fixtures. Do not port a community script as a second source of truth.
The current engine has a sound causal core for FVG, confirmed swing, close-BOS,
session and last-confirmed MTF mapping. Commit `d3a1fef` now propagates
machine-readable causal metadata and separates delayed swing overlays from
zero-delay structure changes. Renderer acceptance still remains PREP_ONLY until
the cross-adapter fixtures below are closed.

## Official semantics checked

The primary references below were reachable with HTTP 200 on the audit date and
were also recorded in `planning/research/chart-intelligence-2026-09-27.md`:

| Area | Verified implication for parity |
|---|---|
| Pine execution/repainting | Realtime updates can be rolled back; confirmed signals must use a closed-bar boundary. A pivot plotted back on its anchor after right bars close is visually useful but can repaint unless its `known_at`/delay is retained. |
| Pine higher-timeframe data | HTF values from an unconfirmed source bar can repaint. `lookahead_off` alone is not an anti-repaint proof; the adapter must publish the last confirmed HTF close and source timestamp. |
| Pine lower-timeframe data | Intrabar requests have a different cardinality/order contract and must not silently use an unfinished intrabar. Missing/gapped source bars stay unknown. |
| Pine alerts | `alert()`/`alertcondition()` create alert events from a saved script/input snapshot; close-only frequency is required for confirmed parity. An alert receipt is not an order/fill. |
| Pine drawings/limits | Plot/drawing IDs and loop/request budgets are bounded. Object eviction/TTL is a renderer concern and must not delete the canonical event. |
| MQL5 `OnCalculate` | `prev_calculated == 0` requires a safe full rebuild after history changes; incremental paths must produce the same result as rebuild. |
| MQL5 `CopyRates`/`iBarShift` | Copied timeseries order and gap handling must be normalized explicitly. Exact lookup returning no bar must remain unknown rather than nearest-filled. |
| MQL5 chart objects | Object calls are queued; a successful create call is not visual proof. Registry-prefix reconciliation and one batched redraw are required. |

Primary URLs:

- <https://www.tradingview.com/pine-script-docs/language/execution-model/>
- <https://www.tradingview.com/pine-script-docs/concepts/other-timeframes-and-data/>
- <https://www.tradingview.com/pine-script-docs/visuals/lines-and-boxes/>
- <https://www.tradingview.com/pine-script-docs/concepts/alerts/>
- <https://www.tradingview.com/charting-library-docs/latest/custom_studies/Custom-Studies-Examples/>
- <https://www.tradingview.com/charting-library-docs/latest/ui_elements/Marks/>
- <https://www.mql5.com/en/docs/customind>
- <https://www.mql5.com/en/docs/event_handlers/oncalculate>
- <https://www.mql5.com/en/docs/series/copyrates>
- <https://www.mql5.com/en/docs/series/ibarshift>
- <https://www.mql5.com/en/docs/constants/objectconstants/enum_object_property>

## Local behavior verified

The audit inspected the canonical files below at MT5 repo HEAD
`d3a1fef` and ran a deterministic probe. The CHoCH/liquidity candidate is
committed; alert normalization and the `LIQUIDITY_SWEEP` allow-list were fixed
in `666e8da`. Causal overlay metadata and the delayed-swing packet split were
fixed in `d3a1fef`. The remaining findings below are still PREP_ONLY gates.

- `chart_intelligence.py` normalizes timestamps as UTC close times, rejects
  duplicate/out-of-order/non-finite OHLC, creates FVG on the third closed bar,
  emits a pivot only after its right confirmation bars, uses a close break for
  BOS, and maps MTF values only when source close `<=` display close.
- `chart_overlay_contract.py` validates schema/hash/cutoff/MTF/repaint fields,
  retains optional causal `known_at`, `source_bar_ids` and
  `confirmation_lag_bars`, rejects future anchors and forbidden provider/broker
  fields, and caps a packet at 256 overlays.
- The probe emitted `SWING anchor=1700100002 known_at=1700100004 lag=2`, then
  produced separate `market_structure` (BOS, delay 0) and `swing_points`
  (delay 2) packets. The swing overlay contains machine-readable
  `known_at=1700100004`, `source_bar_ids`, and `confirmation_lag_bars=2`.
- The legacy `MT5Gateway.mq5::HandleGetData()` path is not a drop-in source for
  `ChartBar`: it mutates `rates[copied-1]` with `tick.bid` and serializes
  `MqlRates.time` without a closed/open-time marker. Unknown timeframe strings
  fall back to `PERIOD_CURRENT`, and `bars` has no explicit bounded validation.
  This path requires an adapter gate and is intentionally outside the PREP_ONLY
  engine.
- The committed chart-intelligence path emits `CHoCH` and
  `LIQUIDITY_SWEEP`; alert event normalization uppercases `CHoCH` to the
  canonical `CHOCH` and `666e8da` adds `LIQUIDITY_SWEEP` to the allow-list.
  The direct alert smoke now emits receipts for both kinds.

## Findings and gates

| ID | Severity | Finding | Required action |
|---|---|---|---|
| PARITY-01 | resolved | `d3a1fef` splits delayed swings from zero-delay structure and retains machine-readable `known_at`, source bars and lag in the validated overlay packet. | Keep renderer adapters bound to these fields; never parse causal timing from labels. |
| PARITY-02 | high | Equal-high/equal-low pivot behavior is implicit and asymmetric (`>` on the left, `>=` on the right). Pine/MQL implementations may choose a different tie policy. | Freeze a named tie policy and add equal-price positive/negative fixtures before claiming cross-adapter parity. |
| PARITY-03 | high | No fixture proves that Pine plot-offset/backfill is not mistaken for event time. | Compare `anchor_time` with `known_at`; assert no event is visible before confirmation in replay and alert paths. |
| PARITY-04 | high | Alert parity is not covered for same-bar versus close-only delivery. | Add confirmed-only, once-per-close, duplicate/reconnect and saved-input snapshot fixtures. Keep delivery local/advisory. |
| PARITY-05 | medium | No MQL5 `CopyRates`/`iBarShift(exact=true)` gap/order corpus is checked against the canonical mapper. | Add physical-order normalization, missing-bar unknown, DST and irregular-gap fixtures. |
| PARITY-06 | medium | Engine vocabulary/adapter declarations include OB, CHoCH/MSS, liquidity and OTE, but this slice does not yet calculate their lifecycle semantics. | Keep these as schema/reference only until each has a versioned detector, invalidation and OOS fixture; do not render a placeholder as confirmed. |
| PARITY-07 | medium | C2 intentionally treats a source close equal to a display close as eligible. Pine's common no-repaint `expression[1]` + `lookahead_on` idiom exposes that value from the first lower-timeframe bar after the boundary. Both are causal but differ by one lower bar. | Freeze a named boundary mode (`inclusive_closed_boundary` or `pine_offset_first_next_bar`) and test both before claiming byte-for-byte Pine parity. |
| PARITY-08 | blocker for direct MQL adapter | Legacy `MT5Gateway.mq5::HandleGetData()` calls `CopyRates(..., 0, ...)`, then overwrites the newest row with current bid/high/low. It emits no `closed` marker. Its `MqlRates.time` is a bar-open timestamp, while `ChartBar.timestamp` is a UTC close timestamp. Unknown timeframe strings also fall back to `PERIOD_CURRENT`. | Drop the provisional final row or carry an explicit `provisional` state; convert/validate open→close timestamps with resolved server timezone and timeframe; reject unknown timeframe/count before canonical normalization; add live-row, timezone and gap fixtures before MQL parity. |
| PARITY-09 | resolved | The committed `CHoCH`/`LIQUIDITY_SWEEP` events now normalize through the alert contract; positive tests cover both. | Keep the uppercase canonical event enum stable across future adapters. |

## Parity matrix to implement

| Feature | Canonical rule | Pine/TradingView projection | MQL5 projection | Acceptance |
|---|---|---|---|---|
| Swing | left/right pivot; `known_at = anchor + right bars`; explicit tie policy | marker may be offset to anchor but carries confirmation time | buffer/object appears only at confirmation or carries delayed metadata | prefix equality + tie fixtures |
| FVG | three closed bars; third bar creates event; lifecycle is separate | bounded zone/plot; no unconfirmed alert | bounded object/level registry; reconcile stale IDs | creation, partial/full fill, invalidation |
| BOS/CHoCH | protected swing, explicit close-vs-wick break, prior trend state | mark/alert only after close | buffer/mark only after close | duplicate suppression + state transition |
| Liquidity/sweep | referenced level, tolerance, wick-through then close-back | mark with level and expiry | object/level with same IDs | missing level and gap fixtures |
| Session/DST | IANA timezone resolved to UTC; explicit fold policy | marks/zones use canonical UTC timestamps | broker/server times converted before lookup | spring/autumn DST, midnight, missing bars |
| MTF | last confirmed source close `<=` display close; no nearest fill | source timeframe/close carried in context | `CopyRates` order normalized; exact gap stays unknown | lookahead regression |
| Alerts | confirmed event + rule/input snapshot + dedupe | close-only alert adapter | local event/notification adapter | reconnect/replay does not duplicate |

## Take/adapt/reject

- **TAKE:** canonical event schema, close-time timestamps, causal `known_at`,
  source-bar IDs, deterministic IDs, last-confirmed MTF mapping, bounded
  packet/object registries, and revisioned local alert receipts.
- **ADAPT:** Pine plot/mark and MQL5 buffer/object idioms only as render
  adapters; community scripts may seed fixtures after license and behavior
  review. No script gets authority over event semantics.
- **REJECT:** `lookahead_on`/nearest-fill without confirmed-source proof,
  pivot backfill treated as historical fact, alert receipt treated as fill,
  opaque EX5/protected scripts, and unlicensed copied code.

## Validation run

```text
PYTHONPATH=. uv run pytest -q \
  tests/test_chart_alert_contract.py \
  tests/test_chart_explainability_contract.py \
  tests/test_chart_intelligence.py \
  tests/test_chart_intelligence_stress.py \
  tests/test_chart_overlay_contract.py \
  tests/test_chart_renderer_contract.py \
  tests/test_chart_ai_contract.py \
  tests/test_feature_timing_contract.py
78 passed

Overlay/intelligence/renderer focused: 32 passed

uv run python -m compileall -q trading_workspace_v2
PASS
git diff --check
PASS
```

These tests validate the existing offline contracts; they do not close the
PARITY-02..08 gaps above. PARITY-01 is resolved by `d3a1fef` and PARITY-09 by
`666e8da`. No provider,
broker, alert service, API key, account,
holdout data, or live execution was opened.

## Source hashes

The code inspected for this receipt was hashed before writing it:

```text
foundation_v2/trading_workspace_v2/chart_intelligence.py
f996a85e52b1d4841d0b955794f5e3c6e103b229d9adffc1881961aec4771fd8
foundation_v2/trading_workspace_v2/chart_overlay_contract.py
7ec159cdcf34855546c43971a579859f57eca8e3398c00f73b4f52219366cec8
foundation_v2/tests/test_chart_intelligence.py
4ac5f12d12c0084ac5e0f09cca68a4c7002b1fb9bcff79e93c1b7b7ef05fed41
foundation_v2/tests/test_chart_overlay_contract.py
d6d7fb3fd67dbf0b7e40827b299609bc346be8c913c6fc39b6c3de09f6eaf33b
```

This receipt intentionally records open parity work instead of claiming that
Pine or MQL5 output is already production-equivalent.
