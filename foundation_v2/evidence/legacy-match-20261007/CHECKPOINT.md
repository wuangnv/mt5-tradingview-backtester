# FX Replay Legacy reference match — 07/10/2026

Scope: owner-requested Legacy chart refinement and stronger project-wide palette.
Alpha, broker/provider execution and whole-product acceptance are outside this receipt.

## Reference and resulting behavior

The owner-provided image and read-only inspection of the owner's FX Legacy session
identified the header, drawing rail, right rail, floating replay/quick-action bars
and footer. No Alerts appears in the reference. AI Mentor is the sparkle icon;
the rocket beside quantity is Scalper mode. The replay toggle is timeframe sync.
All referenced icon roles were resolved; no FX logo is added.

The chart now uses one application-owned 40px header spanning chart and dock.
The vendor header and separate header tail were removed, avoiding cross-document
portal and sizing conflicts. Supported intervals, chart styles, Indicators,
Undo/Redo, Settings and Object tree call the existing official widget API.
Mobile actions remain reachable through overflow. Menus dismiss from top document
or chart iframe and restore visible keyboard focus after resize.

Native drawing and scale controls remain; replay and quick actions are draggable.
Quick actions can be hidden and restored. Buy/Sell stays simulator-owned. Footer
balance visibility and position expansion use local UI state. Positions read the
cutoff-safe execution snapshot: open/pending state and protective-fill ledger rows.
Unavailable execution remains unknown; unknown commission/SL/TP stays a dash.
Pagination is local to that snapshot. Position tabs and table scrolling support
keyboard navigation.

Compare, multi-chart creation/layout management, Editor, AI Mentor and Scalper
are explicit UI previews. Mentor does not send data. Timeframe sync is disabled:
chart interval changes aggregate the same causal prefix, while replay steps use
the dataset interval. Save/restore is browser-local; PNG export is client-only,
guarded by generation/cutoff/interval. Owner-confirmed logo-removal rights are
implemented through `widget_logo`, without editing the vendor distribution.

Project semantic colors now use neutral dark canvas #080808, white text #FFFFFF,
strong peach #FFAD7C, sea blue #7ABBE6 and green #72CFA1. Light uses white canvas
and #111111 text. Report series have stronger colors; trading chart has independent
#0F0F0F pane, black chrome and #26A69A/#EF5350 candles. Canonical values and roles
are documented in `ui/project-palette.md` and `ui/workspace-patterns.md`.

## Verification

- Final `npm run build`: PASS. Focused advancedChart/activity-clock tests: 12 PASS.
- `verify.mjs` / `report.json`: 5 chart configurations (1710 dark VI/light EN,
  768 dark VI, 390 light EN, 1300 dark VI), native palette/logo option, header
  geometry, previews, save/PNG/fullscreen/reload and cutoff preservation PASS.
- `pages.mjs` / `pages-report.json`: 20 demo-page configurations across dashboard,
  sessions, trades, analytics, data, live and settings; dark/light and selected
  390px pages. Token propagation/no horizontal overflow/no pageerrors PASS.
- Independent `REVIEW.md` and reports: native interaction matrix 5 PASS,
  readiness 3 PASS, position fixtures 8 PASS, palette 10 PASS. Scoped Axe checks
  pass, including mobile table scrolling and neutral/semantic color contrast.
- Desktop chart/quickbar, mobile chart and project-page screenshots reviewed.
- Existing local UI5180 and API8010 health respond HTTP200; no server restart.

Browser QA allows actual local-service GETs, fulfills activity POSTs as labeled
fixtures, and blocks other writes and external requests. No real replay stepping,
orders, cloud saves or provider calls were made. Position fixture evidence is
separate from actual session data, which has unavailable execution at cursor500.

Limitations: matching the Legacy composition/colors does not make pinned Advanced
Charts v23 pixel-identical to FX's vendor version. The whole dock has a preexisting
landmark-placement issue outside the scoped Axe checks; this receipt does not claim
whole-page WCAG or whole-product completion. Shared UI foundations are unchanged.
Source hashes and independent review pin the verified source; build/cache and
unrelated historical artifacts are excluded from the commit.
