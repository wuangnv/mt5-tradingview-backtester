# WMREPLAY persisted-workspace integration — 2026-10-02

Status: `FUNCTIONAL_INTEGRATION_VERIFIED / SCOPED_AUTOMATED_QUALITY_PASS / FULL_PRODUCT_NOT_COMPLETE`.

This resumes the owner's request to connect the real UI across Dashboard, Sessions,
chart, Trades and Analytics. It is an evidence checkpoint, not an operational ledger
or an independent visual approval. Earlier WIP and receipts remain preserved.

## Behavior and data flow

- Dashboard derives closed-trade counts from tenant-scoped replay execution records,
  deduplicates inherited branch fills and retains unknown money/risk/time fields.
  Its filters and source link lead to the same selected session in Analytics.
- Sessions uses persisted metadata with revision-checked rename/archive/duplicate
  actions. Chart, Trades and Analytics retain workspace/session selection on navigation
  and reload; the Trades tab opens the closed-trade ledger.
- Historical Analytics projects the execution checkpoint at `cursor_index` or an
  integer dataset-bar `cutoff_timestamp`. JSON, metrics, ledger and CSV share that
  bound. Invalid, future or conflicting bounds return 422. Reads do not update the
  canonical session. Initialization uses a verified immutable revision when no
  price-mark checkpoint exists; ledger/lineage errors cannot fall back to latest data.
- Chart drawings retain time/price anchors, persist through the annotation API and
  support rename, visibility, locking and revision-checked tombstone deletion.
  Explicit reload reconciles 409/404 failures. Mobile details follow the footer.
- Settings has a local appearance draft, cancel/save, reload and cross-tab synchronization.
  A storage failure reports temporary application and permits retry. Learn/Settings
  requests fence stale workspace/resource responses. Journal light-theme labels use
  the existing theme's readable text token.

The execution ledger remains the financial authority. Gross P/L, fee breakdown and
planned risk stay unknown when absent from persisted fills. Local preference storage
does not own workspace identity, permissions or execution state.

## Source and validation

- Backend checkpoint: `e97800c` — session lifecycle, analytics/overview and annotation persistence.
- UI checkpoint: `d3456cd` — persisted session routes, chart, preferences and related regressions.
- Final frontend source SHA-256: `c26c725692264f4f714b88d57ec3266e74cab3a37507166a09665cef882466a5`.
  The final route scan records equal before/after hashes. Native zoom was captured
  before the Journal-only CSS repair; its seven routes do not include Journal.

| Check | Result | Evidence |
|---|---|---|
| Focused backend / disposable PostgreSQL | 95 tests + 3 subtests pass; isolated DB removed | `backend-tests.txt` |
| Web unit suite | 76/76 pass | `web-tests.txt` |
| Vite build | Pass, 77 modules; existing 739.90 kB JS bundle warning | `build.txt` |
| Real API/PostgreSQL Analytics | 12 cases pass, including historical JSON/CSV/reload/future rejection | `analytics/report.json` |
| Real service navigation + local preferences | 5 checks pass, no page errors | `journey/report.json` |
| Real session metadata / archive / duplicate | 7 checks pass; fixed canonical oracle unchanged | `sessions-real/receipt.json` |
| Real chart cursor / branch / order-draft navigation | 7 checks pass; strictly ordered prefixes and fixed oracle unchanged | `chart-real/report.json` |
| Real annotation lifecycle + mobile/landscape layout | 7 checks pass, no page errors | `drawings/report.json` |
| Mobile navigation | 2 scenarios pass | `mobile-drawer/report.json` |
| Settings/Learn stale/error/denied regressions | 8 scoped fixture checks pass | `w6/report.json` |
| Final route scan | 108/108: 18 routes × 2 themes × 3 widths; no axe violations, overflow or page errors | `quality/route-scan-final.json` |
| Native browser zoom | 42/42: 7 routes × 2 themes × 125%, 200%, 100% | `quality/native-zoom.json` |
| Golden candidate harness | 32/32 fixture captures pass repeatability checks; candidates remain unapproved | `quality/visual-candidates.json` |

Real integration uses only the isolated loopback database
`trading_workspace_v2_ui_20261001`, synthetic dataset and existing local API/UI at
8020/5180. The fixed canonical oracle is 60 closed trades / USD75 at cursor60;
cursor20 yields 20 trades / USD25, and cursor0 yields no closed trades.
Drawings tests create and mutate their own synthetic session. Fixture checks are
labeled separately. Browser profiles remain under `.artifacts/`, outside Git.

The first 108-case scan failed Journal light-theme contrast at all three widths.
Keep `quality/route-scan-before-journal-repair.json` as the failure receipt; the
six-case focused repair and final 108-case scan passed. Screenshots were inspected
for historical Analytics, chart/mobile details, Settings and the Journal repair.

## Remaining gates and resume

1. Independent review against the WMREPLAY rubric and canonical golden approval
   remain open. The replacement review workers previously reached the model usage
   limit; this root continuation did not substitute self-review for that gate.
   `web/tests/visual/` is comparison tooling with unapproved candidates, not accepted baselines.
   The missing closing parenthesis in its previously untracked configuration was
   repaired, then all 32 candidate tests ran successfully. Candidate images/receipts
   are in workspace `.artifacts/wm-visual-comparison/candidate/`; the harness never
   copied them into baselines or promoted them. Preserve them for independent review.
2. The historical 74.3-minute heap failure (23.1→64.0 MB post-GC, peak72.2 MB,
   above the 12 MiB delta limit) remains open. Precise CDP/monotonic-clock diagnostic
   tooling exists in `web/tests/wm-integration-quality-heap.mjs`; short diagnostics
   do not close the long-duration heap/frame contract. Reconcile with the existing
   W8 triage before another long run; do not start duplicate jobs.
3. Automated axe and reflow checks establish their recorded route/state scope.
   They do not establish complete manual WCAG, all canvas interactions, real market
   data, broker/provider operation or whole-product acceptance.
4. Resume from this packet, the Product Plan/WMREPLAY plan and existing execution
   entrypoint. Do not edit generated STATE.json or ledger exports to mark gates passed.

Other untracked integration receipts under the 20261001/20261002 directories are
retained WIP. This packet checkpoints only the explicitly reviewed `resume/` evidence.
