# Independent QA plan — Trades / demo / page layout

Review ownership: this evidence directory only. Root implements and freezes source. Reviewer uses source inspection and isolated local GET-only browser/API, never edits product source, commits, imports, downloads or changes sessions/broker state.

## Scope and oracles

1. Trades: actual persisted trade count/filter results compared to GET API; FX-style toolbar/columns, reduced technical text, meaningful empty/error/partial states. Demo fixtures provide enough labeled rows for filter/sort/pagination interactions. No CSV export or lifecycle mutation.
2. Analytics source sub-tabs: DOM order Dashboard → Sessions → Trades → Analytics → source sub-tabs → Market Data, same visual row. Selected top-level/source state stays unambiguous. Mobile selected tab is revealed through horizontal scrolling, including source switch, resize and reload; no document overflow.
3. Shared gutters: compare the same content boundary on Dashboard, Sessions, Trades, session Analytics, Prop Analytics, Market Data, Live calendar, Strategies, Data Desk, Research, Journal, Learn and Settings where authorized/local. Dark/light at 360/1440px. Main page wrapper/gutter and nested content must agree; page-specific full-bleed chart workspace is reviewed as an intentional separate contract rather than forced into a report gutter.
4. Demo: explicit label and URL switch; reload/deep links preserve requested mode; switch back restores real data/query/context. Demo fixture IDs cannot become real replay or mutation requests. No fake rows mixed with actual rows, no API-global monkey patch, no writes while exploring demo. Source state/errors remain distinguishable from fixture mode.

## Evidence

- Read source first; wait for explicit root freeze before browser.
- Actual service origins UI5180/API8010, tenant-a. Block non-read methods/external destinations; close WebSockets. Read API requests only; cached Live status is allowed after verifying handler has no broker SDK call. Do not retain broker account/deal details in evidence.
- Screenshots at selected checkpoints, especially mobile sub-nav order, Trades table/toolbars, demo state and gutters. Scroll `.fx-content` to inspect lower content rather than treating document screenshot as full page coverage.
- Axe and overflow checks at representative routes/states; keyboard table horizontal scroll and menu focus/Escape; meaningful fixture-only sort/pagination oracle, not selector-only success.
- Preserve old replay revision/payload/dataset hash/visible prefix before and after. Record final source hashes, and separate any late source delta/recheck from comprehensive frozen-source evidence.
- Label every synthetic error/stale/unknown response fixture. Demo product fixtures are explicit product behavior, not evidence of real financial correctness.

## Acceptance

SCOPED_PASS only after actual data/URL/navigation behavior, responsive visual review and relevant interactions agree. Record blockers immediately to root. Whole-product, broker/Prop financial lifecycle, native zoom, canonical goldens and long-running acceptance stay outside this slice.
