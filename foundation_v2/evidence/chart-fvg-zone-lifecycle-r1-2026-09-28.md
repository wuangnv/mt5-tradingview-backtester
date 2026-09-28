# Chart FVG zone lifecycle — R1 (2026-09-28)

Status: **PREP_ONLY / offline deterministic**.

This slice closes the missing lifecycle seam between the canonical ICT fair-value-gap event and the existing SMC/ICT zone renderer/alert adapters. A confirmed `FVG` event is revalidated against its three consecutive closed source bars, gap boundaries, source IDs, scope and configured `min_gap`. It becomes a `FVG` `ZoneSpec` with `confirmed`, `mitigated`, `invalidated` and `expired` lifecycle semantics using the existing fail-closed policy. The zone orchestrator now projects confirmed FVG events automatically, and the renderer adapter emits a validated `fvg` packet while retaining causal metadata.

## Files

- `foundation_v2/trading_workspace_v2/zone_lifecycle.py`
- `foundation_v2/tests/test_zone_lifecycle.py`
- `foundation_v2/tests/test_zone_integration.py`

## Validation

- `$env:PYTHONPATH='.'; uv run pytest -q tests/test_zone_lifecycle.py tests/test_zone_integration.py` — **20 passed**.
- `$env:PYTHONPATH='.'; uv run pytest -q tests/test_chart_intelligence.py tests/test_chart_intelligence_stress.py tests/test_chart_alert_contract.py tests/test_chart_explainability_contract.py tests/test_chart_overlay_contract.py tests/test_chart_renderer_contract.py tests/test_zone_lifecycle.py tests/test_zone_integration.py tests/test_mql_parity.py tests/test_chart_ui_contract.py tests/test_feature_timing_contract.py` — **104 passed**.
- `uv run python -m compileall -q trading_workspace_v2 tests/test_zone_lifecycle.py tests/test_zone_integration.py` — **pass**.
- `git diff --check` — **pass**.
- Ruff was not available in the project environment (`Failed to spawn: ruff`); no source change was made to work around that capability gap.

## Boundaries

This remains a local PREP_ONLY contract. It does not open a provider, network, OAuth, licensed chart runtime, alert delivery, broker, order route, holdout data, or live execution. It is not a profitability or edge claim. Browser/TradingView visual acceptance remains a separate gate.

Commit: `4d6d64b feat(chart): add causal FVG zone lifecycle`
