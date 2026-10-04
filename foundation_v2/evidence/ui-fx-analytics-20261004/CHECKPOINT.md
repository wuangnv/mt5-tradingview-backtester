# FX Replay reference: Trades, Analytics and reload removal — 04/10/2026

Owner scope: remove manual reload actions and duplicate visible Dashboard/Sessions/Trades/Analytics
titles; implement the supplied Trades/Analytics reference workflows, including the locked analyses,
with Sessions and Prop firm sources. No paywall, new dependency, broker/provider capability,
canonical-golden promotion or ledger/STATE acceptance change.

## Behavior and data ownership

- Subnav identifies the page. Dashboard retains a screen-reader heading; redundant visible headings
  and manual reload buttons are gone. GET readers reconcile on focus/online. Uncertain management
  writes are never retried automatically; catalog reconciliation retains the draft and mutation fence.
- Trades uses the existing workspace/session ledger: search, asset/side/outcome/date/tag filters,
  sortable columns, column picker, page size/navigation, selection/detail and CSV. Unknown realtime,
  fees, original SL/TP, rating and planned R remain unknown. Return% explicitly divides by initial capital.
- Analytics sources are Sessions / Prop firm; each uses Performance / Drawdown / Simulation.
  Performance adds outcomes, side, explicit fixed UTC ranges, timezone-aware hour/day/month,
  calendar and frequency. Closed balance excludes floating P/L; filtered balance is hypothetical
  from the starting capital. URL filters/tab survive context changes and same-revision focus refresh.
- Drawdown uses closed balances; MAE/MFE are observed price excursion and exclude terminal
  intrabar extrema. Lower bounds and unsupported paths remain explicit. The original planned
  risk cannot be recovered from an assumed stop distance.
- SL/RR is a read-only price experiment using retained protective-exit/cost semantics and the
  original exposure horizon. Configured stop distance/multiplier/target are assumptions. Ambiguous
  intrabar ordering is not guessed. Monte Carlo is seeded bootstrap/configured win-loss, local,
  bounded to250000steps; it changes neither canonical trades nor broker state.
- Prop reads an attempt report and fences replay session/dataset/hash/branch/cursor/exact event/
  phase/currency. Closed trades are scoped to the report phase and attempt interval, from phase
  initial capital; carried positions are assigned by close phase. Challenge equity/objectives
  remain separate persisted report snapshots. Empty reports do not select an unrelated session.
- Existing shell hover/selected and positive/negative/primary tokens are reused. Native selects
  retain their contracts and progressive picker behavior. Tablet/mobile charts use12px HTML scale
  captions below900px; dense tables scroll inside a named keyboard-focusable region.

## Verification

Final UI fingerprint: `f53c720814eadc394251f28913ed924423e5bead1f6ecad9dfc60c5f718355e6`.
Backend checkpoint: `3efa158`; initial product baseline: `0a3c64e`.

- `node --test tests/*.test.mjs`:89/89PASS. Numeric oracles cover signed P/L, unknown/zero,
  timezone/filter/calendar, deterministic bounded Monte Carlo, CSV formula escaping and Prop fences.
- `npm run build`:PASS91modules. Existing >500kB chunk warning remains.
- Python focused suite:83PASS (`test_analytics_experiments`, `test_replay_analytics`,
  `test_replay_execution_core`, `test_ps03_prop_reports`, `test_u6_analytics_read_model`).
  Includes exact same-cursor event checkpoints, phase carry, no-future excursion/cost semantics,
  and near-zero outcome filters consistent with the canonical ±1e-12 metric tolerance.
  Two upstream Starlette/httpx deprecation warnings remain.
- [Final actual journeys](journeys-final/report.json):24PASS across dark/light ×1440/768/390/360.
  Analytics filters/keyboard tabs/MC numeric oracle/SL config/CSV, Trades sort/columns/pagination/
  selection/detail/filter, actual Prop empty. Zero page errors, writes/external requests, detected
  axe violations or page overflow. Source before/after matches the final fingerprint.
- [Final native zoom](zoom-final/report.json):12SCOPED_PASS, Trades/Analytics both themes at
 125%/200%/100%; source fingerprint unchanged. This is native Chromium zoom, not CSS zoom.
- [State probes](states/report.json):13PASS. Labeled Prop fixture binds the actual historical replay
  at cursor20/event60:20closures/25USD; unbound/wrong-phase/cleared selection, partial/stale/blocked/
  empty/unknown/denied/malformed/network recovery and Journal tag/CSV scope. No writes/errors.
  Prop reports and Journal annotations are intercepted fixtures, not real persisted challenges.
- [Sessions regression](sessions-regression/report.json):17PASS, actual GET-only theme/width
  journeys and separately labeled edge fixtures; no real mutation claim.
- [Management regressions](management/receipt.json):11PASS in an explicit management fixture,
  covering draft/conflict/uncertain-write fences/archive/duplicate and new reports. No actual writes.
- [Focus regression](focus-regression.json):same-revision Simulation drafts/result survive;
  a labeled later catalog revision preserves URL side/tab/cursor20. Actual reads, no DB writes.
- [Independent review](REVIEW.md) verifies source, numeric fences, interaction colors and tablet
  captions/lower sections. Root inspected desktop Trades/Simulation, mobile Performance and lower
  side/time/calendar captures. Automated axe results do not certify full WCAG or other browser engines.
- [API after source restart](api-final.json):actual GET-only DB has60closures/net75USD; historical
  cursor20 has20/net25USD, exact event60 experiments20supported rows, read_only=true.

## Retained findings and limits

- [Earlier matrix FAIL](journeys/failure.json) found light768 selected-tab contrast. New CSS used
  nonexistent tokens and a global hover selector won specificity. Corrected to existing shell and
  semantic tokens; final matrix and independent hover probe pass. Earlier attempts remain diagnostic.
- The independent tablet harness first read epoch seconds as milliseconds and expected one hour
  bucket. [Failed attempt](independent-tablet-failure.json) is retained; the corrected oracle reads
  each actual close timestamp and compares UTC00=72.5/01=2.5 with VN07=72.5/08=2.5,total75USD.
  [Final review](independent-tablet-review.json) passes11cases on the stable fingerprint.
- Local DB is persisted synthetic QA, not the owner's MT5 account. Its actual Prop report catalog
  is empty; challenge binding/phase/carry UI evidence remains labeled fixture evidence. Real challenge
  integration and whole-product U/Y/W acceptance remain open. No full performance/WCAG/golden claim.
- Fixed UTC session ranges intentionally avoid unverifiable DST/market-session labels. MAE lower
  bounds, absent planned risk/R and incomplete SL/RR samples are shown rather than invented.
- Services remain UI5180PID18400 and read-only API8020PID6004 (managed session37702), isolated
  `trading_workspace_v2_ui_20261001`, brokerlocked. Only owned preview API was restarted; no reseed,
  terminal restart, migration, provider call or broker write. Recheck PIDs on resume.

## Resume and rollback

Use `ui/workspace-patterns.md` for the current report contract, this checkpoint for scoped evidence,
and the parent Product Plan/ledger for product acceptance. Continue from current product commits;
do not overwrite dirty cache/artifacts or deferred VI work. The backend and presentation checkpoints
are separate coherent commits. Revert the presentation before removing its new backend contract.

References: the six owner-provided FX Replay screenshots named in the request; layout/workflow
references only. Account numbers and charts in those images were not used as application data.
