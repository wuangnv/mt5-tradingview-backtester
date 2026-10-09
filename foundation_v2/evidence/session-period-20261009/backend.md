# Session period backend acceptance — 2026-10-09

Scope: optional UTC start/end dates for replay creation; no user database, provider, broker or runtime restart used for these tests.

## Contract and behavior

- `POST /api/v2/replay/sessions` accepts optional `start_timestamp` and `end_timestamp` as strict, nonnegative integer UTC seconds. A timestamp start cannot be combined with a nonzero `start_index`; an explicit end must be after an explicit start.
- An explicit date outside the dataset range (single asset) or common native timestamp range (multiple assets) is rejected before persistence. Dates within that range can fall between bars or in market gaps: start resolves to the next available bar, end resolves to the preceding available bar. A period with no future eligible bar is rejected.
- `end_timestamp: null` uses the remaining available range. Omitted/null date fields preserve legacy creation behavior and do not add `session_period` to the payload.
- The selected start/end indices are persisted in `payload.session_period.asset_bounds` and returned as active-asset fields in top-level `session_period`. Original `requested_*` timestamps remain available, including a null auto end.
- Earlier bars remain chart context. Execution, interval/native stepping, future-order checks and branching obey the selected period. Completion prevents subsequent steps/orders; a branch cannot begin before the selected start. Reload and asset switch retain the period.
- Multiasset replay uses closed-bar time for its shared clock. The displayed common `end_timestamp` is a native timestamp cutoff; `end_clock_utc` is the common closed-bar terminal clock, and `asset_end_timestamp` is the active asset's actual terminal native timestamp. For mixed timeframes these values need not be identical. A slow asset can have equal start/end indices while other assets still have future bars. Switching or stepping must never expose/execute bars beyond the per-asset bound.
- When the active asset reaches its last eligible bar before the shared terminal clock, the next step advances the remaining shared clock and processes eligible inactive-asset protection events. It never processes a bar outside the selected period.

## Verification

Commands run from the project root with the project's existing Python environment:

```powershell
.\foundation_v2\.venv\Scripts\python.exe -m pytest foundation_v2/tests/test_replay_session_period.py foundation_v2/tests/test_replay_creation_timing.py foundation_v2/tests/test_replay_portfolio.py foundation_v2/tests/test_replay_protection.py foundation_v2/tests/test_replay_analytics.py foundation_v2/tests/test_replay_intervals.py foundation_v2/tests/test_replay_tick_service.py foundation_v2/tests/test_replay_margin_v2_service.py foundation_v2/tests/test_quick_session_creation.py -q
# 136 passed, 21 subtests passed, 2 existing deprecation warnings; 12.54 s

.\foundation_v2\.venv\Scripts\python.exe -m pytest foundation_v2/tests/test_replay_chart_window.py -q
# 19 passed, 2 existing deprecation warnings; 6.78 s

.\foundation_v2\.venv\Scripts\python.exe foundation_v2/scripts/export_api_command_contracts.py --check
# PASS: 102 frozen domain commands and reference OpenAPI data contracts
```

The new period module contributes 25 passing cases, including strict contract validation, invalid requests writing nothing, ASGI field forwarding, auto/custom end, weekend gaps, mixed M1/M5 clocks, period-bounded SL/TP processing, branches, reload, corrupted bounds and unchanged legacy creation. Actual period fixtures patch full OHLC-history decoding to raise; bounded timestamp/index readers are used instead.

Total backend validation in the two nonoverlapping pytest runs: **155 tests + 21 subtests passed**. The warnings concern existing Starlette/httpx and AnyIO deprecations; no warning suppression or dependency upgrade was made.

The command schema and OpenAPI were regenerated. Only the replay-session create request schema changed; route count remains 102. A small existing quick-create fake fixture was updated to supply the bounded timing method used by replay creation.

## Limits

This receipt verifies disposable test fixtures, not owner data or whole-product production acceptance. Large multiasset creation still performs verified artifact timestamp reads and SHA validation; bounded reads avoid full OHLC decoding but this change makes no new latency/percentage claim. Full frontend/Axum UI acceptance is recorded separately by the parent task.
