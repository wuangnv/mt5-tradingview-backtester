# Chart intelligence C1 — causal offline slice

Status: **PREP_ONLY**, 27/09/2026. This receipt records a deterministic
research primitive, not a strategy or a trading recommendation.

The slice consumes normalized OHLC bars whose timestamps are UTC close times.
It emits versioned events for fair-value gaps, confirmed swing points, close
breaks of structure and declared timezone session boundaries. Every event has
deterministic identity, source bar IDs, `known_at`, confirmation lag and a
rule-versioned parameter map. The prefix test compares a truncated input with a
full input stopped at the same cutoff; future bars cannot change the emitted
events.

The output can be adapted to the existing PREP_ONLY overlay packet. The packet
validator still owns cutoff, source, cache identity, preview/commit/undo,
confidence and provider/broker-field rejection. This module does not calculate
risk, request AI, read a holdout or call a broker.

Validation: `21 passed` across C1, overlay-contract and feature-timing tests;
compileall passed. The DST fixture uses `Europe/London` explicitly and converts
local session boundaries to UTC through `zoneinfo`.

Remaining gates are MTF last-confirmed mapping, renderer integration/visual QA,
large-bar/object stress, AI advisory quality and OOS/cost research. No event
has positive-expectancy meaning until the research protocol proves it.
