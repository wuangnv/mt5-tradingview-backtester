# Session controls refinement — 06 October 2026

Scope: the owner's three control annotations and decision to defer session
archive/restore UI. This is a focused UI checkpoint, not product completion.

## Behavior and ownership

- Shared SessionActions now exposes Delete only. Dashboard keeps its circular
  icon; actual/demo Sessions use the Delete session text pill.
- Destructive controls bind their foreground to the existing negative role so
  neutral default/hover selectors cannot turn them ivory.
- Recent Sessions filter joins the shared 32px desktop/44px mobile icon standard.
  Trades icons and filter pills share a vertical center; mobile may wrap rows.
- Archive/restore dialogs, handlers, menu choices and manage=archive entry point
  are removed from these frontend flows. Backend/storage contracts are untouched.
  Existing archived records remain readable via All/direct links; replay and
  duplication remain unavailable. Prop-linked deletion refusal no longer suggests
  a retired Archive action. EN/VI copy is provided for both states.
- Dashboard card names use the shared text role, and facts use muted text, fixing
  a legacy fixed-color contrast problem discovered during independent review.

Demo mutations update local React state. Actual Delete retains the exact-name and
expected-revision contract, user confirmation, conflict handling and uncertain
result reconciliation. No saved session was deleted or archived during QA.

## Verification

- npm run build: PASS after the final source changes.
- sessionPicker, dashboardSessions, sessionSettingsModel and testingCopy unit
  suites: 17 PASS.
- sessionActions.browser.mjs: 4 journeys PASS, covering desktop/tablet/mobile,
  dark/light, keyboard/cancel, local demo deletion through empty state and actual
  read-only cancellation; zero actual writes.
- sessionActionsRecovery.browser.mjs: 11 cases PASS. Success/lost-response,
  revision conflict, Prop refusal and permission denial use intercepted fixtures;
  no mutation reaches the API. A previously archived fixture remains readable and
  its retired archive deep link is inert.
- Independent source, geometry, hover, screenshot and accessibility review is in
  independent/REVIEW.md with source hashes and explicit rerun history.

Earlier browser harness failures used outdated translated labels/empty-state
copy; those test oracles were corrected. Independent review identified a real
danger-color specificity issue and a legacy card contrast issue; both were fixed
and rerun. Historical failed reports remain local for diagnosis; they are not
claimed as passes.

The running local UI/API remain available. This evidence does not authorize
broker actions, production deployment or deletion of user records.
