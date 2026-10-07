# Independent positions restore/drag review — 2026-10-07

PASS on the three source hashes recorded in `positions-drag-review.json`: ChartIcon.jsx, LegacyTradingBar.jsx and LegacyTradingBar.css. This receipt supersedes earlier positions receipts only for the changed maximize/restore geometry and grip behavior.

Four isolated real-GET browser cases passed: dark/light at 1368×790 and 360×844. No product source edits or commits by the reviewer. No persisted replay steps, orders, activity or external FX changes; activity requests were fulfilled with matching browser-only receipts, other writes/external requests blocked, and WebSockets closed. Final page errors and unexpected blocked requests are both empty.

Verified the restore SVG path consists of four inward corner brackets. A maximized table starts at viewport y=0 and owns hit testing at (20,20), covering the full chart header. Its grip remains enabled and unchanged on hover. Clicking the grip alone or moving only 2px retains maximized mode.

Actual Playwright mouse down/move/up sequences verified dragging down more than 3px restores normal mode and the replay toolbar. Continued downward movement decreases panel height; reversing upward increases it. Releasing ends the resize, a second drag works, dispatched pointercancel stops further movement, and a new actual drag after cancellation works. Keyboard ArrowDown restores, End maximizes and Home collapses. Dragging a normal panel to the viewport top maximizes; dragging down again restores.

The footer fits inside the viewport after restore, including the largest regular mobile panel. It stays at viewport bottom in full maximize. Representative desktop-maximized and mobile-normal screenshots were viewed directly; all eight final screenshots are retained beside this receipt.

An earlier visual review found the static available−292 cap left the mobile footer 40px outside the viewport because the mobile trading bar wraps. `positions-drag-attempt1-mobile-cap.json` preserves that diagnostic checkpoint. Root now computes bounds from actual trading-bar height and chart minimum; final footer assertions pass. Owner steering also expanded full maximize from y=42 to y=0 and made drag-to-top/End enter maximize; the final tests use those semantics.

Limits: pointer cancellation is deliberately dispatched as a DOM PointerEvent to exercise the cancel handler; pointer down/move/up, continued dragging and reentry use actual browser mouse input. This slice does not re-certify execution, SL/TP, owner playback, fullscreen API, external FX behavior or download/clipboard. Source hashes identify the exact checked checkpoint.
