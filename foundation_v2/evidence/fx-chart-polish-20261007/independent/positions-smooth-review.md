# Independent smooth positions drag review — 2026-10-07

PASS on the two source hashes in `positions-smooth-review.json`: LegacyTradingBar.jsx and LegacyTradingBar.css. This receipt covers the changed drag model; earlier receipts remain historical.

Four isolated guarded browser cases: dark/light at 1368×790 and 360×844. Actual local GETs; activity requests fulfilled with nonpersistent matching receipts, all other mutations/external requests blocked, WebSockets closed. Reviewer made no product-source edits or commits. Final report has no page errors or unexpected blocked requests.

## Verified behavior

Each trajectory starts with a normal positions panel, drags upward through the former minimum-chart boundary and on to y=32px, then crosses into full maximize. Sampled grip-to-pointer error was 0px in all four cases in both directions. Chart layout stays at or above its 240px minimum while the expanded table slides over it; there is no grip plateau at that boundary.

Crossing full maximize, dragging down and returning to full all worked within the same pointer gesture. Full mode covers the chart header. Expanded/full mode hides the replay toolbar; regular mode restores it. Near-top expanded screenshots were visually reviewed and no floating replay control remains above the table.

Actual mouse down/move/up verifies normal release stops resizing. Cancel and releasePointerCapture verify further movement stops. A synchronous dispatched pointermove/pointerup pair explicitly tests committing the pending value before requestAnimationFrame flush; no final-position loss occurred. Keyboard ArrowDown restores by 30px, End maximizes and Home collapses.

Viewport shrink passes while expanded, while full, and during an active gesture followed by either pointerup or pointercancel. Footers remain within the new viewport and full footer reaches its bottom; document horizontal and vertical overflow remain zero. Current layout bounds are recomputed when a gesture ends, while move updates retain cached gesture bounds.

## Findings resolved during review

`positions-smooth-attempt1-viewport-resize.json` records an initial expanded-mode viewport shrink leaving the footer at y=788 after a 790→690 viewport change. Root added a replay-main ResizeObserver and current-bounds normalization when ending a gesture; final shrink cases pass.

`positions-smooth-attempt1-overlay-toolbar.png` records the replay toolbar floating over the expanded table. Root extends toolbar hiding to expanded mode; final near-top screenshots confirm it is absent.

Source review supports the tested behavior: requestAnimationFrame coalesces move updates; pointerup commits the latest requested value; cancellation/lost capture discard pending motion and normalize the committed layout; unmount cancels scheduled work. The native chart keeps a minimum layout reservation and the table/bar overlay handles the remaining upward travel.

## Evidence and limits

`positions-smooth-review.mjs` is the reproducible guarded runner. The JSON records each trajectory, geometry, cancellation/keyboard/resize outcome and exact source hashes. Eight final near-top/resize screenshots are saved beside the receipt. Representative desktop dark near-top and mobile light resized screenshots were inspected directly.

The 0px result describes the sampled geometry after animation-frame settling. It is not an FPS, latency or universal smoothness benchmark. Pointer movement trajectories use actual browser mouse input; the precise pending-frame and cancel cases dispatch DOM pointer events intentionally. Execution, owner playback/orders, external FX behavior and download/clipboard are outside this slice.
