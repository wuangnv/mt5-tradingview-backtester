# Chart HTF boundary policy — R1 (2026-09-28)

Status: **PREP_ONLY / offline deterministic**.

The canonical chart MTF mapper now exposes a named `boundary_policy` without changing the existing default:

- `inclusive_closed_boundary`: source close `<=` display close, local closed-bar policy;
- `pine_offset_first_next_bar`: source close `<` display close, matching the common Pine `expression[1]` plus `lookahead_on` placement.

Both policies are causal. The selected policy is carried in `MTFBarMapping.policy`, and an unknown policy fails closed. This keeps chart intelligence and the MQL/Pine parity adapter on one explicit boundary vocabulary.

Validation:

- `PYTHONPATH=. uv run pytest -q tests/test_chart_intelligence.py tests/test_mql_parity.py tests/test_zone_lifecycle.py tests/test_zone_integration.py` — **47 passed**.
- `uv run python -m compileall -q trading_workspace_v2 tests/test_chart_intelligence.py` — pass.
- `git diff --check` — pass.

Commit: `56d657f feat(chart): expose explicit Pine HTF boundary policy`

No provider, network, OAuth, licensed renderer, broker, holdout or execution capability was opened. This is not direct TradingView/MQL terminal acceptance or a profitability claim.
