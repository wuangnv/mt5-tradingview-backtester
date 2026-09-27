# Chart explainability C4 — offline inspector contract

Status: **PASS / PREP_ONLY**.

The C4 contract builds a typed `chart-explanation-v1` packet for one canonical
`ChartEvent`. It carries the rule version and parameters, exact source bars,
known-at/cutoff timestamps, explicit invalidation state, deterministic manual
recompute values/checks, and required data provenance. Missing source bars,
extra or future references, stale cutoffs, malformed OHLC, rule hash drift,
and unsupported provider/broker fields fail closed. `unknown` invalidation is
serialized explicitly with `unknown_fields`; it is never encoded as a zero.

Validation command:

```text
PYTHONPATH=.; uv run pytest -q tests/test_chart_explainability_contract.py tests/test_chart_intelligence.py tests/test_chart_intelligence_stress.py tests/test_chart_overlay_contract.py tests/test_chart_renderer_contract.py tests/test_chart_ai_contract.py tests/test_feature_timing_contract.py
```

Result: **57 passed**, `compileall` passed. See the JSON receipt for source
hashes and the exact PREP_ONLY scope. No provider, network, broker, order,
renderer SDK, or profitability claim is included.
