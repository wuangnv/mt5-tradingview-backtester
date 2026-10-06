# Scoped independent acceptance: PASS

56 unique route cases accepted: 38 retained from r4 and 18 affected r5 reruns. Coverage includes actual/demo Dashboard, Sessions, Trades and both Analytics sources, dark/light, VI plus representative EN, widths360/768/1440. Eight final targeted journeys also pass; source stayed stable in each accepted run. No product edits, actual writes, external/provider traffic or WebSockets were used.

## Accepted behavior

- Peach primary rest/hover and filled-red destructive actions retain sufficient foreground contrast: 100 computed samples, minimum4.64:1. Neutral Analytics selector retains desktop40px/mobile44px pill geometry. Trading project-primary tokens remain unchanged.
- Dashboard non-action header clicks expand/collapse; chevron Enter/Space works; rename and keyboard Delete opening/cancel do not toggle expansion. Actual empty expanded report has one honest message and no blank chart panels. Counts use matching/catalog totals and update to zero on empty search. Demo curves and Dashboard chart accents use the report roles.
- Rich Sessions, Assets, Timezone and SessionFilter searches share transparent surface, underline/focus, no visible outline ring, search-empty behavior, horizontal clipping and Escape focus return.
- Analytics parent text/icon and continuous2px underline are peach; child labels remain neutral, including transparent hover. Clear filters has decorative trash glyph, accessible text, hover and adequate contrast.
- Final clear-draft regression covers committed filter/date/time/type state plus an uncommitted alternate session: clearing resets the draft to the canonical report session in actual/demo and both themes, and removes applied URL filters on actual routes.
- 16 relevant desktop/expanded Axe scans: zero WCAG2A/AA/2.1AA violations; zero page errors or blocked requests in accepted runs.

## Findings and evidence provenance

Initial primary/control specificity and Dashboard blue-series omissions were corrected by owner. Supplemental checking found a real stale session draft after Clear filters; owner now synchronizes draft/draftExtra/draftSession before committing scope. Final eight journeys verify the fix without mutating actual data.

Keep failed diagnostic receipts: r1 product failures; r2 wrong reviewer Axe path; r3 interrupted because source changed; r4 mobile40px oracle corrected to the existing44px touch target; supplemental r1 real stale-draft failures plus demo h3 strict-selector oracle. The outline-width3px observation was a reviewer oracle issue: computed outline-style is none, so no visible ring.

The main matrix spans two stable revisions: r4→r5 changes Dashboard blue chart CSS, rerun for all12 Dashboard cases plus6 corrected mobile Sessions cases. After r5, only AnalyticsFilterBar's three draft synchronization assignments changed; final clear-draft journeys verify that state path. Final pins include the two source-only Research spark mappings and both UI contract documents.

## Limits

This is UI acceptance only. Actual empty analytics are preserved; report chart paint uses labeled demo data. Research/journal sparkline mappings and paging-independent count use source review; no additional broker/provider/actual mutation, chart-candle, financial-calculation or whole-product acceptance is claimed. Prior trading palette acceptance remains separate.
