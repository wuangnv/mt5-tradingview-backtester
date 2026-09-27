# Chart SMC/ICT + AI-on-chart contract — r1

Status: **PREP_ONLY / local contract**, 27/09/2026. This packet is an engineering
boundary for chart previews. It is not a strategy, a broker integration, a
provider evaluation, or evidence of a trading edge.

## What the audit found

- The legacy `chart_store.py` already stores time/price anchors, instrument,
  timeframe, source, strategy version and replay cutoff. Revisions, deletion
  and revision restore provide the persistence primitive for undo.
- `workspace_chart.py` exposes the local annotation/layout APIs, but it does
  not validate indicator definition identity, confidence state, repaint state,
  multi-timeframe policy or a renderer preview action.
- The current frontend `static/js/charts.js` creates one TradingView widget and
  draws execution markers. It has no deterministic SMC/ICT feature engine and
  no AI overlay preview/accept/undo path. The local chart bundle/license is a
  separate acceptance gate.
- Foundation v2 `ChartAnnotationDraft` covers basic anchor/cutoff validation,
  but is intentionally narrower than a feature-engine output contract.

## Methodology primitives and causal rules

The first offline vocabulary is deliberately small: ICT fair-value gap (FVG),
ICT liquidity sweep and session range; SMC swing points, BOS, CHOCH, order block
and liquidity sweep; and a price-action break/retest reference. These labels are
descriptive feature families, not a claim that any label predicts price.

Every feature definition carries a version, display/source timeframe, explicit
IANA timezone, MTF policy, look-ahead policy, causal delay and repaint metadata.
The accepted policies are:

- same timeframe, or higher timeframe aggregated from **closed** source bars;
  lower-timeframe features require an explicit ordered source;
- `closed_only` or `next_bar_open`; Pine/renderer-style lookahead is rejected;
- centered swings and other right-bar confirmations carry their delay. A
  provisional repainting feature may appear only as a `preview`; it can never
  be committed until its confirmation contract is satisfied;
- all timestamps and prices are canonical data anchors. Anything after the
  replay cutoff is rejected before rendering or provider invocation;
- sessions are interpreted in their declared IANA timezone and should be
  normalized to UTC for storage/comparison. No machine-local timezone default.

If OHLC cannot establish intrabar order (for example, stop and target are both
hit), the downstream research contract remains ambiguous and requires a lower
timeframe ordering source. The overlay packet never turns that ambiguity into a
fill or trade instruction.

## Overlay packet

`chart-overlay-packet-v1` contains one deterministic indicator definition, its
SHA-256 identity, a source/dataset identity, a replay cutoff and a bounded list
of overlays. Each `chart-overlay-v1` overlay contains:

- kind and one/two `{timestamp, price}` anchors;
- instrument/display timeframe, source and the exact cutoff;
- `confidence.state` = `known`, `uncertain` or `unknown`. Unknown has no numeric
  value; a confidence value is metadata only and cannot authorize a trade;
- `repaint.flag/state/confirmation_bars`;
- `status` = `preview`, `committed` or `undone`; undo records the prior revision;
- indicator definition hash and a cache key derived from definition, source,
  instrument, timeframe and cutoff.

The validator rejects forbidden provider/credential/holdout/broker fields,
unknown schema fields, duplicate overlay IDs, stale cache keys, invalid timezones,
future anchors, mismatched source/cutoff and provisional committed overlays.
The packet is capped at 256 overlays so a malformed provider response cannot
create an unbounded render workload.

## Deterministic engine boundary

`trading_workspace_v2.chart_overlay_contract` validates and normalizes metadata;
it intentionally does not calculate SMC/ICT signals. A future indicator engine
must consume immutable bars through a local, versioned adapter and emit this
packet. The renderer and AI service must remain downstream consumers:

```text
immutable bars + cutoff
  -> deterministic indicator definition/engine
  -> chart-overlay-packet-v1
  -> renderer preview
  -> user commit or undo (revisioned annotation)
```

An AI provider may propose an overlay candidate from a bounded visible slice,
but it cannot invent the source/cutoff, calculate risk, access holdout bars or
invoke broker actions. The validator is authoritative for geometry, causal
timing, identity and status. Provider-off/unavailable must leave the core chart
usable.

## Cache and performance direction

The cache key includes every causal input and the definition hash, so changing
the cutoff, source dataset, timeframe or indicator version invalidates the
preview instead of reusing stale geometry. The future engine should process
closed bars incrementally (O(n) per definition), memoize only immutable prefixes,
and keep preview overlays separate from persisted annotations. Rendering should
batch overlay updates and avoid recomputing unaffected panels; p95 latency and
browser workload remain open acceptance measurements.

## Remaining implementation gates

This receipt does not claim a deterministic indicator engine, frontend overlay
renderer, AI provider, licensed chart library, visual QA, MTF fixture coverage,
or trading performance. The next safe slice is synthetic-bar fixtures for FVG,
confirmed swing/BOS and session boundaries, followed by a renderer preview with
explicit accept/undo. Any provider/OAuth, broker, holdout or live execution work
stays outside this packet.

