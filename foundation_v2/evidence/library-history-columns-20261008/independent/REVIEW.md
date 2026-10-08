# Independent Library history/footer review — 08/10/2026

Final PASS: 7 scoped Chromium cases in `results.json`: actual local catalog in
dark/light at 1710px/360px; saved/unknown/paused response fixtures in dark/light
at 1710px, plus dark 360px to check action-column containment. No page errors or
attempted writes. All actual traffic was GET-only; external origins and WebSockets
were blocked. No provider update, download, delete or job transition was triggered.

Verified:

- Exactly 10 headers, with separate Từ ngày (UTC) and Đến ngày (UTC). Full dates
  are dd/mm/yyyy without arrows or time in the table. Saved timestamps retain
  their full UTC date/time including seconds in the tooltip.
- Saved bounds come from the saved dataset; unsaved Dukascopy bounds retain the
  unverified metadata explanation. Unknown dates remain —. No download coverage
  or QA completeness is inferred from metadata.
- Separate child tooltips explain M1 as one-minute candles and Bid as bid-side
  data excluding Ask/actual spread. No tick functionality was introduced.
- Column widths remain exactly unchanged on page two; paused fixture progress
  and resume/cancel targets stay within the narrower action column, including
  mobile. The table scrolls locally with no document overflow.
- Table viewport bottom border is zero. Pager has one 1px top border and shares
  the same boundary coordinate (desktop914px/mobile910px) before/after scrolling.
  Footer height and position remain stable.

Exact visual diagnosis: the original structural duplicate was table-viewport
bottom border plus pager top border. After removing the former, desktop still
showed another line at y909, five pixels above the pager at y914: this was row11's
top separator in a partially clipped row, not a second footer or a horizontal
scrollbar. Native row clipping remains. Body-row dividers now use a quieter
8% content/canvas blend, while the first-row/header boundary and footer retain
the stronger frame color. This avoids JS resize/scroll state, snapping, masking
scrollbars or a covering overlay. Physical row separators may still be near the
footer at arbitrary scroll positions, but they no longer have identical visual
weight or represent duplicated containers.

Final computed divider colors: dark body27.76 vs frame58; light body235.96 vs
frame210 on white. The initial new light rule lost to an existing theme selector;
scoping it with fx-app/fx-shell-story/data-theme corrected that genuine finding.
The final matrix proves both themes. Visual review included desktop dark/light
footer crops, full actual table and mobile scrolled table; dates and headers are
legible and the footer has one dominant divider.

The first tooltip harness queried the TD instead of its titled child span/small;
it was corrected to test the actual component markup. `FAIL-*.png` preserve
pre-final diagnostics rather than accepted screenshots. No source changes were
made by this independent reviewer.

Run from the product root:

```powershell
node foundation_v2/evidence/library-history-columns-20261008/independent/qa.mjs
```

This receipt is scoped UI acceptance, not whole-product, provider or broker
acceptance. Fixtures remain explicitly separate from actual service evidence.
