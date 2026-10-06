# Session archive / restore / delete — 06/10/2026

Scope: Dashboard Recent Sessions and Sessions, including demo preview. This
receipt accepts this feature locally, not the full product or broker/live gates.

## Behavior and state

- Shared ellipsis menu exposes Archive/Restore and Delete, with neutral hover
  and one popup border. Both surfaces use the same confirmation dialog.
- Archive is reversible metadata; a409 preserves the original target action.
- Delete requires the exact current session name and revision. The receipt
  identifies the deleted record/revision. Failed/denied writes retain the draft;
  uncertain responses refresh the catalog without retrying the mutation.
- Confirmed deletion removes the session from catalog and canonical analytics,
  clears its remembered/URL/Performance scope, and picks another session or
  renders an empty Sessions state. Other selections are retained.
- Database deletion appends an immutable tombstone. It preserves internal audit
  revisions, shared datasets, other branches and independent journal/annotations.
  UI restore cannot revive a deleted session. This is not physical data purging.
- Persisted Prop dependencies deny deletion. Binding writers lock replay before
  Prop to prevent a delete/bind race, including historical branch creation.
- Demo mutations are component-local and never call a mutation API. Reloading
  restores the demo fixture catalog.

## Verification

| Layer | Result |
| --- | --- |
| Disposable PostgreSQL |90 tests and10 subtests passed across deletion, annotation deletion, Prop persistence/lifecycle/Replay binding/reports. Exact revision/name, tenant scope, history preservation and concurrent edit/delete/bind covered. |
| Node |33 focused tests passed for Dashboard model/catalog, session selection/settings/performance and demo data. |
| Build |Vite production build passed; existing large-chunk advisory remains. |
| Browser |`browser.json`: demo archive/restore/delete, final empty state, exact-name gating, keyboard/Escape and actual GET-only cancellation. Dark/light1440/768/360 screenshots. |
| Recovery fixtures |`recovery.json`:11 intercepted mutation journeys covering success, lost response,409, Prop dependency and403 on both pages, plus archive-intent preservation. No mutation reached the actual API. |
| Regression |`regression/report.json`:7 Dashboard/Settings/Summary/date/responsive checks passed. |
| Independent review |`independent/report.json` and reviewer receipt: source review plus scoped demo/actual menu/dialog/focus QA. Initial review findings were repaired before final acceptance. |

Actual tenant-a still contains6 sessions (1 active,5 archived). No real session
was archived, restored or deleted during verification. UI5180/API8010 were
started for this task without launching a terminal or enabling broker execution.

Reproduce from product root with the existing foundation Python environment:

```powershell
foundation_v2/.venv/Scripts/python.exe foundation_v2/evidence/fx-session-actions-20261006/run_backend.py
```

Browser checks run from `foundation_v2/web` against local UI5180/API8010:

```powershell
node tests/sessionActions.browser.mjs
node tests/sessionActionsRecovery.browser.mjs
$env:TW_UI_EVIDENCE_DIR='../evidence/fx-session-actions-20261006/regression'
node tests/dashboardRefinement.browser.mjs
```

Trade-off: audit history remains on disk and Prop-linked sessions require
archiving rather than deletion. No schema migration was needed. The new binding
guard rejects writing a missing/deleted replay dependency earlier than before;
the corresponding regression oracle now checks this earlier rejection.
