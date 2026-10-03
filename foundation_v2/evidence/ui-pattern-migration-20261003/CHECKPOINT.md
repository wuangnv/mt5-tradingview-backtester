# WMREPLAY page pattern migration — 03/10/2026

Scoped UI acceptance: the owner approved Dashboard trial `2137918` and explicitly requested research and application to the remaining MT5 pages. This receipt supersedes the instruction to await Dashboard feedback. Whole-product, live broker/provider, canonical golden and controller-ledger acceptance remain separate.

## Result and ownership

Project-only `workspace-pattern.css` defines common typography, page spacing, color roles, focus and form dimensions. Existing route components keep their state and layouts: Sessions/Trades use compact scope and ledger; Analytics emphasizes closed-trade balance; Data/Playbook use catalog/detail; Research keeps context/run/result; Journal uses list/editor with optional decision context; Risk/Trade use grouped inputs; Prop prioritizes selected session/actual phases; Learn uses navigation/reader; Settings groups preferences/actions; Live shows real unavailable/permission state; Replay retains its dominant chart geometry.

Removed redundant introductions, decorative card surfaces and colored rails. Essential simulation, missing/stale/partial, read-only and permission messages remain. Filled primary actions use a darker blue than chart/link accents to retain white-text contrast. Native session selectors replace transparent decorative overlays. Wider Analytics SVG uses a measured pixel viewBox with observer cleanup, keeping trade/time mapping and round markers. No framework, dependency, backend or shared pinned-system change.

Primary research and application decisions: [workspace patterns](../../../ui/workspace-patterns.md). Carbon table/form/progress and TradingView UI element pages were read; failed historical MetaTrader/Carbon URLs are explicitly excluded. Raw public fetch evidence remains in workspace `.artifacts/wm-pattern-migration-20261003/research/`.

## Data/state and trade-offs

Selection, drafts, revisions, filters, URL history/cutoff, CSV, save/cancel and reload keep existing handlers/contracts. Provenance and definitions move into native disclosures; they remain available without dominating the first view. The shared pattern does not force one grid onto forms, lessons and charts. Analytics balance after closed trades is not floating equity. Unknown values remain distinct from zero. Prop phases label current/prior/unopened without invented completion; Learn lesson status uses saved progress and opening content does not complete it.

The actual preview uses existing synthetic session `39b1d068edd64e75864f692f27237852`: 60 closed trades, net75USD, revision123/cursor60; cursor20 gives20trades/net25USD. GET-only adapter rejects mutations. Fixture mutation/ready/error/denied evidence is separately labeled and does not establish backend or broker execution.

## Verification

- `unit-final.txt`:80/80 web tests. `build-final2.txt`: Vite build80modules PASS; pre-existing >500kB chunk advisory remains.
- `route-scan-final2/report.json`:144 actual localhost route/theme/axe/reflow cases at1440/768/390/320, no failures or unexpected writes/external requests. UI source before/after `fe8f7405c4b4d937e637b856e568d01266389e8fb60dd3a093a454215eebeb93`.
- `zoom-final/report.json`:60 native browser zoom cases across10representative routes, both themes,125%/200%/return100%, same stable source. Isolated profile/extension only.
- Final Trade/Risk CSS delta corrected SIM flex shrink, cutoff light contrast in both inherited definitions, Risk outer surfaces and mobile form-before-guide. `risk-trade-final/report.json`:16 route/axe/reflow cases and `risk-zoom-final/report.json`:6 native zoom cases PASS on final UI source `108389e1c4b36c4f9b2e329ff2061fa2823c20ad50934695ed50cc3eff55cc57`. Earlier matrix is combined with these targeted replacements; it is not mislabeled as a full rerun on the newer hash.
- `chart-final2/report.json`:8/8 renderer cases;40type/40wheel-pan/48captures. Mixed OHLC, all five types, crosshair, viewport preservation, Volume/SMA and21row history/reload verified on stable pre-delta source. Final delta changes only Trade/Risk CSS, not Replay/rendering. Independently reviewed selected chart captures; no golden comparison/promotion.
- `shell-final/report.json`:8control/2drawer scenarios PASS, branding/alignment/native selector/keyboard/preferences retained.
- `lane-receipts/session-real.json`:5groups/20screens,60trade/net75, historical20trade/net25, chart detail/reload, pagination/UTCfilter/CSV, labeled stale/partial/503 checks PASS. `session-fixture.json`:11management/state groups PASS.
- `research-real.json`:12real route/theme/width cases; `research-fixture.json`:6intercepted journeys including CSV preview/import-deny, invalid/unknown/failed Research and revision diff/bounded retries PASS.
- `support-journeys.json`:12real/fixture journeys including Learn progress immutability, reader focus, Settings cancel/save/reload/cross-tab and Live locked/error/retry PASS. `support-w6.json`:8journeys and6Learn axe cases PASS. Support lane receipt preserves scope and earlier failure repairs.
- `risk-journal-trade-final.json`:27checks/18populated captures at1440/390/320 both themes, zero axe failures; Journal create/revision conflict/source, Risk cost/missing/blocked/error and Trade side/validation/queue conflict all intercepted. `prop-final2-report.txt`:20Prop lifecycle/report/filter/CSV/denied/conflict/localNotion fixture checks PASS.
- Independent source/visual review: `review/FINAL-VISUAL-REVIEW.md` covers non-support pages, chart and final Trade/Risk delta. Separate support review is retained alongside it. Prepared independent24case browser probe was executed by root after original reviewer token failure (`independent-probe-root-executed.json`); do not claim an independent executor for that run. Visual/source reviews were conducted by agents other than the implementation owner.
- Root reviewed representative captures and final diff; `selected/` retains10small visual checkpoints. Runtime artifacts/screenshots/scripts remain in the named workspace `.artifacts` lanes.

## Failures and limits

Preserved first root scan/chart attempts failed solely because the preview listeners stopped across context transition. Root restored the exact authorized GET-only adapter and Vite without reseeding; successful attempts are distinct. Historical populated Trade light contrast failures remain in `risk-journal-trade-failed.json`; both duplicate CSS definitions required correction. Intermediate interaction7 retained locally. Prop first final harness attempted pointer-mode programmatic focus, so `:focus-visible` was absent; final harness enters keyboard modality and verifies actual visible focus/44px target instead of fixed dark token values. Old decorative text/chevron tests were deliberately adapted; financial/state assertions remain.

This is presentation migration acceptance at recorded UI scope. It is not comprehensive manual WCAG, real Live-feed/provider readiness, long-duration chart performance, complete broker/product acceptance or global design-system publication. Canonical goldens, ledger and generated STATE were not promoted. VI Dubber remains deferred.

Preview restored: UI5180 and GET-only API8020, existing isolated DB `trading_workspace_v2_ui_20261001`; API PID16624/tool43999, Vite tool81170. Liveness should be rechecked on resume; do not infer it from this receipt.
