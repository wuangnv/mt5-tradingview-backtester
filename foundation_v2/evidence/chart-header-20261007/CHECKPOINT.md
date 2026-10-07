# Chart header reference — 07/10/2026

The owner approved adding comparison (+), New Layout, Alerts and Editor to the
reference header, then explicitly excluded the FX Replay logo. Pending behavior
uses the owner's earlier authorization to build reference UI before its detailed
feature specification. This slice does not implement a comparison engine,
multiple chart layouts, alert execution or Pine Script compilation.

## Behavior and ownership

- Native chart controls remain library-owned. Official custom-button hosts carry
  React portals for the symbol/+ group, New Layout, session/save and utility tools.
- The four new panels are UI previews. Their fields/layout selection are local
  React state; execution is disabled and the status is explicit in VI/EN. Closing
  the panel discards its preview fields. No new server endpoint/storage is added.
- Existing Save chart keeps browser-local session/dataset/cutoff snapshots. PNG
  capture retains the client-only export and cutoff guards. Native theme and
  fullscreen remain functional. No vendor source or assets are modified.
- Header pause copy is removed; replay controls own playback state. Fit order
  moves beside order actions and calls the same native viewport operation.
- The header tail fills the right utility rail's top edge, continuing the native
  header to the viewport edge without covering its price scale. ResizeObserver
  follows the actual iframe width: at <=1100px the custom groups move to an
  overflow panel. Dock-open resizing also triggers this change.
- Overflow is portaled into the chart frame to escape rail scrolling/clipping,
  remains within the fullscreen app and closes on outside click/Escape across
  the top document and same-origin chart iframe. Dock focus restoration waits
  for iframe/host/compact widths to settle, then chooses a live visible opener.

## Verification

- Final web production build passed; 12 focused datafeed/storage/activity-clock
  tests passed. No backend change or broker test is part of this slice.
- Primary verify.mjs passed five actual-service GET journeys: 1710px dark VI and
  light EN, 768px dark VI, 390px light EN, and 1300px dark VI with dock shrinking
  the widget. Every preview panel opens/closes, execution stays disabled, panel
  focus returns and layout choices work. Parent overflow is zero and the closed
  header tail reaches the right viewport edge.
- Existing local save, PNG download, fullscreen enter/exit and reload passed.
  Native teal/red and disabled widget_logo remain correct; visible row count and
  causal cutoff remain unchanged. No page errors or unexpected requests.
- All browser QA activity POSTs returned labeled fixtures; other writes/external
  requests/WebSockets were blocked. No persisted session, order or cursor writes.
- Independent final review passed seven browser matrix cases (1710/768/390/360/
  1300, dark/light, VI/EN) and four edge cases covering both directions of dock
  focus restoration, keyboard Enter/Escape and a denied-fullscreen fixture.
  Fourteen focused Axe scans of new preview content found zero violations.
  Save/local PNG/actual fullscreen/theme/reload/iframe dismissal passed, with
  symbol, resolution, cutoff and shape count preserved. No page errors or
  unexpected requests. Nine final source/document hashes are pinned in its
  receipt. A pre-existing nested-aside landmark issue is separately disclosed;
  this does not claim whole-page WCAG acceptance.

## Resolved failures and limits

Primary diagnostics remain local: Windows URL-to-path conversion and an assumed
close-button translation were harness errors; the dock-to-native opener timing
failure was a product focus bug and was repaired before the final five-case run.
Independent review identified rail clipping and detached/temporarily hidden
openers; both are fixed. This is header UI acceptance, not pending-feature or
whole-product acceptance. Runtime remains UI 5180/API 8010; no service restart,
broker/MT5/provider access, order, cursor advance, upload or deployment was needed.
