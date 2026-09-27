# Chart zone lifecycle integration R1 — 2026-09-27

## Scope

This receipt records the additive offline seam from the causal `chart_intelligence`
detector into OB/OTE lifecycle, renderer, and the existing local advisory alert
contract.  The implementation does not change `run_chart_intelligence`, the
`chart-event-v1` detector schema, or alert matching/deduplication semantics.

## Delivered

- `run_chart_intelligence_with_zones(...)` reuses the canonical chart detector,
  creates an order block only from a confirmed BOS, and accepts OTE only from an
  explicit confirmed leg request. Ambiguous or invalid zones are returned as
  typed `chart-zone-rejection-v1` data instead of being silently dropped.
- `ZoneAnalysisResult.alert_events()` projects only `confirmed` and
  `invalidated` transitions to `chart-event-v1`; `mitigated` and `expired` stay
  renderer/history-only because the current alert contract does not define those
  states. Zone-only fields (`zone_id`, `mode`, `engine`) are stripped.
- `build_zone_overlay_packets(...)` emits validated, causal PREP_ONLY packets
  for the latest active OB/OTE state. Terminal zones are omitted so a stateful
  renderer can reconcile/remove stale rectangles. The OTE renderer indicator is
  registered under ICT as `ote`; it has no provider, broker, order, fill, or live
  execution capability.
- Existing chart overlay and alert contracts remain the validation authorities;
  no new execution path or provider dependency was introduced.

## Verification

Focused command (uses an ephemeral `tzdata` dependency because this Windows
runtime currently lacks it; no lockfile or persistent environment change):

```powershell
$env:PYTHONPATH='foundation_v2'
uv run --project foundation_v2 --with tzdata pytest -q `
  foundation_v2/tests/test_zone_integration.py `
  foundation_v2/tests/test_zone_lifecycle.py `
  foundation_v2/tests/test_chart_overlay_contract.py
```

Result: **28 passed** (5 integration tests, 7 lifecycle tests, and 16 overlay
contract tests).

Compilation and whitespace checks:

```powershell
uv run --project foundation_v2 --with tzdata python -m compileall -q `
  foundation_v2/trading_workspace_v2/zone_lifecycle.py `
  foundation_v2/trading_workspace_v2/chart_overlay_contract.py `
  foundation_v2/tests/test_zone_integration.py `
  foundation_v2/tests/test_chart_overlay_contract.py
git diff --check
```

Both checks passed. Running the same tests without `--with tzdata` remains
environment-blocked by the pre-existing `ZoneInfo('UTC')`/`ZoneInfo('Asia/Ho_Chi_Minh')`
lookup failure; this is not caused by the integration diff.

## Residual

The renderer adapter is a validated packet boundary, not a browser/TradingView
drawing implementation. A future UI lane can consume the packet and reconcile
terminal omissions. Explicit OTE leg selection remains a caller responsibility;
the adapter intentionally does not infer a leg from ambiguous market structure.
