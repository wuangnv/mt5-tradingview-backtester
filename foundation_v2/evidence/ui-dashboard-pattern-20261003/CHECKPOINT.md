# Dashboard pattern trial — 03/10/2026

Accepted at this scope: owner-requested Dashboard-first trial and collapse/expand horizontal alignment. Other page layouts are not migrated. Prior baseline product `a7616e2`; whole product/ledger/golden acceptance is unchanged.

## Result and state flow

Compact scope/actions and continuation row replace the resume hero and entry cards. Four metrics lead into one cumulative closed-trade P/L chart, then three recently updated active sessions. Search/archive/metadata management stay in Sessions; full report and date filtering stay in Analytics. No colored left accent or nested cards. The full collapsed/mobile wordmark and44px menu target remain; header/aside icon centers now differ by at most1CSSpx.

The catalog validates scopes. Explicit `dashboard_session` persists through URL/reload; a missing explicit ID remains unavailable. Otherwise use eligible last-opened preference or latest-updated playable session. Selecting results does not overwrite the last-opened replay preference. Workspace-key remount and aborted requests prevent cross-scope replies; changing sessions clears old numbers. Results reuse existing session Analytics API and `buildAnalyticsModel`, not overview inventory/aggregate P/L. All four metrics refer to the full canonical selected session. Detailed date/cutoff filtering is deliberately delegated to Analytics; old Dashboard date queries do not narrow this clearly labeled full-session result.

Unknown, zero, blocked, partial, stale, loading, error and retry remain distinct. Blocked retained metrics cannot leak into MaxDD. Chart validates starting balance, complete sequential values/count and endpoint agreement with netP/L (bounded1e-7relative tolerance). It depicts balance changes after closing trades, not floating equity/intratrade drawdown. Monetary values retain cents and explicitly show unknown account units. See [pattern decision](../../../ui/dashboard-pattern.md).

## Verification

Final web source SHA256 `05000d3ace00241e97314ea8d3890418f1c3872e2320bae70b0aeb7f6aa13de4`, equal before/after final scan and zoom. Preview UI5180/API8020 stayed read-only against isolated synthetic QA data; no reseed, mutation, provider/broker or external requests.

- `node --test tests/*.test.mjs`:80/80. `npm run build`:79modules; existing chunk-size advisory remains. [unit](unit-final.txt), [build](build-final.txt).
- `tests/dashboardSessions.browser.mjs`: remembered/explicit selection and reload, currency separation, loading clear/late abort, partial/stale/empty/unknown/blocked retained metrics/malformed/error/retry, unavailable selection and catalog recovery; then real synthetic60closed/net75USD/DD0,61chartpoints, replay/reload61candles and Analytics date-filter journey. [report](sessions-final/report.json). Eight responsive/theme snapshots; root inspected desktop dark, mobile light and narrow recent rows.
- `tests/shell-controls.browser.mjs`:8cases, keyboard/preference/theme/help/full branding and explicit icon-center assertions. [report](controls/report.json). Mobile drawer:2scenarios. [report](mobile-drawer/report.json).
- `tests/sessionPicker.browser.mjs`:11synthetic management/regression checks; mutations were intercepted fixtures only. [receipt](management-regression/receipt.json).
- Final integration scan:18routes ×4widths(1440/768/390/320) ×2themes =144/144, zeroaxe violations/overflow/page-errors/unexpected requests; source stable. [report](route-scan-final/report.json).
- Native browser zoom via isolated profile: Dashboard light/dark ×125%/200%/return100% =6/6reflow cases. [report](zoom-final/report.json).
- Independent reviewer:8real responsive/theme cases plus9labeled state/scope probes, PASS after blocked-MaxDD and curve-consistency repairs. [review](INDEPENDENT-REVIEW.md), [real report](independent-report.json), [fixture states](independent-states.json). Original captures remain in workspace `.artifacts/mt5-dashboard-pattern-review-20261003/`.

## Retained attempts and limits

Initial isolated chart wait used an incorrect accessible-name oracle and timed out; read-only diagnostic confirmed actual75USD/60trades. First complete journey reached Analytics but selected a hidden scope `<dd>60</dd>`; harness now targets the visible Trades metric. First route scan used a status notice that is intentionally empty on success, omitted a session for replay/Analytics, and ran while source changed;120cases/diagnosticFAIL retained in `route-scan/`. Correct visible performance selector, explicit QA session and unchanged-source final scan pass. First management command used default5173 (connection refused); correct5180run passed. These are not silently relabeled as product passes.

Tooling doctor reported ready at tooling scope only. No canonical golden promotion, shared UI propagation, DB/ledger/STATE mutation, broker/provider/deploy or whole-product completion. User review of this trial decides whether to adopt the pattern elsewhere. Runtime/preview remains available. Rollback is the coherent product commit back to parent`a7616e2`; no data migration required.
