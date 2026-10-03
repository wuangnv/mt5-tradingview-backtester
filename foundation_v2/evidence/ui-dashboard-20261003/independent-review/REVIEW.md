# Independent Dashboard review — 2026-10-03

Scope: DashboardSessions.jsx, main.jsx, dashboard.css, sessionCatalog.js, SessionPicker.jsx; actual local read-only UI in isolated Chromium contexts. No product edits/commits, no user profile/tab, no API mutations/external requests.

One finding before sign-off: P2 management menu opening near viewport bottom. On initial Dashboard1440/768×900, clicking first row ellipsis opens the popup at top872px/bottom1014px. Rename is partially clipped and Duplicate/Archive below the900px viewport. The enclosing .fx-content can scroll, so actions are recoverable, but newly opened options are not immediately visible. Recommend open above when space below is insufficient or bring the popup fully into view. Evidence menu-edge.json, menu-edge-1440.png, menu-edge-768.png.

All other checks passed in8cases (1440/768/390/320px×dark/light): zero document overflow/clipped actions; recent-session IDs exactly match independent sort/filter of real catalog, at most5rows; empty search and reset; native disclosure keyboard Enter/Escape/focus return; resume URL carries correct session/dataset/Practice and clears stale cursor/cutoff/select; one rename navigation opens existing form and preserves current values without mutation. Screenshots and report.json retained.

Source semantics: GET catalog is abortable and separates loading/error/ready. Resume picks saved eligible session or newest eligible nonarchived dataset-backed item; unavailable/archived sessions expose viewing rather than continuation. Catalog sorting filters into a new array and uses timestamp then stable ID. Dashboard management links prepare the existing session editor/action focus; no effect calls mutate, and existing mutation handler still requires explicit click with expected_revision. Performance remains the existing API scope/metrics with filters folded into native details, automatically open for active filters. Layout uses one meaningful resume surface and flat session rows; no new framework/library/shared UI mutation.

Remaining evidence limits: current real dataset lacks archived sessions; no mock-success claim for empty/error datasets. Root’s focused fixtures/full axe/reflow suite are separate and not duplicated. No production/broker acceptance.

## Follow-up

Menu finding resolved: owner added onToggle nearest-scroll for the open popup. Fresh same1440/768×900 probes now place all three44px action links fully inside viewport (last links end895.34/894.72px); screenshots and menu-edge.json updated, prior measurements retained in menu-edge-before.json.

New route finding pending: results href advertises view=analytics&surface=workspace and clears mode/select, but main.jsx showSessionAnalytics ignores surface and chooses SessionPicker whenever job/job_id absent. Real click loads Analytics nested inside the picker and still has1session-select-card. If direct workspace is intended, destination gate must honor surface=workspace; otherwise wording about direct workspace should be corrected. result-link.mjs caught this explicit oracle, with no blocked mutation request. Primary data/result availability is preserved.

## Final sign-off

Both findings resolved and independently verified. main.jsx now honors surface=workspace before selecting SessionPicker. Fresh real Results click lands directly in AnalyticsWorkspace with0session-select-card, correct session/dataset and absent stale cursor/mode/select; result-link.json is PASS, pre-fix receipt retained. Final CSS contrast probes show CTA white on#245bc4 ratio6.23 in both themes; heading/resume eyebrows ratio5.98–6.92 using semantic content-muted. Stable final screenshots visually confirm hierarchy/readability (contrast-final.json, dashboard-final-dark/light.png). Final diff review and git diff --check pass (line-ending warnings only).

Final verdict: PASS for approved Dashboard behavior/layout/data navigation scope, with no remaining blocker found. Prior findings remain above as audit history, not open issues. Eight responsive/theme cases plus focused real menu-boundary/result-navigation/contrast checks were independently run; owner’s broader fixture and144case axe/reflow suite remain separate acceptance evidence.
