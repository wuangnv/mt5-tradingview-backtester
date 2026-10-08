# Library single-row desktop correction — 08/10/2026

Follow-up to `library-toolbar-20261008`: the earlier 1164px container breakpoint
forced two rows at the owner's actual 1448px viewport even though controls fit.
The earlier acceptance covered a desktop single row only at 1526/1710px.

Reproduced on live UI5180/API8010: at 1448px, available toolbar width is 1136px
and toolbar height was 100px. `before.json` and `before-1448.png` retain this.

Changed only page-local CSS: search minimum/basis 180 → 160px and two-row
breakpoint 1164 → 1115px. At 1448px the search is 181.19px wide; at 1440px it
is 173.19px. Controls retain existing fonts, heights, spacing and labels.
Narrower containers still reflow rather than clip controls. Fixed status width
and the Downloaded default/reset state are unchanged. No backend/data changes.

Validation:
- `live-qa.mjs`: actual services at 1448/1440/1526/1710, all four statuses:
  toolbar height 44px, all controls share centerline, no overlaps/overflow.
  Keyboard dropdown open/Escape, clear/default and enabled EUR/USD download
  button pass. No API writes or browser errors; no download started.
- `qa.mjs`: labeled fixtures with prior real QDM catalog payload at
  1710/1526/1448/1440/1366/1280/768/360. Stable geometry across statuses, resets,
  pagination, independent sorting, reload, no page overflow/errors pass.
- Reviewed live 1448px screenshot and narrow 360px fixture screenshot.
- `npm run build` passes.

This corrects the reported desktop layout; it does not claim one row on mobile.
Frontend reload only; no restart required.
