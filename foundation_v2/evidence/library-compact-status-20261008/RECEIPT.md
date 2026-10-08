# Compact Status column — 08/10/2026

User rejected the remaining blank strip before Actions. The previous 180px
Status column still reserved too much width for progress; alignment/column-width
checks alone had not captured the visible gap after short ordinary status text.

## Correction

- Status is 112px, close to the adjacent date/size columns. Actions retain 196px
  and the existing fixed control slots. Text-button contents align to their
  padding start, avoiding the extra gap introduced by centering short labels.
- Progress uses vertical space: full state label, then track and percentage,
  then transferred bytes and optional speed. Long labels/values wrap without
  smaller type or clipping. Active rows can therefore be taller than unsaved rows.
- Backend/job state, mutation callbacks, measured units, disabled/cooldown rules,
  date columns, sticky header and native horizontal table scroll are unchanged.

## Verification

- Production build: PASS; focused locale/copy tests: 2 PASS; diff check: PASS.
- Parent actual GET-only desktop screenshot and `geometry.json`: 112px Status;
  visible status-text end to first action icon is 77.59px. Parent inspected the
  actual grid and vertical progress fixture, not only column dimensions.
- Independent runnable QA: 12/12 PASS; review: `independent/qa.mjs`, `results.json`,
  `REVIEW.md`. Covers actual catalog reads and labeled transfer/update states,
  dark/light, 1505/1710/1920/360 widths, English, extreme metadata, content-gap
  oracle (at most 85px), contained controls, stacked progress, hover/focus,
  dialog return and real sticky-header scrolling.

All actual journeys block writes, live routes, WebSockets and external origins.
No download/update/pause/resume/cancel was invoked against the real backend.
Layout fixtures do not measure provider throughput or backend recovery.
