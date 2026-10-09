# Frontend read lifecycle acceptance

- Production candidate: `foundation_v2/.runtime/frontend-candidate-20261009/dist`, entry `index-CKkNq7Fh.js`, stylesheet `index-D6_yJdYW.css`.
- Command: `TW_UI_ORIGIN=http://127.0.0.1:5184 node tests/frontendReadLifecycle.browser.mjs`.
- Own Vite preview port 5184 was stopped after execution.
- Result: 8/8 PASS; no page errors. Receipt contains exact intercepted requests.
- Scope: actual production React components with explicitly synthetic API fixtures. Every `/api/` request intercepted; no user database, provider, broker or external network operations. POSTs limited to mocked replay step and observational activity telemetry.
- Analytics: independent journal error/retry; financial old scope hidden while new filter waits; Back/Forward metrics and mounted reader identity; superseded transport cancellation; focus journal refresh/new annotation tag; background 401 removes financial result.
- Replay: lightweight chart fixture; successful self-mutation URL persistence has no redundant session GET; external historical cursor and Back; cursor navigation during pending command defers until terminal response and preserves the newer navigation. Exactly two mocked step commands.
- Screenshots inspected: `analytics-journal-ready.png`, `replay-pending-navigation-resolved.png`. Last shows two synthetic bars at historical cursor #1 while canonical cursor is #6.
- This checks frontend lifecycle correctness and failure/recovery behavior, not a performance benchmark or real backend integration. Vendor chart first-bars latency is outside this fixture; root owns disposable real-service integration.
