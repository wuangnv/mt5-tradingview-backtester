# Independent chart-control consistency review — 2026-10-07

PASS for the current app-owned control consistency slice. This receipt is separate from the earlier FX-polish and optional-srcdoc receipts; it does not renew their broader behavior claims.

## Scope and safety

Reviewed the owner session using actual local GETs, isolated Chromium contexts, both default blob and optional `chart_iframe=srcdoc`, and dark/light at 1920×987, 1080×987 and 360×987. All non-read requests were blocked, except replay activity receipts fulfilled locally with the matching event id and accepted interval. WebSockets were closed. No owner replay step, simulated order, session activity persistence, broker action or external FX change occurred. Context-local preference and Scalper draft edits were discarded.

`consistency-review.mjs` produces `consistency-review.json` for srcdoc, and `CHART_REVIEW_TRANSPORT=blob` produces `consistency-default-review.json` for the default route. Both contain matching SHA-256 hashes of the nine reviewed source files after the final compact-menu focusout and nested-dock typography changes. They also record styles, geometry, keyboard outcomes, page errors and blocked requests.

## Verified behavior

- Twelve configurations passed: six for each iframe transport. No page errors, unintended requests or document horizontal overflow.
- Native header reaches the full viewport width. Right utility rail begins at y=42 beneath it. Far-right hit testing reaches Fullscreen at 1920 and the compact tools button at 1080/360.
- Session name is centered in its desktop group. Header separator pseudo-elements are placed at group left=0; first market group has none. Representative desktop dark/light screenshots show coherent groups and no new overlap.
- Quick actions toolbar is absent. Replay and positions grips each contain six filled circles; keyboard ArrowLeft moves the replay toolbar.
- Quantity group changes border on hover and exposes one group focus outline. Its input has outline-style:none, so a inherited 3px outline-width is not a visible second ring.
- Reopening replay interval focuses the selected 5m option. Home focuses 1m. Shift+Tab and Tab from the last item close the popover. Escape returns focus to the opener.
- Scalper number input uses the project focus ring. Discard closes the settings and restores focus to the Scalper opener.
- Compact tools menu focuses its first item, End reaches the last item, and Tab out closes it. Native capture popover opens and dismisses by Escape at all widths.
- App popovers use the canonical project palette, Inter 13px/20px, shared hover/focus states and 140ms transitions. Reduced-motion computes transition-duration=0s.

## Findings resolved or corrected during review

The selected-menu focus defect was reproduced: popup placement initially kept the node hidden while focus was attempted. The root implementation now makes it visible before initial focus. A scoped focusout handler handles leaving the last item, including browser-chrome focus. Both paths pass in the final six-case run.

The first quantity test incorrectly treated nonzero outline-width as a visible outline. Inspection established outline-style:none on the input; the final assertion tests style, alongside the outer 2px ring. No double-focus source fix was needed.

Earlier attempt JSON files remain diagnostic evidence. The two final reports are the PASS receipts for this slice.

## Visual evidence and limits

Reviewed `consistency-chart-dark-1920.png`, `consistency-chart-light-1920.png`, `consistency-chart-dark-360.png` and `consistency-scalper-light-360.png` directly. All six chart and six Scalper screenshots are saved beside this file. At 360px the footer intentionally wraps and the compact header omits the long session name. Disabled Scalper fields remain muted as state indication.

This review does not exercise owner playback/execution, download/clipboard permissions, external FX behavior, or claim pixel-identical TradingView/FX UI. Existing model/backend receipts remain historical. No source edits or commits were made by the reviewer.
