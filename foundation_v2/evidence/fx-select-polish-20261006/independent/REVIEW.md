# Independent focused review — select polish, 2026-10-06

**SCOPED_PASS: 10/10 browser checks, two scoped Axe scans with zero violations.** No blocking findings. Source pins for `FxSelect.jsx`, `fx-select.css`, and `page-layout.css` match before/after the final run. Reviewer changed only this evidence directory; no source edits or commits.

Command from product root:

```powershell
node foundation_v2/evidence/fx-select-polish-20261006/independent/review.mjs
```

Final result: `pass:true`, `checks:10`, `failures:[]`, `sourceUnchanged:true`, `errors:[]`, `blocked:[]`.

## Verified

- Type All at dark/light × 360/1710: All, App, and Prop Firm have identical **16×16px** checkbox geometry, 12px check text, 4px checkbox radius, **9px 10px** row padding, exact checkbox/text column alignment, and identical hover background. All uses the same checkbox span as options, with no native input remaining.
- All click clears enabled choices; clicking App exposes `aria-checked=mixed` and the minus indicator; Space selects all enabled choices, Enter clears them, and Space selects them again. Battles stays disabled. Escape closes and returns focus to the trigger.
- Dashboard Oldest to newest at dark/light × 360/1710: short list reserves **zero scrollbar gutter**, row inset is **2px left and right**, hover background is present, 6px row corners remain inside the clipping area, and client-edge bounds fit. Mouse selects Oldest; Home moves focus to Newest; Escape closes normally. Cropped dropdown screenshots were visually reviewed in both themes.
- Long Timezone list at dark/light 1710 retains a real native **15px** scrollbar. Actual track click increases scrollTop; native thumb drag changes it again; the dropdown remains open. No DOM or CSS scrollbar instrumentation was injected. Browser launches with `ignoreDefaultArgs:['--hide-scrollbars']` so native tracks are interactive.
- Two Type-menu Axe scans against WCAG 2 A/AA and 2.1 AA tags report zero violations.

## Isolation and limits

All journeys use `demo=1` at UI5180. API and external traffic are blocked; no API requests, blocked attempts, writes, or page errors occurred. No actual session mutation or broker action was executed. This is focused acceptance for the two new comments, not a rerun of whole-product or whole-plan acceptance.

The already recorded underlying Analytics360 report's 11px baseline content overflow remains outside this scope. Popups fit the actual content client edge; this review does not claim that separate report-layout overflow is removed.

## Oracle correction

`report-r1-hover-timing.json` retains the initial hover-background comparison failure. It sampled the animated background before CSS transition settled and could retain pointer hover from the preceding case. The final oracle first moves the pointer outside, waits 200ms, then hovers and waits another 200ms. Symmetric inset/gutter measurements had already passed; the corrected background comparison and screenshots pass too. No product change was needed for this test timing issue.
