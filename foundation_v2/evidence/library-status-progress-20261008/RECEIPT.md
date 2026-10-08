# Library status progress and grid alignment — 08/10/2026

User scope: implement the approved progress-in-Status layout, align the Actions
column with the rest of the grid, and retain the sticky header divider on scroll.

## Result and state flow

- Transfer state, completed-days percentage, track and transferred bytes now live
  in Status. Running downloads also show measured MiB/s; paused/processing states
  hide speed. No total-byte estimate is fabricated.
- Actions share their header's left content edge. Download/Pause/Resume occupy
  the same 116px slot, with More/Cancel in the adjacent 32px desktop / 44px mobile
  icon slot. Transfer controls use the existing neutral secondary surface.
- Clicking progress opens the existing dialog; pause/resume/cancel callbacks,
  cooldown, busy/disabled rules and backend state remain unchanged.
- Header cells own an inset bottom divider. The first body row no longer supplies
  that border, so scrolling cannot carry the divider away or duplicate it at rest.
- Existing UTC date columns and dd/mm/yyyy formatting remain intact.

## Validation

- `npm --prefix foundation_v2/web run build` — PASS.
- `node --test foundation_v2/web/tests/testingCopy.test.mjs foundation_v2/web/tests/dataLibraryModel.test.mjs`
  — 10 PASS.
- `git diff --check` — PASS.
- Independent browser script `independent/qa.mjs` — 7/7 PASS: dark/light at
  1710px and 360px with labeled transfer fixtures, two actual local GET-only
  journeys, and an English desktop fixture. Covers seven transfer states,
  saved updates, large byte/speed labels, fixed action slots, centered cancel
  icon, hover geometry, keyboard focus and dialog Escape focus return.
- Sticky header was checked with actual 250px vertical scrolling, with matching
  before/after geometry and divider screenshots in both themes.
- Parent inspected desktop actual/fixture, mobile light and both-theme header
  crops. The header divider persists and controls remain inside their columns.

Actual journeys blocked all writes, live routes, external origins and WebSockets.
No download, refresh, pause, resume or cancellation was sent to the real backend;
transfer states are explicit presentation fixtures, not claims about provider
throughput or full backend recovery. No service restart was needed.

Independent review and machine-readable checks: `independent/REVIEW.md`,
`independent/results.json`. Project contract updated in `ui/testing-standard.md`.
