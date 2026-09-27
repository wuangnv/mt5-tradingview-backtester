# MQL/Pine time-boundary parity — r1

Status: **PREP_ONLY**, 27/09/2026. This receipt records an offline adapter
boundary and deterministic fixtures. It does not connect MetaTrader, call a
provider, send an order, or claim a trading edge.

The slice adds one canonical boundary for MQL-shaped `MqlRates` rows:

- `CopyRates` physical order is detected and normalized to oldest-first;
- `MqlRates.time` is treated as an explicit bar-open timestamp and converted
  to a UTC bar-close timestamp by the declared timeframe;
- an unmarked/provisional latest row is rejected by default, or explicitly
  dropped with `provisional_policy="drop_last"`; a provisional middle row
  always fails closed;
- `i_bar_shift` mirrors exact MQL semantics: an exact gap is `-1`, while
  nearest mode returns the latest bar at or before the target; output indexing
  can be oldest-first or MQL series order;
- unknown gateway timeframe strings are rejected instead of falling back to
  `PERIOD_CURRENT`;
- non-UTC server wall-clock input requires an IANA timezone and an explicit
  DST-fold policy; nonexistent or ambiguous wall-clock values do not get
  guessed;
- HTF mapping has a named `inclusive_closed_boundary` policy and a separate
  `pine_offset_first_next_bar` strict-boundary policy. Both are causal and
  retain unknown history before the first eligible source close.

The existing gateway still overwrites its newest row with a live bid and does
not emit a `closed` marker. Therefore the production gateway blocker remains
open: this adapter must be used with the safe latest-row policy (or the
gateway must grow an explicit provisional field) before direct MQL ingestion.
This slice does not change the gateway, renderer, TradingView license scope,
provider boundary, or execution authority.

Validation:

```text
PYTHONPATH=. uv run pytest -q tests/test_mql_parity.py tests/test_chart_intelligence.py tests/test_chart_script_parity.py
28 passed
uv run python -m compileall -q trading_workspace_v2 tests/test_mql_parity.py
PASS
git diff --check
PASS
```

Covered fixtures include reversed/ascending CopyRates order, irregular gaps,
exact and nearest `iBarShift`, unknown timeframe rejection, latest provisional
row handling, conflicting state, UTC open-to-close conversion, Berlin DST
fold/gap rejection, inclusive versus Pine strict HTF boundaries, replay
cutoff prefix stability, and no future source exposure.
