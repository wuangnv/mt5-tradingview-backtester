# Offline paper-account accounting r1

**Status:** `PREP_ONLY_OFFLINE` — software accounting evidence only. This
receipt does not authorize a broker, provider, network, demo, live, holdout or
real-money action.

## Scope

`trading_workspace_v2.paper_accounting` adds a pure local projection for a
long-only spot paper account. It binds one immutable order intent to adapter or
reconciliation receipts, applies cash/position changes only for explicit
partial/filled observations, and keeps fee and average-cost arithmetic in
`Decimal`. `unknown` observations are journaled without changing cash or
positions. A later `reconciliation` receipt may settle that same unknown
intent. Duplicate receipt IDs are idempotent; a second payload for a terminal
intent is rejected.

The in-memory `FakePaperAdapter` is a test seam only. It returns the same
receipt for duplicate intent IDs and performs no I/O. Account snapshots are
Pydantic JSON round-trippable and include `execution_capability=false`.

## Source and validation

| Item | Value |
|---|---|
| Source parent before this slice | `077b3fb` |
| Module | `trading_workspace_v2/paper_accounting.py` |
| Tests | `tests/test_paper_accounting.py` |
| Focused accounting + risk/execution contract tests | `30 passed` |
| Compile | `uv run python -m compileall -q trading_workspace_v2` — pass |
| Whitespace | `git diff --check` — pass |
| External capabilities | provider/network/broker/OAuth/holdout/execution: `false` |

The project-wide acceptance state remains unchanged. This slice is a building
block for the planned fake adapter, paper ledger and reconciliation harness; it
does not claim paper-running, demo or live promotion.
