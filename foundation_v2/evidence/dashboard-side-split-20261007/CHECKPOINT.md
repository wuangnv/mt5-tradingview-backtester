# Dashboard Buy/Sell split and alignment — 07/10/2026

Scope: owner follow-up on missing timing metrics, two-sided trade composition,
remaining-days visual alignment, percentage-only overall win rate and terminology.

## Behavior and data

`build_dashboard_performance` now publishes additive `side_counts` at the same
scope as `metrics.closed_trade_count`. Both are computed after close-date/side/
outcome selection and branch-history deduplication. Valid engine closures use
typed BUY/SELL directions. A genuinely empty scope returns two zeros; a selected
scope with no readable source returns two nulls. Existing metrics/schema remain
unchanged; there is no migration or stored-record write.

The closed-trade card shows green/red Buy/Sell segments and localized percentages
to two decimals. Only nonnegative safe-integer counts summing to a positive
closed-trade total produce a split. Missing/mismatched/empty counts never invent
percentages. Demo derives the same counts from its fixture ledger. Overall win
rate now renders only its label and percentage.

The remaining-days bar is back in normal document flow with its text. The whole
cluster is centered next to the action row, rather than positioning its bar above
the centered text. Existing day/candle calculations, Summary sizing, empty
expansion and chart scroll/grid repair remain intact.

The timing read-model still returns null: there is no persisted active-practice
timer or trustworthy session-start replay timestamp. Creation/update wall-clock
dates include inactive time; cursor × timeframe ignores missing bars and the
actual start position. This task does not fabricate durations or claim timing
tracking implemented. Demo timing remains labeled sample data.

Terminology recommendation is recorded in `ui/testing-standard.md`: use generic
**Mã giao dịch** (compact **Mã**) because symbols include metals and indices as
well as Forex; reserve **Cặp tiền** for Forex-specific contexts. Raw symbols and
English API identifiers stay unchanged.

## Verification and runtime

- Production build and 16 focused web model tests passed.
- 40 backend tests covering the dashboard read model and paged trade API passed.
  The new regression uses real engine BUY/SELL fills, fork deduplication, session/
  direction/date scopes, genuine zero and blocked unknown counts.
- `primary/verify.mjs`: 8 actual/demo × dark/light × 1710/360 browser cases passed.
  API oracle confirms actual total1 = buy0 + sell1, also checked against the
  unpaged trade ledger. Both actual timing fields are null. Screenshots inspected.
- Independent evidence and source-pinned acceptance are in `independent/`.
  Synthetic edge-state fixtures are labeled separately from actual local reads.
  Scoped PASS: 24 actual/demo browser cases across EN/VI, dark/light and
  1710/768/360 widths; 24 synthetic side-count guard cases; four settled-progress
  cases; 16 Axe scans with zero violations. All nine reviewed source fingerprints
  match the final implementation. The actual overview agrees with the trade
  ledger (buy 0, sell 1, total 1). No source findings or blocked checks.

The existing local imported-history API was restarted using its exact same
launcher (`serve_exness_history.py --port 8010`), without MT5 sync arguments,
to expose the new read-model field. UI remains at127.0.0.1:5180. No broker,
provider, migration, data deletion or trading/vendor-chart action occurred.

Previous accepted checkpoint: product commit342dbe8. Whole-product and broker
acceptance are outside this UI/data-summary refinement.
