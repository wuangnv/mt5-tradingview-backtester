# Chart renderer C3 — offline reconciliation contract

Status: **PREP_ONLY**, 27/09/2026. This receipt records a local renderer
contract, not a TradingView/MQL5 integration or a trading claim.

The C3 slice treats each overlay packet as a full snapshot for one source and
replay cutoff. It converts active preview/committed overlays into bounded
renderer objects, filters them by an inclusive UTC viewport, applies a hard
object and visible-object budget, and returns deterministic `upsert`, `hide`
and `remove` operations. Objects missing from a later full snapshot are marked
`stale_snapshot` and removed. A cap eviction is reported separately as
`budget_evicted`; it does not create a tombstone, so the object may reappear
when a larger budget is explicitly selected.

The lifecycle helper implements `preview -> committed` and
`preview|committed -> undone`. Every real transition increments the overlay
revision; undo records `undo_of_revision`. Renderer state keeps hidden objects
and tombstones, rejects revision regressions and same-revision content edits,
and prevents stale revisions from being resurrected after cleanup. Transition
and plan operations are local JSON data only.

The default cap is 256 registered objects and 256 visible objects, matching
the existing overlay packet boundary. Both values are configurable in a
`RendererBudget` for focused stress fixtures. Eviction ranks committed objects
before previews, then newer anchor/revision values, with the object ID as a
stable tie-breaker. This policy is deterministic and observable in plan
statistics and `stale_cleanup`; it is not a claim that a production renderer
can sustain the same load.

Validation: `37 passed` across C3, overlay, C1, C2/stress and feature-timing
tests; compileall and diff checks passed. The tests cover lifecycle revisions,
undo tombstones, stale snapshot removal, viewport/visible caps, deterministic
eviction, revision conflicts and malformed state.

The module intentionally does not import a chart SDK, create an MQL5 object,
call `ChartRedraw`, open a TradingView account/license, request an AI provider,
read holdout data, invoke a broker, or claim a positive edge. The next C3 gate
is adapter-specific visual/interaction QA using the same render plan on the
selected chart implementation.
