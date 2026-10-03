# Shell owner comments — 2026-10-03

Owner requested removal of horizontal sidebar separators and preservation of the WMREPLAY logo when collapsing. Dashboard comment requests a new design proposal; no Dashboard source redesign is part of this repair.

## Changes

- Removed separator DOM between Testing, Live and Strategies; spacing12px communicates grouping. Removed the utility section's top border. The vertical sidebar/content boundary remains.
- Header brand retains full SVG WMREPLAY beside the44×44sidebar control in expanded and collapsed desktop states. The header's brand area no longer shrinks with the sidebar. Mobile uses a fluid brand column,8px logo gap and a shrinking SVG, retaining the full name alongside header actions at320px.
- Existing desktop localStorage preference and transient mobile drawer state are unchanged. Collapse changes aside labels/content width, never session/cursor scope.
- Browser regression now requires visible full wordmark, nonoverlapping targets and zero separator elements/utility borders in both states.

## Evidence

UI source hash `6a7a852267e13ac41f911a4cbc05b2a45487d8de122e12fea04314205a441be9`; final scan sourceBefore equals sourceAfter.

Evidence root: `D:/ANNAM/TradingWorkspace/.artifacts/mt5-shell-comments-20261003/`.

- `controls-r1/report.json`:8/8 width/theme interaction and geometry cases passed at1440/768/390/320px. Full SVG stays visible during collapse/reload;44px target and keyboard/preference/help/theme/language/select checks passed.
- `drawer/report.json`:2existing default/saved-desktop-preference scenarios passed, including keyboard trap, dismiss/reload,760/761breakpoint and full-bleed chart.
- `routes/report.json`:144/144real-local route/axe/reflow cases passed; zero failures/unexpected requests. Historical cursor20 included. No API fixtures or writes.
- `unit.txt`76/76webtests and `build.txt`77module build passed. Existing bundle-size warning retained.
- `review/REVIEW.md`:independent16state/width/theme cases passed. Header brand/actions do not overlap; full logo width132px normally and101.17px at320px, SVG height12.53px. URL session/cursor unchanged. Reviewer retained and corrected its own storage-seeding harness failure; no product bug from that diagnostic.

Root reviewed final collapsed shell screenshot. Services5180/8020remain read-only/brokerlocked; isolated QA contexts closed without touching the owner tab. No course/DB/provider/ledger/STATE/golden edits. Intentional shell changes do not promote old canonical screenshots to the new source; whole-product/manualWCAG/chart-duration gates remain separate. Prior compact-brand comment in CSS describes the previous repair and has no behavioral effect.

## Dashboard proposal handoff

Recommended order: resume last opened available session → new Backtesting/Prop/Tutorials actions → up to3–5recent sessions → compact scoped replay summary → link to Analytics. Alternative: performance summary first for review-oriented use. Detailed filters/monthly and symbol distributions belong in Analytics; inventory/provenance details remain discoverable rather than competing with the primary action.

Resume should use existing workspace-scoped last-session preference and validated catalog; fallback to catalog recency `updated_at_utc` is update recency, not proof of last activity or time spent. Do not fabricate replay duration, study streak, profitability/edge, or aggregate unlike currencies. Current limited overview reads must remain visibly partial.

Two interactive proposal variants are response content at `C:/Users/MIIKEY/.codex/visualizations/2026/10/02/01a0fac9-646d-7111-8fc5-e5305e968a5a/mt5-dashboard-layouts.html`, explicitly labeled QA illustration. They make no requests or product writes. App Dashboard remains unchanged until the owner asks to implement the proposed design.
