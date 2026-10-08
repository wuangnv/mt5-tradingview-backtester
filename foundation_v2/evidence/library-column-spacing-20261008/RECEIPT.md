# Library Status / Actions spacing — 08/10/2026

User reported that Status and Actions still felt too far apart after the prior
alignment fix. The Status column was 16% of table width, reserving unnecessary
space on ordinary unsaved rows and growing with wider viewports.

## Scoped correction

- Status is now fixed at 180px and Actions at 196px. Asset absorbs the remaining
  width; other column proportions, the 1390px table minimum, dates, header
  divider and action slots remain unchanged.
- At a 1710px viewport the table is 1452px wide. Status-to-Actions content-start
  distance is now 180px instead of about 232px. At 1920px it remains 180px,
  instead of the former approximately 266px.
- Transfer metadata permits wrapping for exceptionally long bytes/speed values;
  speed stays right-aligned. Fonts are preserved and no progress/state/callback
  or backend contract changed.

## Evidence

- Production build and `git diff --check`: PASS.
- Parent GET-only actual browser geometry at 1505/1710/1920px is saved in
  `geometry.json`. Parent visually inspected actual and transfer-fixture 1710px
  screenshots. Fixed columns keep the tail compact without control overlap.
- Independent runnable browser QA: 12/12 PASS via `independent/qa.mjs`; review and detailed
  results in `independent/REVIEW.md` and `independent/results.json`. Includes
  actual catalog reads and labeled transfer/update fixtures, dark/light,
  desktop/mobile, English, fixed column/slot geometry, progress containment,
  hover/focus, dialog return and genuine sticky-header scrolling.
- Narrow viewports retain native horizontal table scrolling. The existing
  minimum table width was not changed by this spacing task.

No backend writes, downloads, refresh, pause/resume/cancel or service restart
were performed. Fixture throughput values are layout stress inputs only.
