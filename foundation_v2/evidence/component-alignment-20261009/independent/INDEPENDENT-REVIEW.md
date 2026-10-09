# Independent component alignment review — 09/10/2026

**Bounded verdict: PASS.** No unresolved alignment finding remains in the tested contexts. This is acceptance of the current component alignment slice, not whole-product acceptance.

## What was reviewed

- 60 broad route/theme/viewport samples: 15 routes × dark/light × 1710/360. Actual read-only routes and demo routes are distinguished in `AUDIT-NOTES.md`.
- Source diff for shared checkbox margins, Ledger choice spacing, Journal checkbox spacing, Market search height, Ledger typed numeric columns and table action axes, scenario numeric rules, and reference action column.
- Final independent run of `web/tests/componentAlignment.browser.mjs`: **36 journeys PASS**, `regression/report.json`, no browser page errors and no attempted API writes. It covers numeric alignment after dynamic column selection; checkbox caption gaps/centers; reference table action centers; Simulation numeric header alignment; session drawer field edges; balance suffix centering; Risk checkbox centering; Market search/filter height and desktop axis.
- Final runnable `conditional-review.mjs`: **8 checks PASS** for CSV review and actual Journal context checkbox at all four contexts. Four CSV preview POSTs were fulfilled locally; zero forwarded writes. Browser errors are empty. CSV mark margin is 0, mark-to-text gap 8px, first-line center delta −0.5px. Journal gap is 8px and center delta 0.
- Visual review of Ledger desktop, Ledger filter mobile, quick-session desktop, session settings mobile, and CSV review mobile screenshots. No optical axis defect reproduced in those reviewed captures.

## Findings closed

Native browser checkbox margins created 10–13px visible gaps and 4px parent-edge offsets. Shared `margin:0` now gives the intended 8px gap. Local Ledger/Journal choice gaps use the shared spacing value. CSV's dead `margin-top:2px` override was removed; first-line geometry remains within 0.5px.

Ledger selection/action controls now share the header cell axis. Numeric Ledger header/body columns align right using their semantic keys, which survives hiding a preceding text column and preserves P/L tone classes. Reference action buttons share the header axis. Market search matches dropdown heights: 36px desktop and 44px touch; mobile stacking is intentional.

## Limits and historical failures

Simulation demo has numeric headers but no scenario body rows. The test's selector supports body rows, but this run does **not** establish scenario tbody geometry. Source review confirms the same rule applies to the static numeric body columns.

The broad scan does not accept provider/download behavior, broker/live connected variants, actual loaded trading chart controls/vendor internals, all submit validation or server conflicts, unmounted conditional forms, orphan components, full zoom/accessibility, or animation/performance quality. These need their respective mounted/runtime fixtures and product gates. Empty/offline demo states cannot prove loaded states.

`regression/failure.json` is historical harness evidence: the first run compared intentionally stacked mobile toolbar axes; a later run omitted the Simulation tab query and found zero scenario elements. Both harness assumptions were corrected before the final 36 PASS; neither is claimed as a product defect.

Reviewer did not edit product source or test source, restart services, or run provider/broker actions. Root owns build, additional validations, source integration and commits.
