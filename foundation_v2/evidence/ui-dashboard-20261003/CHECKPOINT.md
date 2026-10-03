# Dashboard resume-first — 2026-10-03

Owner approved “Tiếp tục luyện tập” after the FXReplay reference/proposal. Implemented in current foundation_v2; prior shell commit97b8a54 is preserved (full WMREPLAY when collapsed, no aside separators).

## Behavior and state

Dashboard starts with a playable last-opened session stored under tw:replay:last:<workspace>, validated against the workspace GET catalog. Invalid/archived/unavailable stored IDs fall back to the newest updated playable session; the label distinguishes opened from updated recency. Loading/error/empty/unknown availability remain explicit. Resume clears stale cursor/cutoff and loads canonical persisted chart state.

Existing Backtesting/Prop/Tutorials routes follow; recent sessions show up to5rows with search/update sort/archive filter. Native ellipsis disclosures expose management links, Escape returns focus, and open menus scroll their options into view. Management entrypoints prepare rename or focus the existing duplicate/archive action; no mutation happens merely from navigation. Existing SessionPicker revision/conflict/uncertain-result handling owns all writes.

Overview keeps the existing metrics/scope/API and partial warnings. Detailed UTC filters, monthly/symbol breakdown, sources and inventory sit behind a disclosure, automatically opened for deep-linked filters. Results opens AnalyticsWorkspace directly using surface=workspace; ordinary Analytics tabs still support session selection. No guessed duration/streak/cross-currency P/L.

## Verification

-79/79web unit tests; Vite78-module build PASS. Existing >500kB bundle advisory remains.
-Overview fixture acceptance: six responsive/theme cases plus URL/filter/drilldown/stale/error/retry/partial/empty/unknown checks. Real isolated PostgreSQL/API Analytics oracle60trades/revision123 PASS (overview-final2).
-Focused sessions browser PASS: valid/invalid/archived/missing/unknown remembered selection, search/sort/no-match, small archived catalog, menus/Escape, loading/error/retry and all four management entrypoints GET-only (sessions-final2).
-Real read-only resume opens QA60 at canonical cursor60 /61allowed candles, survives reload, and Results opens60trade Analytics without SessionPicker. 1440/768/390/320 light/dark screenshots, bottom/detail screenshots inspected; no overflow or page errors. Real overview remains partial7/25 and QA description stays visible.
-Session management regression11checks PASS (session-management-regression), fixture mutations only.
-Final local route/axe/reflow144/144cases SCOPED_PASS, no unexpected writes/external requests; source unchanged: f230586412602430c2bff80b1ea78afc93c629f465123f83d41bafb5b376dfdd. Automated checks do not prove full/manual WCAG.
-Independent reviewer8responsive/theme cases and real menu-boundary/Results/contrast checks PASS (independent-review/REVIEW.md). Root reviewed representative final desktop/tablet/mobile images.

Historical failures retained: initial JSX compile error fixed before build; label-only sort locator timed out while role locator proved accessible combobox; hidden mobile Cursor readout test now checks text plus actual61candle oracle. First144scan found eyebrow/CTA contrast failure; repaired semantic eyebrow color and dark-blue CTA. Independent menu-edge and direct-Results route findings resolved with fresh receipts. No failing receipt was relabeled PASS.

## Boundaries and resume

Source/tests/evidence only; preview API remains GET/HEAD/OPTIONS with writes403. Running UI5180/API8020 and isolated QA PostgreSQL serve synthetic data; no reseed, broker/provider or production deployment. Ledger/STATE and canonical goldens unchanged; this is Dashboard acceptance scope, not full product completion.

Reproduce from foundation_v2/web: node --test tests/*.test.mjs; npm run build; node tests/dashboardSessions.browser.mjs; node run_dashboard_ui_acceptance.mjs with documented env; node tests/wm-integration-quality-browser.mjs --mode=scan --widths=1440,768,390,320 --session=39b1d068edd64e75864f692f27237852 --cursor=20 --out=<fresh-dir>.

Retain unrelated untracked evidence, VI changes and parent ledgerWAL/SHM. Further product/chart/native/manual/production gates stay with their existing owners.
