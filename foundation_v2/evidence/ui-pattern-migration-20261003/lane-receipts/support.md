# Support page pattern slice — 03/10/2026

Scope: Learn, Settings and all five Live surfaces in the existing foundation_v2 React/Vite UI. Owner approved wider adoption of the Dashboard flat pattern; root owns shared tokens, final integration and independent review. No commit or shared-layer edits from this lane.

Changes:
- Learn: compact header, flat course/progress facts, course navigation + focused reader in two columns, glossary below. Current module has a read-only open action; lesson status comes from recorded completed/current IDs. Selecting a resource moves keyboard focus and scroll to the reader, including mobile. Unknown progress remains unknown; no course/progress mutation or answer-key exposure.
- Settings: labeled preference fields with save/cancel together below, aligned read-only service/capability facts. Existing appearance draft/save/cancel/persistence/cross-tab behavior unchanged.
- Live: subsection is the page title; read-only status and unavailable surface precede capability scope. Locked/denied/unavailable/error/loading remain distinct. No fake account/feed/trade/calendar content or execution action.
- Scoped CSS uses root's --wm-* tokens, 44px controls, transparent grouping surfaces, 24–32px spacing and both themes. Root's action token is used for filled buttons; inherited light-theme context-link colors were corrected after measured contrast failure.

Research used: root-saved primary Carbon Form and Progress Indicator guidelines (../wm-pattern-migration-20261003/research/carbon-form.txt and progress.txt). Kept visible field labels/alignment and form footer actions; showed recorded progress without introducing a forced stepper or automatic completion.

Validation:
- node --test tests/live-workspace.test.mjs: 3/3 PASS.
- npm run build: PASS (80 modules; existing chunk-size advisory remains).
- tests/wm-integration-quality-w6.mjs: fixtures-w6-final2/report.json SCOPED_PASS, eight regression journeys including delayed/stale responses, retry, denied/unknown and context roundtrip; six ready Learn axe theme/width cases.
- tests/wm-integration-quality-browser.mjs: real-scan-final/report.json SCOPED_PASS, 28 local read-only route/theme/1440+390px cases, no horizontal overflow or axe violations. Live API returns404, correctly rendered unavailable. This scan preceded final focus/transparent-surface tidy; root final integration must rescan final source.
- support-journeys.mjs: interactions-final2/report.json PASS. Four real Learn journeys at1440/390 both themes open current module, search no-match and verify GET progress snapshots unchanged. Real Settings cancel/save/reload/cross-tab propagation pass in isolated browser context. Seven labeled Live fixtures cover loading/denied/unavailable/locked/ready/error/invalid and retry; broker stays locked even when fixture claims capability. No unexpected API write/external request or page error.
- Visual inspection: real Learn reader at1440/390 both themes; real Settings and Live light/dark captures. Mobile opens and focuses reader rather than requiring scrolling through course map.
- git diff --check for six owned files PASS.

Failed attempts retained: fixtures-w6 and real-scan-attempt1 record light-theme context-link contrast regression (fixed); interactions records a test harness init-script resetting preferences on reload (fixed in harness, no product persistence change).

Limits: scoped UI evidence, not live feed/provider/broker/course/product acceptance. Real Live content is unavailable; readiness only verified as a labeled fixture. No global/domain UI changes or new dependencies.
