# Workspace header spacing and nested Analytics navigation — 04/10/2026

Owner correction: removing duplicate titles left Dashboard content touching the sub-header;
Sessions/Prop firm belong in a sub-subheader like the supplied FX Replay reference.

- Dashboard starts24px below the sub-header; Sessions/Trades/Analytics retain the same separation.
- ShellSubnav now owns nested Sessions/Prop firm links alongside the main navigation on desktop.
  Below760px they occupy the next header row, outside the scrolling report body, with a2px
  selected underline and existing shell hover/keyboard focus. Obsolete body navigation/CSS is removed.
- Header flex-shrink is disabled so a long loaded report cannot clip its second row. The selected
  primary page scrolls into view when the compact header overflows. Table/chart/filter behavior remains.
- Navigation uses the existing URL helper and preserves session/cursor plus explicit prop_session/
  attempt keys. No calculations, persisted data, experiment configuration or backend endpoints changed.

## Validation

Final UI fingerprint: `cff018bb81aa08d9ad93c48fa72f420ff0820d9a177cabe47292650dfaca2db4`.
Baseline product commit: `a80483a`.

-89frontend unit tests PASS; Vite build PASS91modules, existing chunk-size warning.
- [Final header journeys](final2/report.json):36actual GET-only cases, dark/light ×1440/768/360,
  Dashboard/Sessions/Trades/Analytics Sessions/Prop empty plus source click/reload/keyboard journeys.
  Waits for loaded reports, asserts23–45px separation (actual24px), one active primary page,
  selected source/underline, desktop inline/mobile second row, header containment and pointer hit-test.
  Explicit URL markers test Prop attempt preservation; historical replay returns20closures at cursor20.
  Zero detected axe violations, page errors, page overflow, external calls or writes. Source stable.
- [Native zoom](zoom-final/report.json):12SCOPED_PASS, Dashboard/Analytics both themes at
 125%/200%/100%, frozen source. No full WCAG or cross-engine claim.
- [Independent final review](independent-review.json):8actual dark/light1440/360 cases,
  gap24px, source row containment/hit-test, active primary visibility, hover/focus/underline,
  URL scope preservation; source stable. [Ready Prop captures](independent-ready-prop.json):
 4actual empty-catalog cases. Root inspected ready desktop/mobile images.

## Retained findings and evidence limits

[Independent findings](independent-findings.json) retain two repaired regressions: source links
initially omitted Prop attempt keys from the URL helper's explicit overrides; and mobile header
flex-shrink clipped the source row after report data loaded. Initial screenshot inspection and
[initial geometry receipt](independent-initial.json) are diagnostic, not final acceptance.
[Mid-edit root failure](final/failure.json) correctly rejects source drift; final2 owns the verdict.
The initial loading-only root header report also remains on disk; it did not cover loaded-content clipping.

Actual preview uses persisted synthetic QA, GET-only UI5180/API8020. Prop catalog is empty;
marker journeys verify navigation scope, not a real challenge report. Existing broader Analytics/
financial fixtures are in the preceding checkpoint. No DB migration/reseed, broker/provider/write,
golden/shared-system promotion or ledger/STATE change; whole-product acceptance remains separate.

Resume through `ui/workspace-patterns.md` and the parent Product Plan. Rollback this focused
presentation commit to restore the preceding header; data/backend contracts are unaffected.
