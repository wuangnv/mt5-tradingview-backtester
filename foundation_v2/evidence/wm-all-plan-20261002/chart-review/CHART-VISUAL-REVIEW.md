# WMREPLAY independent chart golden review — 2026-10-02

Status: `SCOPED_REVIEWER_APPROVED_FOR_CHART_BASELINE_PROMOTION`.

Root may promote only the exact 24 final r3 hashes in `chart-visual-approval.json` into the separate `tests/visual/chart-baselines/` directory, then compare. This reviewer has not changed baselines or the completion ledger.

## Behavior, data and provenance

Actual chart uses `view=replay&surface=workspace`, without `select=1`. The existing Sessions golden stays intact. The separate fixture derives from GET-only reads of the isolated QA canonical session at cursor 60 (61 bars) and historical cursor 20 (21 bars). Exact UTC timestamps, OHLC, volume, ordered prefixes, advertised cutoff and dataset SHA are retained.

Stable fixture IDs/names/audit times make the synthetic scope explicit. The execution ledger is omitted because this chart-only fixture makes no financial claims. Four actual annotation API templates retain their exact time/price anchors; run_id and creation cutoff are remapped to the fixture at cursor 60. These drawings are fixture-derived, not claimed as persisted in the canonical session. Historical 20 correctly hides all four later-cutoff objects. The raw canonical session was reread unchanged at revision 123/cursor 60.

- Frontend source: `71373c3a4a02e1d3cd68ff3e6bffbd92a8dfdb153a5f3c8d39aa3ac5cc8030fa`.
- Fixture: `c48bd42eebdfcf57ca9cf707d2d3230439d81f9aff05d2b61c92dfe4adc52591`.
- Windows, Chromium 153.0.8010.12, vi-VN, UTC, DPR 1, reduced motion.
- Dark/light at 1440×900, 1280×800, 768×1024 and 390×844.
- Ownership: five new chart harness/fixture/config/document files and this chart-review evidence directory only. No source, existing four-route tests/fixture/baseline/promotion files edited by this chart lane.

## Validation and review

Final r3 passed 8/8 projects with 24 images and 24 matching repeats. All 24 final images were directly inspected. Each case asserts exact row/object counts, accessible last-candle OHLC/time summary, supporting readout data, slider cutoff/bounds and fitted logical range. The test moves the actual canvas crosshair to middle candle index 30/10, reads exact OHLC and timestamp back, then clears it before capture. This establishes renderer interaction beyond a nonempty-canvas check.

Every intercepted session response is an ordered prefix ending at its advertised cutoff. Historical 20 disables forward mutation controls and preserves 21 bars/zero objects after reload. No page errors, unexpected requests, writes or page/content overflow were observed. The source hash remained unchanged. Candles, wicks, volume, price/time scale, annotations and attribution are visible in the exact fixture images.

The initial smoke failure queried the CSS-hidden readout by accessible role. The harness now verifies the actual accessible chart summary as primary oracle, with supporting DOM readout values checked separately. The first failure/trace is preserved; no product-source repair was needed. Final r3 adds actual crosshair sampling to the 8-case r2 success.

## Scoped rubric

Each criterion is 4/5 for this fixture scope; none is a whole-slice approval.

| Criterion | Evidence |
|---|---|
| Workflow/next action | Actual chart, back link, paper replay/broker lock, cutoff and toolbar/rails/footer present |
| Numbers/time/precision/source | Exact OHLC/UTC summary and crosshair readback; price scales and Fixture labels inspected |
| Chart density | Fitted ranges 0..60 and 0..20; candles/wicks/volume readable at required widths |
| Component/token reuse | Existing chart/primitive/shell/controls reused; shared pinned visual configuration imported |
| State/permission clarity | Canonical/history state explicit; forward writes locked in history; uncontrolled APIs abort |
| Keyboard/focus/contrast/responsive | Accessible chart group, no overflow, current focused/full scan and independent mobile navigation support; manual coverage excluded |
| Hierarchy/alignment/spacing/typography | All 24 images inspected; chart dominant, labels/scales/annotations separated, no observed new clipping/overlap |
| Short interactions/context | Fit, crosshair, details, historical deep link/reload pass; sustained performance excluded |

## Gates retained

- Fixture only covers Candles with all-rising canonical synthetic OHLC and volume 100. Down candles, alternative chart types, SMA and empty/error/stale states need separate goldens.
- Full manual WCAG, canvas contrast incompletes, gesture/touch/assistive-technology coverage remain open. Narrow layouts hide the visual OHLC strip; the named chart summary retains exact values.
- The plotting surface deliberately remains dark in both shell themes. This packet does not establish a light plotting palette.
- Fixture drawings do not prove canonical annotation persistence or their write lifecycle; earlier real drawing integration evidence stays separate.
- Long heap/frame acceptance, whole W4/W7/W8 and full product completion remain outside this review.
- No real market/provider/broker/OAuth/deploy, financial authority or owner acceptance is granted.

This is agent approval for an exact chart golden packet. Root owns promotion, comparison and status updates.
