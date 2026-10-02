# WMREPLAY independent visual review R2 — 2026-10-02

Status: `SCOPED_REVIEWER_APPROVED_FOR_BASELINE_PROMOTION`.

Root may promote the exact 56 image hashes in `visual-approval-r2.json` for the synthetic Testing fixture. This does not close W8, chart golden, WCAG, sustained performance or product acceptance.

## Scope and provenance

- Reviewer: `/root/mt5_independent_review`; no product/baseline/ledger writes.
- Frontend source: `71373c3a4a02e1d3cd68ff3e6bffbd92a8dfdb153a5f3c8d39aa3ac5cc8030fa`.
- Fixture: `a2b784bbc6dd1b9d262245be5aa8be5bff2af21114270da12b7724cafc9c8cc0`.
- Environment: Windows, Chromium 153.0.8010.12, vi-VN, UTC; themes dark/light; 1440x900, 1280x800, 768x1024, 390x844.
- 32 route receipts / 56 exact non-repeat images. All 56 match metadata and deterministic repeat images.
- Review coverage: all first-round top images inspected, 37 unchanged hashes reused, all 19 changed r2 images inspected; remaining distinct metrics separately inspected.
- `replay-top.png` represents Sessions because the fixture uses `select=1`; chart is outside this promotion.

## Repair review

Named semantic groups fix the ignored generic ARIA labels; the chart group contains a causal candle summary without hiding focusable descendants. Shared ledger P/L/R columns now align right. The capture targets the table itself and asserts a visible first data row.

All 16 ledger captures now contain rows. Mobile/tablet keep the wide ledger in a named, focusable horizontal region. Independent ArrowRight interaction reaches scrollLeft422 and exposes right-aligned numeric cells on dark/light390; the native menu focus loop, Escape and focus restoration pass.

## Evidence

| Receipt | Result |
|---|---|
| visual-capture/report.json | 32 expected; zero unexpected/skipped/flaky/errors |
| a11y-focused-r2/report.json | SCOPED_PASS 12; current source before/after equal |
| a11y-full/report.json | SCOPED_PASS 144; no axe violations, unresolved ARIA, page errors or page/content horizontal overflow |
| keyboard-readonly-report.json | Independent PASS 2; native scroll + focus + menu regression |

The full scan retains color-contrast incompletes (glyph-only and unknown canvas backgrounds); these are not confirmed violations and are not full manual WCAG approval. Expected Learn/Live404 unavailable states are not functional backend acceptance.

## Scoped rubric

| Criterion | Score | Scope of evidence |
|---|---:|---|
| Workflow and next action | 4/5 | Dashboard/Sessions/Trades/Analytics headings, selected session, source links and primary action remain readable across the eight visual projects. Related persisted navigation journeys recorded in the integration packet. |
| Numbers, units, time, precision and source | 4/5 | Synthetic 60 closed trades / USD75 clearly labelled; unknown risk remains N/A; replay/local broker-locked mode and UTC retained. P/L and R cells now right-aligned. |
| Chart/table density | 4/5 | All 16 ledger captures show actual rows; desktop columns scan cleanly; 390/768 tables use contained horizontal scrolling. Independent mobile ArrowRight checks reveal numeric columns. |
| Component/token reuse | 4/5 | Shared shell, route tabs, controls, semantic theme tokens and table styling remain consistent; source diff uses existing groups and table wrapper. |
| State/error/permission clarity | 4/5 | Fixture context and replay/local broker-locked label are explicit; N/A is retained. Automated full scan treats missing Learn/Live endpoints as unavailable states, without implying those backends complete. |
| Keyboard/focus/contrast/responsive | 4/5 | 12 focused and 144 full automated cases pass with no axe violations, ignored ARIA names, page errors or page/content horizontal overflow. Two independent mobile native keyboard/menu regressions pass. Contrast incompletes remain manual-review limitations. |
| Hierarchy/alignment/spacing/typography/flat-first | 4/5 | All 32 top captures plus distinct metrics and ledger captures reviewed; reusable flat shell and readable Vietnamese glyphs retained. No observed new clipping or layout regression in approved exact images. |
| Short interactions and retained context | 4/5 | Independent keyboard scroll/menu checks and prior persisted navigation/reload receipts show no observed short interaction regression. Long-duration heap/frame acceptance is expressly excluded and remains open. |

## Gates retained

- Whole W8 or whole-product completion; this is a scoped four-route visual baseline approval only.
- Full manual WCAG and unresolved automated contrast incompletes (glyph-only/canvas/unknown backgrounds).
- Canonical chart golden: replay filenames in this fixture mean Sessions (select=1), not the chart.
- Long-duration heap/frame/performance acceptance; root-owned long job remains separate.
- W6 backend feature acceptance: Learn/Live 404 unavailable states are not completed features.
- Real market/provider/broker/OAuth/deploy or owner acceptance.

This separate receipt records agent review, not owner approval. Root owns promotion, snapshot comparison and ledger updates. The supplemental native-scroll screenshots are interaction evidence rather than golden captures.
