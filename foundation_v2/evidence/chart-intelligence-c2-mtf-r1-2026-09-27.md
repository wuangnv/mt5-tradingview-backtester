# Chart intelligence C2 — causal last-confirmed MTF slice

Status: **PREP_ONLY**, 27/09/2026. This receipt records an offline mapping
primitive, not a strategy, forecast, alert, or trading permission.

The C2 adapter maps each lower/display bar to the latest higher-timeframe bar
whose **UTC close timestamp is less than or equal to the lower bar close**.
Equality is a valid closed boundary. Before the first source close the mapping
is explicitly unknown (`source_bar: None`), and lower bars after an inclusive
replay cutoff are omitted. The returned record preserves the lower bar, the
source bar for deterministic consumers, and bounded metadata containing the
`higher_closed` policy, source timeframe, source bar ID, and source bar close
timestamp.

The implementation uses a monotonic two-cursor merge over normalized,
strictly-increasing `ChartBar` inputs. It does not bucket by local clock,
assume evenly spaced history, read a future source value, call a provider, or
connect to a broker. UTC epoch close times make DST and mixed-timezone input
boundaries data-driven rather than dependent on local rebucketing.

Validation:

```text
PYTHONPATH=. uv run pytest -q tests/test_chart_intelligence.py tests/test_chart_intelligence_stress.py tests/test_chart_overlay_contract.py tests/test_feature_timing_contract.py
32 passed
uv run python -m compileall -q trading_workspace_v2 tests/test_chart_intelligence.py
PASS
```

The boundary tests cover exact source/display close equality, unknown history
before the first HTF close, future-source lookahead regression, prefix equality
at a replay cutoff, a UTC boundary spanning the London DST transition, and
invalid/non-higher timeframe or source ordering. The existing chart stress
fixtures also pass the malformed-input, overlay-cap, and long-prefix checks.
The slice does not yet wire MTF values into renderer packets or implement
lower-timeframe aggregation; those remain separate follow-up work.
