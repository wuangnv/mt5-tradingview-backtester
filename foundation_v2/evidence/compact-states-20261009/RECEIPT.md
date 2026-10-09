# Compact follow-up — 09/10/2026

Scope: owner feedback to selected-row color, switch, checkbox drawing, field
focus and data-state/component contracts. Source pin annam-compact@0.1.1,
SHA256 efbdc8301a23e6c32b93feb461f5126911665db00721a6d2249c8011c3a33c43.
Version0.1.0 remains intact. Current candidate is not a global release.

Selected row uses neutral #1C1C1C/#F0F0F0, with no leading marker. Switch enabled
is blue, success remains green. Native checkbox fields and menu ARIA marks share
16px geometry, tick, mixed mark and120ms timing; original input/ARIA behavior
remains. Fields use one blue boundary, no simultaneous outer ring. Buttons keep
keyboard rings. KPI values use28px, Dashboard report title/axis16/12px.

Catalog adds labeled state/dependency journeys and KPI/card/report chart samples.
Project specification explicitly separates the six availability states from
freshness/refreshing/filtering. Shared dependencies own one status; independent
sources keep local failures. The chart sample needs the same session context,
but its read/calculation can fail separately. It is not a truly independent
source that should disappear when sessions are empty. Contract and inventory
distinguish written defaults from implemented/migrated components.

No Dashboard ownership/API migration in this change. No state/backend/broker or
provider operations. Existing Dashboard source audit is recorded in the project
specification; full chart-renderer/tooltip migrations remain distinct work.

Validation:
- Scoped Compact acceptance22 cases PASS, dark/light theme QA. Includes
  checkbox native/menu matching geometry/tick/timing, mixed visual state,
  keyboard Space, neutral selected/no marker, blue switch and single field/
  select/composite focus; dependency journeys and360/768/1440px reflow.
- Testing smoke12 routes +2 reference journeys PASS in VI/EN, no writes.
- Root token/registry/migration tests9 PASS; old source/snapshot remains intact.
- Build PASS; final diff whitespace check PASS.
- Independent review recorded in INDEPENDENT-REVIEW.md.

Initial test failure showed dynamic quick-session CSS overrode the single-focus
adapter; repaired the owning selector, then reran acceptance. No failing case
was skipped. The native/custom checkbox regression also covers select-all mixed
state; its SessionFilter sibling was corrected instead of hiding the difference.

Actual pages are read-only. Flow and report samples are explicitly illustrative;
their success does not verify Dashboard backend ownership or all report charts.
