# Dashboard, Live and Market Data refinement — 7 October 2026

Owner scope: remove the Recent Sessions status selector; use page canvas for
card hover/expanded states; clarify background refresh; join structural Live
dividers; make Market dividers full width; remove duplicated Live headings/status
and repeated explanatory copy. Interactive calendar cells keep their spacing.

Dashboard uses the existing non-archived session default; legacy status queries
no longer apply an invisible filter. Background performance reads keep existing
results and expose `aria-busy` without a warning-like refresh sentence. Loading,
errors, stale data and unavailable performance remain distinct.

Live panel grids have no structural gaps. Dividers reach workspace edges and
meet side-panel borders, while content has internal gutters. Accounts/Analytics
headings match toolbar height. Market's toolbar/table/pager extend through the
canonical page gutter; DataDesk stays under its existing shared catalog contract.
Live retains an accessible heading, shell demo identification and exceptional
read-state notices. Data/cost/coverage explanations move into source disclosure.
Reader, calculation, mutation and broker contracts are unchanged.

Primary verification: final Vite build; 19 Dashboard/Live model and reader tests
plus the shell-preferences test; 32 desktop/mobile dark/light browser layout
cases; seven reused filter/dialog/pagination journeys; diff whitespace check.
Selected Calendar, Accounts and Market images were visually reviewed. R3 adds
only Dashboard's missing main landmark after independent accessibility review;
see independent receipt for accepted cases, source hashes and delta boundary.

Actual Live data remains unavailable locally. Positive account scenarios use
explicitly labeled demo/fixtures. No downloads, writes, provider connections or
broker actions were attempted. This checkpoint covers UI refinement only.

Run primary layout QA from `foundation_v2/web`:
`node ../evidence/live-market-dividers-20261007/primary/layout.mjs`.
Independent scripts run from the product root. Large screenshots and diagnostic
reports stay local; compact accepted evidence and runners accompany the commit.
