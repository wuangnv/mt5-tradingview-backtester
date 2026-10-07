# Dashboard quick session — 07/10/2026

Scope: owner-requested FX-style creation dialog from Dashboard, using the current
TradingView Advanced Charts engine as Legacy Chart. No external FX data modified.

## Delivered behavior

- Centered native modal, fixed header/footer, body scroll, backtest/Prop tabs,
  name, balance, strategy, one local dataset, chart layout availability and engine.
- Advanced mode preserves the draft and adds description/start cursor.
- Atomic replay creation persists all configuration. Validation rejects unavailable
  engine, invalid capital/start, missing/deleted/cross-tenant strategy revision.
- Branches retain configuration; chart respects the persisted engine. Saved
  capital/currency seed simulator setup and show in footer/shared settings.
- Pending prevents duplicate submission/closure; uncertain response blocks retry
  until checking sessions. Success remembers the session and opens its replay.
- Popup fits the modal scroll body, including mobile. Native focus starts at name,
  Escape closes child popup first, dialog focus is trapped and opener restored.

## Verification and evidence boundaries

- `foundation_v2/.venv/Scripts/python.exe -m pytest tests/test_quick_session_creation.py tests/test_replay_session_catalog.py tests/test_replay_execution_core.py -q`
  from foundation_v2: **19 tests + 21 subtests passed**.
- `node --test tests/sessionSettingsModel.test.mjs` from web: **2 passed**.
- `npm run build`: passed.
- Independent review: real local dataset/strategy reads, dark/light at
  360/1368/1710 widths, successful creation/navigation and error/empty fixtures.
  See `independent/quick-session-review.json` and `independent/REVIEW.md`.
  Creation/activity requests in browser QA are intercepted fixtures; no test
  session was written into the owner's database. Contract tests use memory stores.
- Real API8010 restarted using only `scripts/serve_exness_history.py --port 8010`.
  OpenAPI includes the new fields; application startup completed. No MT5 sync flags.
- Owner's IAB Dashboard opened the actual modal and verified name focus;
  screenshot `quick-session-owner.png`, tab left open for review.

## Limits / decisions

One asset/dataset per replay, matching existing causal replay contracts. New Chart
and shareable layout templates are not implemented. Prop Firm uses its existing
setup route. Creation stores starting capital; the existing simulator initialization
still sets instrument/cost/tick choices before any simulated order. This receipt
does not close broader product, native zoom or broker acceptance gates.

Rollback: revert this scoped feature commit; old dataset-only create requests
remain compatible. Existing sessions without engine metadata retain URL fallback.
