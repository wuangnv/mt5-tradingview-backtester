# Independent review — immutable tick history and opt-in tick execution

Reviewed at 2026-10-05T07:05:56.955636+00:00 by `/root/fx_analytics_review`.

**Scoped PASS; FULL_PRODUCT_NOT_COMPLETE.** No unresolved blocker remains in this assigned tick-storage/execution/UI slice. Root owns integration, imports, session mutations and commit. This receipt does not change a plan/ledger or grant broker authority.

## Behavior and data flow

Broker ticks are stored in immutable workspace-scoped day partitions with checksums and stable same-millisecond sequence. Snapshots preserve prior captures while latest pointers advance. Requested intervals remain broker-returned, unverified coverage; empty days are explicitly unavailable. Tick execution pins a snapshot to a replay dataset, consumes ordered Bid/Ask within closed minutes, uses Ask for BUY entry/Bid for SELL entry and the opposite closeable side for exits. Missing/empty tick windows fail without an OHLC execution fallback or partial multistep state commit. Existing OHLC sessions retain their semantics.

Both Trade draft and native-chart Order panel use the shared scoped tick-options hook. The UI auto-selects tick when current-minute data is available, supports explicit OHLC opt-out, requires a selected immutable tick snapshot and leverage assumption, and uses observed broker quotes for entry/protection. Session/workspace switches reset the mode and stale options cannot initialize another session. Prop exposes a distinct tick engine and states that intraminute equity-limit evaluation remains incomplete.

## Independent verification

| Evidence | Verified result |
| --- | --- |
| `offline-tests.txt` | 42 tests + 12 subtests PASS using actual tick store/execution/service modules with temporary immutable M1/tick artifacts, in-memory store and generated offline fixtures. No SDK or real DB calls. |
| `market-sync-tests.txt` | 13 focused unit tests PASS, including daily closed-day catch-up after downtime, persisted failure debt/restart, once-per-day behavior and disconnected/stop guards with mocked collectors. |
| `service-final-tests.txt` | Final 16 service tests PASS after missing-store fail-closed hardening. No selected-tick request silently initializes OHLC when tick storage is unavailable. |
| `quote-probes.json` | Six labeled synthetic model probes PASS: exact broker quotes independent of OHLC, missing quote denial, historical cursor isolation, BUY/SELL entry side and pending BUY/SELL protection side. |
| `prop-probe.json` | Four generated tick→actual Prop adapter probes PASS: exposed-position equity rule becomes `insufficient`; balance-only and flat cases preserve the declared-model quality. |
| `browser.json` | Actual GET-only UI5180/API8010 catalog/options/Data Desk/Trade/Prop/native-chart form journeys PASS. No external/write requests, page errors, session changes or SDK access. Synthetic renderer fixtures are explicitly labeled. |
| Responsive and a11y | 30 cases at 360/768/1440px and dark/light: zero document overflow and zero axe violations after theme transitions settle. This includes six actual native-chart order-panel cases. Native vendor iframe a11y was excluded; panel context is recorded in the JSON. |
| Visual inspection | Inspected actual Data Desk mobile/light, actual Trade dark/1440, actual native-chart tick initialization light/360 and labeled unavailable tick fixture. Controls, units, tick scope and unavailable status are readable; no clipping found in the reviewed panel content. |

Actual catalog reported 356 symbols, tick daily sync enabled and no tick-sync error. EURUSDm contains 2,464,842 ticks with 13 broker-empty requested days; XAUUSDm contains 19,014,116 ticks with 14 broker-empty requested days. Both retain `quality=review`; these counts do not certify complete historical coverage.

Actual uninitialized review session `a11f6ccb63b3499a9a0e36d43c271912` remained unchanged at revision 2. The prior OHLC session `476f4b498e1a49ed9d48a75719f4d270` retained revision 2, its payload/dataset hash and 501-row visible prefix. Tick-options access returned actual workspace403 and missing-session404, with execution capability false.

The labeled execution renderer fixture deliberately used OHLC close 1.3 and broker Bid/Ask 1.1020/1.1025. BUY showed 1.1025 and SELL showed 1.1020. The unavailable renderer fixture disabled tick selection and displayed the explicit OHLC spread option. No renderer fixture was saved as actual broker data.

## Findings resolved during review

- Explicit tick mode could survive a scope change and lose its snapshot, allowing an OHLC initialization request while the UI still appeared tick-selected. Mode reset, scoped options and selected-tick availability/snapshot checks now fail closed.
- Pending tick-protection reference initially used OHLC close. The shared model now uses the observed closeable quote for the pending side, matching backend tick validation.
- Root connected the separate native-chart Order path to the same tick-options/pin/leverage checks; actual read-only panel controls were verified after this integration.
- Missing tick storage now produces a controlled ValueError rather than AttributeError; final 16 service tests cover this after-browser delta.

Initial harness errors (APIResponse status method, expected403 vs404, uppercase label matching and Side button locator) were corrected in the harness. The transient light-theme contrast observation occurred during CSS animation; waiting for actual animation completion produced stable axe0. The long review-directory pytest fixture path hit Windows path-length limits; the retained failure log is separate, and rerun in an owned short temporary directory passed without system configuration changes.

## Acceptance limits

- Reviewer actions were product-source read-only, loopback GET-only and temporary synthetic/offline QA. No imports/backfills, session creation/init/queue/step, existing DB/session mutation, terminal/account access, broker execution, dependency installation, server restart, commit or vendor edits were performed by this reviewer. Root's actual fill oracle and mutation journey are separate receipts, not independently claimed here.
- Tick quality/coverage remains unverified where the broker returns sparse/empty history. Bid/Ask improves causal fill ordering; it does not certify historical commission, financing, slippage, account FX conversion or specification changes.
- Tick marks do not evaluate every equity excursion for Prop. Equity-dependent rules with exposure are intentionally downgraded to insufficient; this receipt does not claim full Prop tick risk acceptance.
- Responsive screenshots/a11y cover application components and the native order panel; they do not certify vendor-chart WCAG compliance, the full chart toolkit, full-product performance or long-duration operation.
- No paid/external provider, holdout, production, deploy or live-order gate was opened. This is a local scoped tick feature receipt only.

## Source fingerprints

`browser.json` preserves the exact 17 source hashes unchanged across the browser run. After that run, only `replay.py` changed for the announced missing-store guard; that delta was source-reviewed and verified by `service-final-tests.txt`. `final-fingerprints.json` preserves the current source hashes and names the one post-browser delta. No frontend source changed after the accepted browser run.

| File | Current SHA256 |
| --- | --- |
| `foundation_v2/scripts/mt5_read_worker.py` | `e48924a10a7a58639ee6c8a8a7cdbe2f98a65b73d1485cd124081952ce4e7e92` |
| `foundation_v2/trading_workspace_v2/tick_history.py` | `45e03d896d12414fdc5821f6d48673aee507f5db5b7751ddbd0a6ca4f3a234b7` |
| `foundation_v2/trading_workspace_v2/replay_tick_execution.py` | `7e4ccf64953b42f73de92a3c137d480a720228d6388fda850d0ea424c3ea1b66` |
| `foundation_v2/trading_workspace_v2/market_sync.py` | `7ea3043842308df7771fbd2fa816e98931d7b7207383501c28697649716d8170` |
| `foundation_v2/trading_workspace_v2/replay.py` | `68648e9e0cacec913068eadfdcc2a29ee9918152de2cc6d369c0ec51ab4d1edc` |
| `foundation_v2/trading_workspace_v2/replay_execution.py` | `bad3fff7b3513bb75ed323e9206e001ec36b3823fb341009a67709bd6c109eb8` |
| `foundation_v2/trading_workspace_v2/replay_analytics.py` | `6295d299673a0cd68de68689e45fb24174dfcf7e74da8a7a8e7e898a514279a1` |
| `foundation_v2/trading_workspace_v2/prop_replay.py` | `633caddba59396d7c7160e5f1e2701810fec5a7293d295563bbd56d877a025d9` |
| `foundation_v2/trading_workspace_v2/api.py` | `101b925fc91e3619262f8ce1d8b2427f48d4161481428ec94631376bd9ac244a` |
| `foundation_v2/web/src/MarketAssetCatalog.jsx` | `046f99cdba6701e083cc8db375f2c868ea3767081a890f613bc2547dbc8eb938` |
| `foundation_v2/web/src/TradeWorkspace.jsx` | `7e75e8bc1e9655bcdb44798dceabb170ddaade1bdc390e042e70bda0ab5611b9` |
| `foundation_v2/web/src/replayOrderModel.js` | `6c06d52b0a3a511c69b817d3d05112edcb917bc4c470a5f90f65065a0812570a` |
| `foundation_v2/web/src/ReplayWorkspace.jsx` | `9700dd7cd58a2a0d3e70a08dd8ad7738c5372c97719c9d1a4237d3f02a0e39ac` |
| `foundation_v2/web/src/ChartOrderPanel.jsx` | `3b07abcc75a28c69ea0e5d48f142fd65330817470f40c2d8f4ee41875d73f24a` |
| `foundation_v2/web/src/useReplayTickOptions.js` | `bfb631ed8d6c3d8698651d75db0a9c1005bcda0aeea29cae42a1fa64200167e6` |
| `foundation_v2/web/src/TradeWorkspace.css` | `756dbff364135200b1a69936e254f6442ab8ea7a4da97c9a401d76249ff4e6b5` |
| `foundation_v2/web/src/PropWorkspace.jsx` | `a6cc5bad1c16d1cd535b26a3b543364285c55e8f6672bfcf185fee54b61b3e07` |
