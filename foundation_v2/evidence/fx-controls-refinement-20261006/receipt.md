# FX controls refinement — 06/10/2026

Scope: the owner's 15 current Dashboard/Sessions/Trades/Analytics UI comments. Baseline product `8a10c15`, parent `42e44bd6`. This receipt accepts this UI slice only; existing whole-product, broker and production gates remain separate.

## Result and state flow

- Dashboard and Sessions expose Archive/Restore and Delete directly as circular SVG buttons. Existing confirmation, exact-name delete gating, revision handling and recovery remain intact. Demo actions remain local.
- Session picker lists actual sessions without a selectable placeholder; a missing current catalog entry is disabled. Dashboard All/reset choices have explicit names. SessionFilter checkbox rows are buttons, so their entire width responds to pointer and keyboard input.
- Trades Columns, Reset columns and Details have fixed square hit areas and circular corners. Pagination aligns number and chevron. Sessions metric information uses SVG; Analytics child tabs have rounded hover surfaces.
- Type has a searchable All/App/Battles/Prop Firm checklist. App means a Sessions report, Prop Firm means a Prop report. `report_kind` belongs to the report context, independently of trade `entry_type`. Selection filters the current report, without fetching or silently relabeling another source. Battles is visibly unavailable; Research remains available on its existing research report route.
- Time has minute-resolution Start/End inputs. Filters use the closing timestamp in the selected IANA timezone, include both boundary minutes, and support ranges across midnight. Missing timestamps do not pass an active time filter. Existing hourly URL filters remain readable; changing Time clears the old single-hour filter.
- Timezone shows searchable city names and current offsets; historical filtering uses IANA timezone rules. Backtesting Date has a month calendar/range inputs and retains the existing UTC closing-date definition.
- Filter selections remain draft until Apply. Clear resets the applied scope. Real URL scope survives report remounts; exports use the same filtered rows. Removed the requested report scope text.

The implementation reuses FxSelect, SessionFilter, SessionActions and existing analytics calculations. The shared Time/Date popover has a single surface and viewport positioning that excludes the native content scrollbar width. No dependency or shared global UI layer changed.

## Scrollbar root cause

Native scrollbar pointerdown was inside the popup, but Chromium moved focus from its search input to the outer `.fx-content` ancestor. The old blur handler closed the popup. Focusable scroll containers (`tabIndex=-1`) keep native scrollbar focus inside the popup; Escape, Tab outside and outside pointer dismissal still work. Dropdown scrollbars also have a stable, usable gutter.

Playwright's default headless `--hide-scrollbars` hides native tracks even when the gutter is reserved. The current regression and independent review explicitly omit that launch argument to test native track clicks and thumb drags. Final native scrollbar assertions use real mouse interaction and scrollTop changes, without injecting DOM styles. Earlier failures/oracle investigations remain in the local evidence directory and are superseded by the final reports.

## Verification

- `node --test tests/tradingAnalytics.test.mjs tests/journalAnalytics.test.mjs tests/analytics-story.test.mjs`: **22 passed**. Includes minute boundaries, midnight wrapping, timezone conversion, invalid URL values and Type/source separation.
- `npm run build`: **PASS**. Existing Vite large-chunk warning remains.
- `node tests/controlsRefinement.browser.mjs`: **7 journeys passed**, including four popovers at 360/768/1440 in light/dark, native track/thumb/wheel, Tab outside, draft/apply/reset, calendar range, full-row All, icon geometry and actual picker/info icons.
- Updated SessionActions/browser recovery and Dashboard refinement harnesses: **4 + 11 + 7 journeys passed**. Actual mutations are blocked or intercepted; recovery mutations do not reach the service.
- Independent review: **31 checks passed**, source pins stable, no page errors or non-GET requests, actual catalog records unchanged. Includes 24 route/theme/width cases, read-only actual journeys and separately labeled synthetic large-catalog scrollbar cases.
- Scoped accessibility: **10 scans**, no reported violations. Automated contrast/attribute checks include incomplete results; this is not whole-product WCAG acceptance. Independent keyboard/focus journeys pass.
- Representative screenshots were visually inspected. At a short mobile viewport, the calendar scrolls internally to keep all controls available. The pre-existing Analytics report has 11px of content horizontal overflow at 360px with visible native scrollbars; these popovers fit the client area and add no overflow.

Final reports: `primary/report.json`, `session-actions/browser.json`, `recovery/recovery.json`, `dashboard/report.json`, `independent/report.json`, `independent/accessibility-report.json`. The executable independent harness is `independent/review.mjs`.

Real workspace verification used GET/HEAD/OPTIONS and canceled dialogs. No actual session was archived, restored, edited or deleted, and no terminal/broker was started.
