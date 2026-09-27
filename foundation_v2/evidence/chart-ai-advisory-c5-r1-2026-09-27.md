# Chart AI advisory C5 — typed, fail-closed offline slice

Status: **PREP_ONLY**, 27/09/2026. This receipt records a provider-neutral
contract. It does not connect TypeSafe/Jev, a network, a broker, an account or
an execution route.

`ChartAIRequest` accepts an application-owned chart snapshot: server-bound
workspace identity, chart job, method versions, source revisions, visible
slice, replay cutoff, quality warnings and explicit event/bar evidence IDs.
The canonical context hash excludes the retry `request_id`, so retries of the
same snapshot share one cache identity. The request validator rejects forbidden
secret/holdout/future fields, cross-workspace source revisions, non-finite
values, future timestamps and prompt-injection text before any adapter call.

`ChartAIResponse` is a typed advisory result with a closed status set, model and
provider provenance, uncertainty, bounded claim/action, evidence references,
usage and latency. Its `execution_capability` and `write_authority` are literal
`false`; response evidence must be a subset of the request evidence. An `ok`
response without evidence is rejected. A stale context, malformed response,
timeout, unavailable provider or prompt-injection case maps to an explicit
unknown/uncertain/unavailable/invalid-context response and cannot mutate chart
state or reach execution.

`OfflineChartAIAdvisor` is intentionally deterministic and provider-free. Its
valid-request path returns `unavailable` with an `unknown` claim, preserving the
deterministic chart engine as the source of truth while keeping the UI usable.

Validation:

```text
PYTHONPATH=. uv run pytest -q tests/test_chart_ai_contract.py
10 passed

PYTHONPATH=. uv run pytest -q tests/test_chart_ai_contract.py tests/test_chart_intelligence.py tests/test_chart_intelligence_stress.py tests/test_chart_overlay_contract.py tests/test_chart_renderer_contract.py
42 passed

uv run python -m compileall -q trading_workspace_v2
PASS

git diff --check
PASS
```

The tests cover stable context hashing, compatibility aliases, replay-cutoff
future leak, forbidden fields, cross-workspace references, prompt injection,
stale responses, evidence scope, execution-capability escalation, non-success
unknown semantics, timeout/unavailable/unknown mapping and offline fallback.
This is a contract slice; provider calibration, visual/UI acceptance, alerting,
and any broker/live capability remain separate gated work.
