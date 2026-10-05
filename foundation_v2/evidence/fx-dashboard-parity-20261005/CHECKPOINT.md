# Dashboard filter content and Recent Sessions — 05/10/2026

Scope: owner request to restore prior select contents, remove overlapping popup search borders, use checkmarks without persistent selected backgrounds, and complete Recent Sessions from the supplied FX reference.

Demo Dashboard now renders the same DashboardSessions component as actual Dashboard. Source options remain Backtesting, Battles (disabled: unavailable), Prop Firm and All; period options remain Last week, Last month, Lifetime and custom range. Recent retains searchable Assets/Strategy, lifecycle state and creation/update/profit sorting. No session names replace the source filter. All keeps Backtesting and Prop results separate.

Recent cards reuse validated session analytics and SessionPerformance for three expandable closed-trade charts and Summary. Inline actions support rename/description, archive/restore, Analytics and branch copy. Real changes use existing workspace-scoped expected_revision contracts; branch retains cursor_index. Conflicts refresh the catalog and preserve the draft before an explicit retry. No blind automatic mutation retries.

Demo edits/copies/archive live only in React state and reset on reload/navigation; no session writes or broker calls. Demo Analytics links identify the fixture session, and leaving demo removes that demo-only selection. Actual card balance uses closed-trade balance; dates come from the dataset and progress from catalog cursor/row_count. Missing analytics, balance, strategy or progress remains unknown, not a fabricated zero. API overview and session analytics remain separate from demo fixtures.

Selected options retain their checkmark without a persistent background; pointer hover stays neutral white/gray and keyboard focus remains visible. Popup search uses one bottom divider/focus treatment. Dialogs wrap Tab/ShiftTab, restore opener focus and allow Escape after a dropdown closes. Scrollable monthly charts are keyboard accessible. No new dependency or shared-system change.

Validation:

- Production build PASS, 117 modules. Existing bundle-size warning remains.
- 29 focused Node tests PASS: dashboard, catalog, historical performance, session navigation, revision contracts and demo data isolation.
- Root lifecycle browser journey PASS: demo rename/copy/archive/restore, Summary, three charts, unique SVG gradients and session-specific Analytics; widths 1671/768/360x600. Actual services GET-only; zero page errors or write attempts.
- Root synthetic browser API fixture PASS: rename revision conflict, refreshed revision retry, branch cursor and archive payload. Requests were intercepted before reaching the actual service; actual catalog compared unchanged. This is wiring evidence, not real database mutation acceptance.
- Independent review SCOPED_PASS: 26 checks (15 controls, 7 lifecycle/data, 4 modal accessibility), 19 frozen source hashes, zero runtime errors/write attempts. Demo/real dark/light at 1440/768/360 pass overflow/menu bounds; Summary/edit pass axe in both themes at desktop/mobile. Reports are in independent-review/. Runtime UI5180/API8010, tenant-a. No terminal restart, history download or broker order.

During resume, Vite had cached the older demoFixtures module despite changed disk source. Refreshing file timestamps invalidated that cache; HTTP source and browser then reflected the candidate. Earlier failed attempts are retained rather than relabeled.

Root harnesses run from product root:

```powershell
node foundation_v2/evidence/fx-dashboard-parity-20261005/root/lifecycle.mjs
node foundation_v2/evidence/fx-dashboard-parity-20261005/root/mutations-fixture.mjs
```

Reports/screenshots are written to .artifacts/fx-dashboard-parity-20261005/root. For original independent harnesses, copy independent-review/ to .artifacts/fx-dashboard-parity-20261005/independent-review/ and run the commands in its receipt. API/backend state is not reset by QA.

Limits: Battles unavailable; no real session write/broker execution, whole-product acceptance, populated real Prop lifecycle or performance promotion is claimed by this UI slice.
