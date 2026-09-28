# Offline paper execution bridge r1

**Status:** `PREP_ONLY_OFFLINE` — this slice joins the local paper-account and
execution-intent reducers. It does not authorize a broker, provider, network,
demo, live, holdout or real-money action.

## Scope

`trading_workspace_v2.paper_execution_bridge` binds one immutable
`PaperOrderIntent` to the matching paper-mode `ExecutionIntent` and projects a
single `PaperFillReceipt` into both immutable projections. Paper receipts carry
delta quantities, while execution receipts carry cumulative filled and
remaining quantities; the bridge derives cumulative values from the updated
paper intent record. Receipt fingerprints are carried as event evidence so a
retry is idempotent across both reducers.

Unknown adapter observations move the execution ledger to `unknown` without
changing cash or positions. A reconciliation fill is accepted only when the
paper account has a pending unknown and the execution ledger is unknown. A
reconciliation receipt cannot bypass that uncertainty gate. Live intents,
unsupported cancel/modify paper actions, scope drift, strategy drift, budget
hash drift and time-window drift fail closed.

## Source and validation

| Item | Value |
|---|---|
| Source parent before this slice | `ae0caf3` |
| Implementation commit | paired git commit for this receipt |
| Modules | `trading_workspace_v2/paper_execution_bridge.py`, `trading_workspace_v2/paper_accounting.py` |
| Tests | `tests/test_paper_execution_bridge.py`, `tests/test_paper_accounting.py` |
| Focused bridge/accounting/execution tests | `25 passed` |
| Compile | `uv run python -m compileall -q trading_workspace_v2 tests/test_paper_execution_bridge.py` — pass |
| Whitespace | `git diff --check` — pass |
| External capabilities | provider/network/broker/OAuth/holdout/execution: `false` |

## Known limits

- The result is an immutable in-memory pair; a durable transaction/store still
  has to persist both projections together.
- The bridge supports only long-only spot `open`/`close` paper actions.
- No promotion transition is inferred from a paper receipt, and no paper
  result claims profitability or live readiness.
