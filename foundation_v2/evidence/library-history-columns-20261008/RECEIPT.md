# Library history columns and footer — 08/10/2026

Owner requested a cleaner footer boundary and history presentation, plus an
explanation of M1/Bid versus ticks. The history range now occupies two fixed-width
columns (From date / To date, UTC), using dd/mm/yyyy without the wrapped arrow.
Saved rows keep their observed first/last boundaries and exact timestamp tooltips;
catalog rows retain metadata dates with the unverified-coverage explanation.
Unknown dates remain “—”. Compact M1/Bid tooltips explain the existing data format.

The table viewport's bottom border is removed; the shared pager owns its fixed
divider. Body row separators use a quieter neutral color; a partially clipped
next-row line near the footer no longer competes with its structural divider.
The native scrolling behavior remains intact.
Column widths sum to 100% and remain stable between pages. No API, download
format, dataset, job or broker behavior was changed. M1/Bid is still the existing
download contract; tick ingestion is not part of this UI slice.

Validation: Vite production build passed; 10 existing data-library/copy tests
passed; git diff --check passed. Independent browser evidence covers actual local
GET-only catalog dark/light at desktop/mobile plus labeled saved/unknown fixtures.
See independent/REVIEW.md, qa.mjs and results.json for final checks and limitations.
