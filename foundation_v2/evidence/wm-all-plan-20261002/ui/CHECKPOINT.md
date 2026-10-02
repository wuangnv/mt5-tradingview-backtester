# WMREPLAY accessibility and visual repair — 2026-10-02

Status: SCOPED_VALIDATED / FOUR-ROUTE_VISUAL_APPROVED / FULL_PRODUCT_NOT_COMPLETE.

Owner request: execute every current workspace PLAN, continuing existing work and gates. Root owns frontend repair; /root/mt5_independent_review independently reviewed the visual and keyboard evidence. Baseline: MT5 03f89ac, followed by the separate U5b backend commit b03304e. No redesign, provider, broker or production deployment.

## Behavior and state

Dashboard, Analytics and replay control groups now expose their labels to assistive technology. The chart group describes the actual final opened candle (time/OHLC/count); it reads only the already cursor-bounded rows. Canvas attribution remains focusable, and cutoff controls provide a keyboard path to candle values. The mobile navigation retains dialog focus trapping, Escape and focus restoration. Its trigger is an expanded/controlled disclosure. Net P/L and Net R headers and cells align right; the mobile ledger is a named focusable scrolling region.

Data flow and ownership are unchanged: workspace/session/cursor select the persisted read model; frontend labels and formatting read that model. Unknown values remain N/A. Generic groups use `role=group` rather than adding landmark wrappers. No new UI dependency, token system or financial evaluator.

The initial repair used `role=img` for the chart and exposed a real nested-interactive violation because the chart library contains a focusable attribution link. That failed 12-case receipt is retained as `a11y-before-group-repair.json`. A named group preserves the link and resolves the conflict.

## Verification and visual authority

- Final web unit suite: 76/76 PASS (`../web-tests-final.txt`). Final Vite build: PASS, 77 modules; existing approximately 740.40 kB JavaScript warning remains.
- Focused actual local service scan: 12/12 PASS after group repair.
- Full actual local service scan: 144/144 PASS (18 routes × 2 themes × 1440/1280/768/390); zero violations, unresolved ARIA findings, page errors or page/content overflow. Contrast incompletes still require manual review. Learn/Live 404s verify unavailable states only.
- Independent mobile keyboard checks: 2/2 PASS, dark/light 390; horizontal ArrowRight reveals numeric columns, visible focus, drawer Tab loop and Escape restore. Exact receipt is under `../review/`.
- Four-route fixture capture: 32/32 PASS, 56 exact approved images; ledger capture now aligns the actual table and asserts first-row visibility plus numeric alignment. Previous candidates are preserved.
- Root copied exactly the independently approved 56 image hashes; comparison against those baselines: 32/32 PASS, zero pixel tolerance. Approval and exact hashes: `../review/visual-approval-r2.json`; canonical promotion manifest: `../../../web/tests/visual/baselines/PROMOTION.json`.

Frontend raw source fingerprint: `71373c3a4a02e1d3cd68ff3e6bffbd92a8dfdb153a5f3c8d39aa3ac5cc8030fa`. Fixture: `a2b784bbc6dd1b9d262245be5aa8be5bff2af21114270da12b7724cafc9c8cc0`. OS/browser/fonts/viewport remain part of the pixel contract. A match establishes this fixture's rendering; it does not establish real-data or whole-product correctness.

## Remaining gates and resume

Chart golden is a separate actual-chart fixture lane: the four-route filename `replay-top` represents Sessions. Full-bleed promotion, complete manual WCAG, Learn/Live backend, whole W8 and product U/Y acceptance remain open. The precise one-hour analytics heap diagnostic is detached at `.artifacts/wm-all-plan-20261002/heap-long`, PID 24164, started 19:46:04 +07; do not start a second worker or change frontend source while it is sampling. The historical failed soak remains intact.

Rollback: revert this coherent UI repair; preserve evidence and later unrelated work. Backend session authority, broker/provider/OAuth/holdout/deploy and retained user data were not changed.
