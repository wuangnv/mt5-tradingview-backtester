# Chart header: independent review

Scoped PASS on final source. No remaining actionable header defect.

Seven matrix journeys cover dark/light, Vietnamese/English and 1710/768/390/360/1300 widths. Four additional cases cover a 1300px dock changing native controls to overflow and back, mobile persistent opener focus, keyboard Enter/Escape, and explicitly denied fullscreen. Fourteen Axe scans of the new preview content have zero violations; final journeys have zero page errors or unexpected requests.

Compare (+), New Layout, Alerts and Editor open clearly labeled UI previews. Fields and local layout choice respond; execution actions stay disabled. Editing text and using ArrowRight/Control+Enter cannot step replay or produce a write. Closing panels restores native or persistent overflow focus, including the intermediate width that changes mode while the dock is open. The compact menu accepts pointer clicks, dismisses on Escape and native iframe outside clicks, and remains available inside actual fullscreen.

Existing Save chart stores the local layout; PNG export generates a local client download; fullscreen enters/exits the app; theme persists through reload. Native control groups appear once after reload. The tail aligns with the native header across the right rail. The actual chart's symbol, resolution, cutoff, visible rows and shape count stay unchanged through reference panels. Header contains no paused status or Fit order button; no FX logo was added.

Source review covered panel-only state/key ownership, disabled actions, cross-document portal/focus routing, ResizeObserver teardown and cancellation, compact-mode agreement, iframe listener cleanup, official native header slots, and preservation of client-only screenshot/save behavior.

Resolved defects: the first overflow menu was clipped by the rail and could not be clicked; menu openers detached on close; native dock openers could still be hidden when focus was restored; stale compact state could focus overflow just before it disappeared. Final independent tests exercise each repaired transition. A duplicate translation key was also removed.

All browser activity POSTs are labeled fixtures. Other writes, external requests and WebSockets are blocked; this reviewer did not restart services, touch broker/MT5, edit product source, stage or commit. Actual fullscreen success and preview/local state are distinguished from the denied fullscreen fixture. Root's build/unit/primary QA results are separate evidence.

Accessibility scope is bounded to new preview content. Initial whole-dock scan found the pre-existing `landmark-complementary-is-top-level` on `.replay-side` inside `main`; retained in `report-attempt1-existing-landmark.json`. This focused PASS does not certify whole-page accessibility or whole-product completion.

Diagnostics retained: `probe-attempt1-menu-clipping.json`, `report-attempt2-dock-focus.json`, `report-intermediate-focus-pass.json`, `probe-attempt2-canvas-hit-oracle.json`, and `edge-attempt1-mobile-overlay-oracle.json`. The latter two corrected test targeting: a stacked native canvas is not necessarily the hit target, and the mobile dock intentionally covers header controls until it closes. Final script uses physical chart coordinates and the actual mobile close/open journey.

Final receipt pins eight implementation files and `ui/workspace-patterns.md`. Matrix screenshots record the opposite theme after toggle/reload; editor screenshots record the initial theme while preview is open.
