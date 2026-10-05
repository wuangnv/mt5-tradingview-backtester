# Dashboard / Sessions — independent review, 2026-10-05

Verdict: **SCOPED_PASS** for this Dashboard/Sessions UI slice. No outstanding blocking finding. Root owns source edits and commit; reviewer performed GET-only local browser/source checks and wrote evidence only.

## Verified behavior and data flow

- Dashboard retains three Backtesting / Prop firm / Tutorials actions. Repeated visible page headings, reload actions, chart footer/provenance, View all and single-page recent-session pagination are absent. Accessible hidden page h1 remains.
- Source pills expose Backtesting, Prop Firm and All. Battles is disabled with an explicit unavailable-source reason. All renders Backtesting and Prop firm separately; its date pill explicitly says Backtesting. It does not merge cash values or manufacture a Battles result.
- Backtesting uses the persisted replay overview read model, unique closed trades and UTC closure-date filters. Actual weekly inclusive seven-day request/count, Lifetime reset and URL reload match API oracle. Training/replay duration remain unknown because the API does not provide them.
- Recent Sessions uses tenant-scoped catalog, lazy per-session analytics metadata, real Assets, Strategy, search, lifecycle and creation/update/profit sorting. Only comparable known currency profits are compared; unknown results remain distinct. Explicit null strategy is unassigned; absent metadata is unknown. Metadata is reused across filter changes and does not briefly claim a false empty list while being reloaded.
- Sessions uses a rich searchable selector and summary/description, three historical charts when closed trades exist, six metrics and Recent Trades. Toolbar Market Data and archive checkbox are gone. Safe keyboard selection was exercised; lifecycle mutations were not invoked.
- Actual no-init session has six unknown metric values, unknown balance and a useful empty-trades state without fabricated chart data. Actual initialized session with zero closed trades preserves measured P/L zero and its starting balance. Actual one-trade XAU session matches its analytics count/P/L and original balance path.

## Runtime evidence

UI `127.0.0.1:5180`, actual GET API `127.0.0.1:8010`, tenant-a. Requests outside the UI origin and non-read methods were blocked by the isolated harness; no such requests occurred. WebSockets were closed. No broker/SDK/import/download/session writes or existing DB mutation.

- 12 main cases: Dashboard and populated Sessions × dark/light × 360/768/1440px. Document horizontal overflow 0; axe WCAG 2A/2AA/2.1AA/2.2AA violations 0 in each case.
- Six source menus also passed axe while open; their bounds fit the clipping content, not merely the viewport. Hover changed the option background; Escape returned to the trigger. Four Recent filter menus fit the mobile content; desktop Recent sort menu fit vertically.
- Final mobile dark/light cases confirm source labels remain on one line and popup fits the content with inset. Selected screenshots were visually inspected, including mobile menu before and after repair, desktop/mobile Sessions, empty Sessions and desktop Recent list.
- Actual inventory: six sessions, one active/five archived. Workspace overview: one closed trade, four readable sessions of six. Actual Prop report list has zero items and `broker_execution_capability=false`; the real empty Prop surface was verified, not populated Prop financial calculations.
- Old session `476f4b498e1a49ed9d48a75719f4d270`: revision 2, full replay payload, dataset hash and 501-row visible prefix unchanged by review/navigation.
- Clearly labeled response fixtures: overview GET500 shows unknown metrics + failure; session analytics GET500 hides results; stale analytics is labeled; missing strategy metadata does not become unassigned; explicit null remains unassigned. These fixtures did not modify the API or database.
- Independent focused model command: `node --test foundation_v2/web/tests/dashboardModel.test.mjs` — 10 pass. Root-owned final receipts report build success and 25 focused tests pass; reviewer inspected these logs and ran `git diff --check` (exit 0).

## Resolved findings and evidence lineage

1. Changing Strategy refetched unrelated metadata and briefly showed a false no-match state. Root changed the dependency to `needsDetails` and added a loading state; actual final strategy behavior passed.
2. Source popup at 360px was inside viewport bounds but clipped against the sidebar by `.fx-content`. Root clamps to content bounds and repositions vertically. Rechecked screenshots and stricter content-bound assertions pass.
3. Root independently found excessive mobile toolbar gap/name squeezing; scoped CSS repair passed the six final Sessions cases.
4. Final mobile pill typography repair keeps Backtesting/Lifetime on one line; both themes verified.

`browser-attempt-2-dom-pass-visual-blocked.json` is retained as a DOM pass that was rejected by visual inspection. Do not treat it as acceptance. `source-menu-light-360-before-clamp.png` records the regression.

`browser-attempt-3-behavior-pass-source-delta.json` / `browser.json` retain all 12 successful layout cases and successful functional/error/empty/stale assertions. The process exited 1 only at its final source-freeze assertion because root made the declared one-line strategy defense during the run. There were no page/API/background/teardown errors. It is not silently relabeled as a complete frozen-source pass.

`final-focused.json` passed on stable final source: actual strategy, labeled missing/null metadata, final mobile typography/clipping and open-menu axe. It rechecked all ten source hashes before/after. The only late files relative to the earlier comprehensive run are DashboardSessions.jsx strategy handling and dashboard.css mobile typography; affected behavior was rerun. Sessions and other unchanged components retain the comprehensive runtime evidence.

Commands:

```powershell
node .artifacts/fx-dashboard-sessions-20261005/independent-review/browser.mjs --source-frozen
node .artifacts/fx-dashboard-sessions-20261005/independent-review/final-focused.mjs
```

## Final source SHA-256

| File under foundation_v2/web/src | SHA-256 |
| --- | --- |
| DashboardSessions.jsx | b3e1f1c26793e43ff3b6704e134b579ea8527adaf87ff0f6084f3b3f50e86ba7 |
| DashboardPerformance.jsx | cefa1dd211db2d45cc711db492302429b77d9c4c70ce5f00fe5fd11ea5d044b8 |
| dashboardModel.js | 6d449eb2c673c4d87a56bd64f0c6ee73d319f509ee804631449fd0ec0e5fa8a7 |
| SessionPicker.jsx | 4a1c4e4e554783efb2aeb7585bd49d1847013c968ea3cc8f9eb0029259b51909 |
| SessionPerformance.jsx | 1aeb3032fd94b47326d0612683e1dea51b1b69f9ac7b35ed9ccb685010a8b1e3 |
| session-performance.css | 8e65913269f2e45dc0bde2152b0465fd493704e0a1ddc8c0c138323793c07348 |
| PropAnalytics.jsx | 714a7a632995cc7fe75c3e1243ff0b915ecfb5fa712bf99a051e15c1951ddca5 |
| FxSelect.jsx | ad5f0aa3b34120c779a1388103efaa36642751f4b9baba7bb0969e37cc361cd4 |
| fx-select.css | 816fba1abdfc2b97cb84259b16874e3231e140cd59c3f3036a2eb66d9d05d041 |
| dashboard.css | 40fff426483a4257834eaaf98e1105fbefb97640c4c8286fe6a2d329aac87859 |

## Limits

Acceptance covers this offline UI slice. Battles is unavailable. Populated Prop challenge financial lifecycle/equity, broker acceptance, native zoom, canonical goldens, long-duration/memory and whole-product acceptance were not established here. Synthetic error/stale/unknown fixtures are separate from actual service evidence.
