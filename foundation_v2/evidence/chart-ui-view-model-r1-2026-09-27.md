# Chart UI view-model — R1 (2026-09-27)

This receipt covers the offline `chart-ui-state-v1` projection used by the
chart shell and its inspector panels. It is a view-model seam, not a browser
or chart-SDK integration.

## Scope

- one renderer source/cutoff/indicator scope with renderer generation;
- explicit renderer objects, operations, stale cleanup and bounded stats;
- AI advisory bound to its validated request context and cutoff;
- explainability bound to its source provenance and cutoff;
- local-advisory alerts bound to rule/input snapshots, ledger and receipts;
- explicit `unavailable`, `unknown`, `stale`, `empty` and advisory statuses;
- `broker_execution`, `external_alert_delivery` and annotation write authority
  remain false.

The adapter validates canonical packets before projection. It does not compute
SMC/ICT events, invoke a provider, call a network, create chart objects, send
alerts, or submit orders.

## Validation

```text
PYTHONPATH=. uv run pytest -q tests/test_chart_ui_contract.py
4 passed

uv run python -m compileall -q trading_workspace_v2/chart_ui_contract.py tests/test_chart_ui_contract.py
PASS

git diff --check
PASS
```

`ruff` was not available in the bundled environment, so lint was not claimed.
The combined chart suite remains subject to unrelated active `chart_intelligence`
WIP; this receipt claims only the focused contract tests above.

## Acceptance

`PREP_ONLY`. Browser visual QA, TradingView/MQL5 adapters, external delivery,
provider quality, broker execution and strategy profitability remain open.
