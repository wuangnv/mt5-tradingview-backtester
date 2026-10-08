# Independent interaction review — 08/10/2026

Scope: project hover/border role consistency, concentrated on Practice Library,
Dashboard and Trades plus shared selects/secondary controls. Actual services were
read with GET only. Saved dataset cases use explicit response fixtures; Dashboard
and Trades use the application's labeled demo. External origins, WebSockets and
all mutations were blocked. Actual paused EUR/USD job was inspected without
resuming, pausing, cancelling or modifying it.

Final result: PASS, all 7 matrix cases in `results.json`; no page errors or writes.
Dark/light at 1710, 768 and 360px use fixtures; actual local catalog/job is dark
1710px. `actual-results.json` records an additional actual-only verification.

Run from the product root:

```powershell
node foundation_v2/evidence/interaction-states-20261008/independent/qa.mjs
```

Verified behavior:

- Download and ellipsis are transparent at rest. Hover differs from table row
  hover, keeps transparent 1px borders and does not shift control width/height.
- Ellipsis is a 32px desktop / 44px mobile circle; open state persists and Escape
  restores keyboard focus. Keyboard outline remains explicit.
- Library behavior remains correct after loading Analytics, Sessions, Journal,
  Playbook, Trade and Risk lazy CSS chunks in the same page.
- Actual paused progress acquires its own hover surface. Resume/cancel remain
  untouched. The counter/progress does not imply a saved complete dataset.
- Unknown Update remains disabled. Delete confirmation remains filled red with
  white text in both themes, including hover. Enabled Dashboard Delete icons have
  the same semantic foreground/background; disabled confirmation cannot submit.
- Catalog text action remains transparent with underline; shared secondary and
  select control hover preserve size/border geometry; select open/escape works.
- Search keyboard focus visibly strengthens the border in both themes after the
  140ms transition; it does not need a duplicate outline for the existing field
  contract.
- Demo Dashboard nested icon hover remains separate from header hover. Demo
  Trades detail hover remains separate from row hover, and selected pager state
  remains visible. Narrow tables scroll locally without document overflow.

Independent findings resolved during review: ghost-base selector specificity was
too weak against generic button roles; progress-hover selector was too weak
against its own resting selector; a proposed selected left rail contradicted the
flat-first contract and was reverted. Shared row selectors now beat lazy route
row-color overrides without adding a second row color owner.

Visual review covered actual paused progress, dark/light desktop Library controls
and delete dialogs, mobile Dashboard confirmation, and desktop Trades hover/pager.
Representative screenshots are beside this receipt. `FAIL-*.png` are preserved
pre-final troubleshooting snapshots: the first captured the original swallowed
hover; later input-focus snapshots were produced before the test waited for CSS
transition completion. The final harness waits for settled state and all checks
pass; those old snapshots are not the accepted final state.

Limits: this is scoped Chromium UI evidence, not whole-product/broker acceptance.
No actual data mutations, live runtime, service restart, provider request or job
state transition was performed. Native TradingView vendor internals were outside
this review.
