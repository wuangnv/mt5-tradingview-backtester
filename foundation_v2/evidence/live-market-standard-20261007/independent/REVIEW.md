# Independent review — PASS

2026-10-07. Scope: canonical Testing Market Data and Live Calendar, Trades, Notes, Tag analytics, Analytics, Trading accounts Connect/Transactions. Root owns implementation, checkpoint and commit; reviewer wrote evidence only.

## Result

The Trading UI standard now covers these surfaces: shared palette, controls, locale, filters, tables, pagination, responsive layout and preview dialogs. Calendar follows the supplied P/L-calendar reference with weekly totals, monthly total and analytics side panel. Actual and demo use the same Live renderer. Economic events and replay reports are no longer substituted for Live data.

Final evidence includes:

- 64 route cases: 32 actual local routes and 32 demo routes across all eight surfaces, Vietnamese/English, light/dark and 1440/360 widths.
- 16 Axe scans with zero violations.
- 8 intercepted API-state cases: held loading/release, known net, ready empty, unavailable, locked, malformed payload, incomplete cost, retained stale snapshot followed by denied/cleared data.
- 17 independent model oracles: complete cost net, cashflow separation, UTC/timezone boundaries, entry commission, asset/side/account/date/day filters, unknown/empty distinction, covered/uncovered days and cumulative unknown propagation.
- 8 accepted interaction journeys: Apply/Clear, equal-count filter pagination reset, ticket search, provider/manual/upload previews, Escape focus, Connect/Transactions routing, notes and Market catalog filters/search/paging.
- 404 inline SVG samples with maximum vertical center difference of zero. Larger stacked upload/empty artwork was excluded from the inline alignment oracle.
- 4 focused locale-delta cases for one deal/one product and translated popup close labels in English/Vietnamese.
- 16 targeted layout/regression cases: positive actual/demo Market, natural DataDesk route, Live controls and Testing Trades/Analytics/Sessions at desktop/mobile widths. The final six Market/DataDesk cases ran on r8; ten unaffected Live/Testing cases were retained from r7.
- Zero page errors, writes, external/blocked requests or service restarts.

## Data and decisions

Actual Live reads the existing local GET status endpoint and retains the previous snapshot with a stale notice after a read error. Denied access clears prior account data. Market keeps its existing catalog reader and update/download boundary; reviewer never invoked the mutation or practice actions.

Calendar and analytics use broker BUY/SELL deals. Net requires finite profit, commission, swap and fee; deposits/withdrawals remain separate. Missing cost components keep net unknown. Rows are filled deals, not paired trades. Percent return remains unknown without opening capital. Uncovered calendar days remain unknown rather than asserting zero.

Notes, new trade, upload/import, manual account and provider connection are presentation previews. Dialog copy explains that no changes are saved and no connection is made. Opening/cancelling these previews produced no API writes or external requests. Provider labels do not imply configured integrations.

The reference layout was adapted to the existing vintage palette and flat spacing. Wide broker tables and the calendar retain contained horizontal scrolling on mobile; the page itself has no horizontal overflow. Selected screenshots were visually inspected on desktop/mobile, actual/demo and both themes, including a final English popup after localization repair.

## Findings repaired before acceptance

- Apply received a React click event as a filter override; the owner wrapped the call explicitly.
- Changing to another filter with the same result count retained page two; a stable filter key now resets pagination.
- An unknown calendar day asserted no recorded deals; the owner added unavailable/incomplete coverage copy.
- Escape did not restore the popup opener focus; native dialog cleanup now closes and restores it.
- Named regions nested main/complementary landmarks; scoped page semantics and contextual sections now pass Axe. Canonical Market also has a hidden accessible h1 without repeating the visible subheader.
- The English popup footer lacked a Close translation; the final locale delta verifies it.
- Positive actual Market and natural DataDesk depended on lazy Analytics styles for pager/action layout. Shared Testing now owns its base pager/action styles, and the eagerly imported catalog stylesheet owns the catalog base independently for DataDesk. Positive DataDesk now has a 56px flex pager, a 64px-wide row selector and 40px controls on desktop, rather than a full-width selector on another line. Mobile controls are 44px.

Diagnostic failures remain saved. Reviewer oracle repairs include localized Analytics navigation, distinguishing stacked artwork from inline icons, excluding hidden accessible headings from the visible duplicate-title check, and matching the existing plural Search assets label. Layout oracles also respect component Inter font versus outer shell Nunito, intentional 32px desktop compact controls versus 40px regular controls, hidden controls and pager padding. These oracle failures were not product failures.

The first DataDesk layout cases incorrectly forced `area=testing`, which activated Testing styles. Those two cases were rejected as evidence for natural DataDesk. R8 tests use `view=data` without area/section, confirm `data-ui-area=data`, and supply a labeled positive intercepted catalog. This exposed and then verified the repaired shared-component dependency.

## Version boundary

The accepted full matrix is frozen r5; before/after hashes match for 23 source files. States and accepted journeys use matching r5 source pins. The model pin remains current.

r6 changed only `testing-copy.json`: Close translation and count wording that handles one item. Four focused English/Vietnamese browser cases have matching before/after copy hashes.

r7 changed only `testing-standard.css`: shared base pager/action layout and equivalent selector cleanup. R8 changed only `market-sync.css`: the catalog owns its eager base styles so DataDesk needs no global Testing opt-in. `layout-accepted.json` consolidates ten retained unaffected Live/Testing cases and six final Market/DataDesk cases. Before/after hashes match per run. Finalization confirms only these three source files differ from r5, and records 27 current pins, including four additional layout dependencies. Screenshots from the r8 layout run retain the harness's `r7-` filename prefix; the report and receipt carry the actual version boundary.

The six successful initial Live journeys were retained; only the two Market cases affected by the Search assets oracle were rerun. The initial journey artifact's historical filename includes “source-crossed”, but its recorded `sourceUnchanged` is true and its successful cases match r5. `journeys-accepted.json` consolidates the accepted cases transparently.

## Limits

The actual local account endpoint was unavailable during verification. Positive account/deal calculations and transitions are explicitly synthetic/demo evidence. This is scoped UI/read-route acceptance, not full broker, trading execution, financial accounting or integration acceptance. No market downloads, practice-session creation, provider connection, broker send, persistence mutation or server restart were performed.

Primary artifacts: `final-receipt.json`, `matrix-report.json`, `states-report.json`, `model-oracle.json`, `journeys-accepted.json`, `locale-delta-report.json`, `layout-accepted.json`, `layout-delta-report.json`. Earlier failing/changed-source diagnostics and the superseded r6 receipt are retained and listed in the final receipt.
