# Compact UI foundations — 09/10/2026

Owner: current WMREPLAY design-system task, under PRODUCT-COMPLETION-PLAN and
WMREPLAY-UI-MASTER-PLAN. This receipt covers presentation foundations; it does
not close whole-product, provider, broker or performance gates.

## Result and data flow

Added opt-in annam-compact@0.1.0 typed tokens in the superproject UI-Systems,
pinned by ui/project-ui.json. The deterministic exporter generates public/
project-palette.css; project role aliases and adapters supply existing controls.
Source SHA256: 6b931fbbccb5edcb69703551493ece5a70585b69cd49b7369aed8b09ffa4697f.
No backend, session state, download contract, timezone conversion, or permissions
changed. Reference controls use component-local state; sample dialog does not
create/delete records. Other products retain their existing pins.

Desktop controls36px, icon targets32px, touch targets44px, field corners8px,
menu/dialog corners12px, hover120ms, menu160ms, dialog220ms, drawer240ms.
Neutral control hover #3D4148 dark/#DDE1E7 light supersedes the rejected blue
fill. Orange primary, blue information/focus/progress, green success and red
destructive/error preserve semantic roles. Separate row/control surfaces prevent
the nested action disappearing into the row hover.

Readable specification: ui/compact-system.md. Interactive catalog:
http://127.0.0.1:5180/?workspace=tenant-a&area=testing&ui_reference=1.

## Validation

Actual local UI5180/API8010 used with GET-only guards. Labeled demo/fixture
scenarios remain separate from actual data; no broker or provider operations.

- `node run_compact_system_acceptance.mjs`:20 cases PASS. Dark/light control
  geometry, hover separation, no layout shift, contrast, keyboard/Escape focus
  restoration, theme-aware hex values, motion timing, reduced motion, reflow
  at360/768/1440px, real Create session focus and Session Settings fields.
  Final assertions include a single composite asset-field focus boundary.
- `TW_SYSTEM_PHASE=after node run_ui_system_audit.mjs`:30 route/dialog records,
  676 measured controls/headings, no page errors;14 routes in each theme.
  Analytics/Trades explicitly use built-in demo data. Inventory is observation,
  not a claim every CSS literal or chart vendor control was normalized.
- `TW_DIALOG_EVIDENCE=../evidence/compact-system-20261009/dialogs node
  run_dialog_controls_acceptance.mjs`:16 cases PASS across seven dialogs,
  themes and mobile mouse/touch. Captures wait for enter animation to finish.
- `TW_PICKER_EVIDENCE=../evidence/compact-system-20261009/picker node
  run_dataset_asset_ui_acceptance.mjs`:10 cases PASS, actual read-only widths
  1710/1440/768/360 plus labeled picker fixtures, empty/error and shared select.
  Fixture POST is intercepted and rejected, never written to actual API.
- `TESTING_QA_OUTPUT=../evidence/compact-system-20261009/smoke node
  tests/testing-standard.browser.mjs`:12 Vietnamese/English route checks and
  two component-reference journeys PASS; no writes. First attempt exposed a
  stale `.fxa-pagination` test selector; now uses the existing pagination test ID
  and verifies actual page1→2 behavior, rather than skipping pagination.
- `npm run build`:PASS. `git diff --check`:PASS.
- Root typed-token/registry/migration tests:9 PASS; registry-check PASS with
  three valid pins. Original productivity snapshot stays byte-compatible. Its
  migration fixture now copies only productivity pins, keeping its migration
  oracle independent of the new compact system's separate snapshot/evidence.

## Independent review and resolved findings

See INDEPENDENT-REVIEW.md and its runtime JSON. Reviewer confirmed initial
findings fixed: Quick Session keyboard focus, Session Settings geometry/focus,
touch-sized catalog choices. Follow-up found composite focus duplication and a
documentation mismatch for narrow mouse input. Removed the inner asset-trigger
outline while retaining the outer focus boundary; documented narrow mouse
tabs28px/X32px, touch44px. Acceptance rerun PASS after the focus fix.

## Limits and trade-offs

Compact desktop geometry remains distinct from accessible touch hit areas.
Rich choices, calendar cells, multiline rows and Settings drawer680px are named
exceptions. Chart/vendor anatomy and candle colors remain separate. Future
component contracts are defaults, not fabricated implementations. No claim of
60fps on every device, full WCAG certification, all workflow acceptance or
full-product completion. Shared version stays candidate; production propagation
is not approved. Rollback: revert the two scoped product/foundation commits;
keep unrelated data, artifacts and other consumers untouched.
