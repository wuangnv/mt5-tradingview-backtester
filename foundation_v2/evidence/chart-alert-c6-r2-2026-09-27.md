# Chart alert C6 — R2 follow-up (2026-09-27)

## Purpose

This follow-up records the canonical event-kind expansion made by the chart
engine and the alert boundary. It is a traceability receipt, not a new
execution capability.

- Chart event support: `b6d92c3` (`feat(chart): add causal liquidity sweeps and choch`).
- Alert kind support: `666e8da` (`fix(chart): support liquidity sweep alerts`).

The C6 alert contract now accepts the canonical confirmed event kinds used by
the current chart slice, including `CHOCH` and `LIQUIDITY_SWEEP`, alongside
`FVG`, `SWING`, `BOS`, and `SESSION`. The alert tests exercise both new kinds
through the same confirmed-only, rule-filtered, local-advisory receipt path.

## Validation

Focused C6 validation:

```text
$env:PYTHONPATH='.'; uv run pytest -q tests/test_chart_alert_contract.py
14 passed

uv run python -m compileall -q trading_workspace_v2 tests/test_chart_alert_contract.py
PASS

git diff --check
PASS
```

A combined chart suite was also attempted:

```text
$chartTests = Get-ChildItem tests\\test_chart_*.py | ForEach-Object { $_.FullName }; $env:PYTHONPATH='.'; uv run pytest -q @chartTests tests/test_feature_timing_contract.py
84 passed, 3 failed
```

The three failures are in concurrent `test_chart_overlay_contract.py` causal
metadata cases: the current overlay validator rejects
`known_at/source_bar_ids/confirmation_lag_bars` as unsupported fields. This is
outside C6 and is not claimed as a C6 failure or a combined-suite pass.

## Safety boundary and limits

C6 remains `PREP_ONLY` and `offline-advisory`. It emits immutable local
receipts only. It does not run a notification worker, call a provider or
network, connect to a broker, create an order, represent a fill, or authorize
AI trading. Rule/input snapshots, causal cutoff, confirmed-only filtering,
expiry and reconnect/replay dedupe remain mandatory.

No production, edge, live-trading, or M7 acceptance claim is made.
