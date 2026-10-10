# Data-state preview — 10 October 2026

Replaces the sample-data toggle with the shared FxSelect control: real data, sample data, loading, empty, error, unavailable, denied, filtered-empty, refreshing, stale, partial and unknown. State definitions are shared with the UI reference.

Preview is URL presentation state (`demo=1`, optional `ui_state`). Preview replaces the real page reader and disables workspace event subscriptions. Returning to real clears preview parameters while preserving owner session/filter context. No new API, dependency or data mutation is introduced.

Loading/empty/error replace the dependent content group. Refreshing/stale preserve sample content. Overview partial uses two of three sample sessions and 40 closed trades; unknown uses all three sessions and 60 trades but leaves unknown practice/replay durations as `—`. Partial/unknown are disabled on other pages until representative fixtures exist. Chart and order-entry surfaces remain excluded.

## Evidence

- Focused Node tests: 16 passed (preview context, navigation, fixtures and surface boundaries).
- `browser.json`: 88 cases passed. Overview states at 1440/390/360/320px, dark/light; eight additional pages loading → sample. No page errors, preview API requests or writes. Mutating requests and external origins were blocked.
- Browser journeys cover retry, history, reload, return to actual local GET data, preserved shell/rail/header, menu viewport fit and ledger direct-child/scroll layout.
- Production Vite build passed, output under `.runtime/ui-state-preview/dist` (not committed).
- Independent review: `/root/state_preview_review` approved scoped source/visual/a11y review; independently checked keyboard navigation, disabled states, 390px menu fit and loading persistence across page navigation with all API requests blocked.
- Selected screenshots show the menu, partial dashboard, unknown metrics and mobile error. Full local screenshot matrix is alongside the report.

These are simulated states using deterministic fixtures and product components. They do not establish that every live backend resource generates each state. Real mode was checked against current local GET services. The previously reported route-boundary error was not reproduced after service restart; its cause remains unconfirmed.

## Follow-up: shared status placement

The preview status now sits immediately left of the state selector in the shared subnav action on all supported pages. It no longer consumes a separate row above page content. On narrow screens the controls use their own subnav row, keeping full-width navigation; the status uses two compact lines with truncation for long labels. Real mode has no preview status. The 88-case browser matrix covers 1440/390/360/320px with placement, centre alignment, useful navigation width and selector viewport checks, including all eight additional pages. Independent review caught the initial mobile navigation compression; the final checks cover that regression.

Independent re-review at 320/360px passed: navigation widths 226/266px, selector within viewport, preview status left of the selector, and stable content top when switching to real. Production build passed after the responsive fix.

Visual review also caught the menu clipping under the sidebar at 320px: a select in subnav was using viewport bounds, unlike selects within page content. FxSelect now includes the main shell as its nearest clipping boundary. Browser assertions check the menu's left edge against the main shell, not just viewport bounds.

Final independent approval verified unclipped labels at 320/360px (menu left 70px), Escape, status placement and real mode. The final 88-case run and production build passed after the menu fix.
