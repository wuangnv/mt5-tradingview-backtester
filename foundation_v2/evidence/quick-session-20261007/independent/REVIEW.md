# Independent quick session review — 2026-10-07

PASS: six actual local browser cases (1368×790, 1710×987, 360×844; dark/light), eight isolated UI response fixtures and 24 in-memory creation/branch contract checks. No uncaught page errors or unexpected requests. No product-source edits or commits by reviewer.

## Verified

- Dashboard Backtesting action opens the quick-create dialog with focus on Name. Name/positive balance/downloaded dataset are required. Native New Chart and reusable layout selection are unavailable; Legacy Chart remains selected. Form scrolls inside the dialog and footer stays accessible at mobile width. Escape closes and restores dashboard opener focus.
- Strategy and asset use the existing searchable FxSelect. No-result search works; Escape closes the popup before the outer dialog. Asset options are clickable. Final popup bounds stay inside the scroll body and viewport in all six cases; mobile bounds are x21–339 and y351–755 (dark), y455–755 (light), inside body y86–765.
- Advanced mode exposes description and start index; negative index disables Create, index17 enables it. Prop tab links the existing testing/Prop setup without creating a replay record.
- Screenshots verify final neutral tab grouping, rounded controls, peach Create/selected Legacy action, currency prefix grouping and mobile layout. Earlier global button overrides and popup clipping were reported and fixed by implementation owner. Duplicate declaration introduced during popup repair was reported and fixed; final source loads correctly.
- Isolated fixtures: empty dataset catalog blocks creation; catalog503 shows retry; strategy503 permits unassigned creation;422 keeps form editable;500 and malformed201 mark uncertainty and block retry; delayed201 keeps close disabled/pending and sends one POST. No backend mutation reaches either server.
- Successful fixture POST contains exact name, downloaded dataset id, decimal capital25000.75, Legacy engine, start17, description, playbook id/revision3, plus tenant-a header. Navigation reaches replay workspace, same dataset/cursor17 and no stale fresh flag. No additional create or metadata PATCH occurs.
- NonUSD fixture: manifestEUR updates balance label/prefix, persisted currency displays footer25.000,75€ and settings25.000,75EUR. Simulator draft seeds25000.75 before initialization. No simulator/order request is submitted.
- In-memory backend checks show one atomic create_record with configuration and no execution until later initialization. Currency comes from manifest account_ccy. Existing dataset-only create remains compatible. API rejects blank/overlong name/description, nonfinite/nonpositive capital, unknown engine, unpaired strategy/revision, boolean revision and unknown fields. Service rejects missing dataset/revision, deleted strategy, negative/out-of-range index and long description before writing. Branch preserves name, description, starting balance/currency, strategy id/revision and chart engine with new parent/cursor/timing.

## Source and scope review

ReplayCreate forbids unknown fields and validates finite decimal capital, Legacy-only engine and paired strategy revision. API forwards the typed draft to ReplayService, which resolves local dataset and tenant-scoped exact strategy revision before one record creation. Frontend uses a synchronous submit ref lock in addition to pending state, and blocks uncertain creation retries. The metadata helper and existing session navigation are reused. Saved capital feeds the order hook and preinitialization footer; later simulator cost/execution contracts stay separate.

Response shape validation remains deliberately minimal (record id, payload dataset, integer revision). Durable backend fixture tests establish current saved fields; this receipt does not claim robust verification of every response field from an arbitrary incompatible server. Native New Chart, shared layout templates and full FX feature identity remain unavailable by design. Prop tab is a link to existing setup, not a new Prop creation flow.

## Evidence and safety

- UI runner/result: `quick-session-review.mjs` / `.json`.
- Contract runner/result: `creation-contract-review.py` / `.json` (24 passing cases, no Postgres/artifact writes).
- Visuals: `quick-session-{dark,light}-{1368,1710,360}.png`, corresponding `quick-session-advanced-*`, and `quick-session-created-fixture.png`.

Browser uses isolated Playwright contexts; only local5180/8010 GET/HEAD/OPTIONS reach servers. Creation POST is intercepted only in explicit fixture contexts; activity POST is fulfilled in memory; WebSockets are closed. Fake replay reads after success use isolated response data. No actual creation, metadata, activity, simulator, order, broker or external FX writes. Reviewer closes only launched contexts/browser. This is scoped UI/contract evidence, not live backend persistence or whole-product acceptance.

## Final source SHA-256

| File (relative to foundation_v2) | SHA-256 |
|---|---|
| web/src/QuickSessionDialog.jsx | e7912df0f1549c089699ff9afd951dc6e4ecea9d109344cef2f24fbfb26f8391 |
| web/src/quick-session.css | c4ed40d24a3b4f334c0f6b03ae9d1d776f70ceeedf91de7492875d7694849728 |
| web/src/DashboardSessions.jsx | 6fd251f4c1db195c478b5a51db2db0e7665624a2ffdbf6035d39c626449f6aa8 |
| web/src/sessionCatalog.js | b4a1f3f13e0ad8ead99cd0f756349470d7b94195cf9ea3e5ab918e7d47c409d3 |
| web/src/ChartOrderPanel.jsx | 35b5808909cf3dcc7b5ebfb0c4eba16735555d4c713900751c9ff7d9ca957cef |
| web/src/LegacyTradingBar.jsx | fea902d0dab9c295ea089109f7303410631deac73889c0e8e9ab3f0e8248e573 |
| web/src/sessionSettingsModel.js | 791536fb614b31cc770c71abf3757e278a2f13f5080caa82cf0a72e69851d6c4 |
| web/src/FxSelect.jsx | 1fde73973df41412d53cf8e44431c58803d0a46bc911f482c6eab93526fdb231 |
| web/src/testing-copy.json | 8c7689df146c1a233cbcc13a28ded2dbadebb28bb2af25738c87f94996df73a0 |
| trading_workspace_v2/contracts.py | dbbe6fbee493e07abe52c41a7ae87b5ad3e232fa51173404b857f6a21e351661 |
| trading_workspace_v2/api.py | 226d50bb07e4e1b10460d627bb781864f731fa138c0c40ab3c96133b4726a741 |
| trading_workspace_v2/replay.py | e730a054f56c26a6f921b1ba4f8eb2cf5cef1481cf30b9aefbe7fc18555f082e |
