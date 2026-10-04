# Sessions / Trades / Analytics session scope

04/10/2026. Owner-requested behavior implemented in the existing foundation_v2 UI.
Backend checkpoint: `e65a572`. Final UI source fingerprint:
`45ca4d4cdaa4bd2b96d9baee0989b62b720e08d1753a627785c4bf6109c1eefd`.

## Behavior and data flow

- Sessions respects explicit deep links, otherwise selects a valid remembered replay session, then newest creation among active sessions. Invalid/archived remembered IDs fall back; explicit unavailable IDs do not silently substitute data. Primary Sessions navigation requests this default.
- Primary Trades navigation defaults to all sessions. Searchable checkbox selection supports all, one, multiple, or none; repeated `sessions` URL keys preserve scope on reload. Selecting a report does not overwrite chart resume storage.
- Analytics Sessions uses one Session selector in its filter grid. The old catalog/management toolbar is removed from reports; Prop firm remains a separate source.
- `GET /api/v2/replay/trades` reuses Dashboard closed-fill lineage dedup, retaining independent post-fork attempts. Each row carries original trade ID, selected source/session, origin, currency, starting capital, revision/event/cutoff/hash provenance. Table identity includes session + trade; Journal/Replay links use original identifiers and exact execution event.
- Return money/capital remains per source. No combined account balance or mixed-currency P/L total is inferred. CSV exports precisely filtered rows with each source's currency/provenance. Unreadable sessions remain explicit exclusions.
- Historical single-session drilldowns keep the existing analytics reader; changing session clears old trade/cursor/event scope. Unchanged focus/online GET updates preserve table size/page/columns/detail. Mobile menu stays inside its container; keyboard Escape, Tab, search, checkbox and single selection are available.

## Verification

- Build: Vite94 modules PASS; pre-existing bundle-size warning remains.
- Node95 tests PASS. Python57 focused Dashboard/replay/analytics tests PASS, including multi-session inherited-history dedup, independent fills, currency/capital/provenance, explicit empty/unknown scopes and filters.
- `final/report.json`:27 actual GET-only local browser cases, dark/light at1440/768/360. Defaults, last-run/stale memory, multi selection/menu/reload, Analytics filters, cutoff20, no-selection, invalid ID/timezone/date aliases and separate Prop source; zero page errors.
- `header/report.json`:36 actual header/source-navigation checks, zero violations/page errors/writes. This predates the final Session label/ARIA-only repair; changed surfaces were rechecked below.
- `route-repaired/report.json`:24 actual Dashboard/Sessions/Analytics/Trades × dark/light ×1440/768/360 cases on the final frozen hash. Zero axe violations, unresolved ARIA issues, page errors, external/write requests or document/content overflow. Root inspected loaded desktop Analytics and mobile dropdown screenshots.
- `fixtures/report.json`: labeled mixed-currency fixture verifies two sessions with the same trade ID, USD/EUR row amounts, Return1%/0.5% from distinct capital, scoped tags, Journal/Replay/event links and CSV. Malformed payload blocks rows/export. These are browser fixtures, not real trading history.
- Independent review: original6 responsive journeys, actual background-focus preservation and source/URL/date checks;10 validator cases; final1440/360 label/menu/ARIA review on the final hash. Summaries copied beside this checkpoint as `REVIEW*.json`.
- Actual QA API reads60 synthetic closed trades; all-session scope7 readable/25,18 excluded. Exact historical cursor20 reads20 trades. Unauthorized workspace request returns403. Preview API remains GET/HEAD/OPTIONS-only; no persisted writes, broker/provider/holdout/deploy actions.

## Repairs and limits

Initial timezone/source/date-alias, mobile popover and unchanged-refresh findings were repaired and independently rechecked; raw failed attempts remain in `.artifacts/fx-session-scope-review-20261004/`. `route-final/report.json` preserves the failed ARIA scan: closed menu ID reference and unnamed-role calendar. The repaired scan is separately saved; failures were not overwritten or treated as acceptance.

Actual QA is USD/all winning and the Prop catalog is empty. Mixed-currency/error evidence is labeled fixture evidence. This receipt accepts only these UI flows; it does not close whole-product, manual WCAG, chart performance or broker/data gates. No shared-system/golden/ledger/STATE promotion.

## Resume

Preview UI5180 remains managed session53930. GET-only API8020 restarted as PID11556 / managed session46833, using `.artifacts/mt5-ui-preview-20261003/serve_preview.py` in the parent workspace and isolated `trading_workspace_v2_ui_20261001`. Verify current liveness before reusing these IDs; do not reseed the database or start legacy Flask.

Rerun scripts from `foundation_v2/web`: `tests/sessionScopes.browser.mjs`, `tests/tradeScopesFixtures.browser.mjs`; header/route harnesses accept separate output paths to preserve old attempts. Project scope rules are documented in `ui/workspace-patterns.md`.
