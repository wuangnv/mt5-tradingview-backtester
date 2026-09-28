# Offline paper execution bridge r2

**Status:** `PREP_ONLY_OFFLINE` — this slice hardens the local paper-account
and execution-intent bridge. It does not authorize a broker, provider,
network, demo, live, holdout or real-money action.

## Hardening scope

- Admission remains upstream. The caller evaluates the exact
  `ExecutionIntent` with `AITradeMode` and `RiskBudget` before creating the
  ledger. The bridge preserves `capability_epoch` and the immutable intent but
  deliberately does not re-evaluate or widen execution capability.
- `PaperExecutionProjection` now validates that the returned event is in the
  ledger, the event and receipt fingerprints bind to that ledger, and the
  projection receipt is exactly the event receipt. Unknown events cannot carry
  a receipt.
- Expiry controls **sending**, not settlement of an already in-flight order.
  A receipt observed at or after intent expiry is accepted only after a valid
  `send_started` event before expiry. A prepared intent cannot receive a late
  receipt.

## Source and validation

| Item | Value |
|---|---|
| Previous bridge commit | `81fa9d9` |
| Hardening implementation commit | `4d2d266` |
| Module | `trading_workspace_v2/paper_execution_bridge.py` |
| Tests | `tests/test_paper_execution_bridge.py` |
| Focused accounting/bridge/execution tests | `27 passed` |
| Compile | `uv run python -m compileall -q trading_workspace_v2` — pass |
| Whitespace | `git diff --check` — pass |
| External capabilities | provider/network/broker/OAuth/holdout/execution: `false` |

## Known limits

- The bridge returns immutable in-memory projections; a durable store must
  persist the account and execution projections together.
- The bridge supports only long-only spot `open`/`close` paper actions.
- Promotion state is not inferred from paper receipts. No profitability,
  demo, broker or live-readiness claim is made.
