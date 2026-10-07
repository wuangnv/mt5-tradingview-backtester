# FX Legacy chart polish — 07/10/2026

Scoped result: PASS for the owner's thirteen comments, with independent source and browser review. This is not whole-product or complete FX feature parity acceptance.

## Behavior and ownership

- FX has the floating quick-action toolbar; retain the single draggable Go To/Order/News/Journal group.
- The native header spans the viewport. Rail and desktop drawers start below its 38px row plus 4px separator. Native canvas and price-scale dimensions shrink with the drawer; header controls remain visible and hit-testable at the far right. At 600px or less, drawers overlay the chart to respect v23's minimum body width.
- Replay uses filled reference-style icons, grip, sixteen speed positions, separate replay timeframe and optional chart sync. Bar Replay selects a prior visible candle. Forward resolves the next occupied UTC timeframe bucket server-side; rewind uses the prior occupied bucket in the known prefix. Calendar/sub-dataset resolutions without support are disabled.
- An optional typed interval augments the existing replay request without changing old bar-count calls. Server traversal caps at 1000 bars and processes every intermediate execution bar. Historical forward is GET-only and clamps at canonical; one pending request and revision conflicts guard playback. Native interval survives historical chart remount.
- Suppress the pinned v23 Ctrl+zoom teaching hint in project-owned CSS; vendor distribution remains unchanged. Native CSS selectors require renewed verification on vendor upgrades.
- Buy/Sell labels are white. Quantity has one outline and a spinner. The center grip resizes positions; footer maximize expands positions below the header, while header fullscreen remains browser fullscreen. Floating controls stay above the expanded table.
- Analytics routes to the current session's analysis with its cutoff context. Wallet details use actual cutoff-safe equity/realized/unrealized values; unknown execution remains a dash and privacy masks all displayed values.
- Scalper shows disabled distance fields and %/Pips pills when switches are off. A saved local workspace/session preset prepares protective order draft prices before existing confirmation. It does not implement instant execution, Auto Break-even or new strategy creation.

## Research

Reference session was inspected through the owner's browser without replay/order/layout/cloud writes. Speed preference was restored, and the temporary Scalper panel dismissed without saving.

- [Bar-by-bar rewind](https://support.fxreplay.com/articles/how-to-use-bar-by-bar-rewind)
- [Bar Replay selection](https://support.fxreplay.com/articles/how-to-use-bar-replay---right-click-replay)
- [Scalper mode](https://support.fxreplay.com/articles/how-to-use-scalper-mode-for-faster-trade-execution)
- [Getting started / floating toolbar](https://support.fxreplay.com/faqs-categories/getting-started)

The source implements occupied UTC candle buckets for this dataset-driven replay engine. It does not claim access to FX's proprietary engine, ticks absent from the dataset, or exact cloud persistence behavior.

## Validation

- Production Vite build PASS.
- 29 focused backend interval/protection tests PASS; 14 interval cases independently rerun PASS, including gap navigation, canonical clamp, strict validation and protective fills on intermediate bars.
- 13 JS replay/scalper model tests independently PASS.
- `verify.mjs`: five actual-service GET layouts, 1920×940, 1611×1259, 768×987, 360×987 and 1710×987; dark/light and Vietnamese/English. Header/rail/drawer/canvas geometry and rightmost header hit-test PASS.
- `footer-verify.mjs`: three viewport/theme journeys, unknown actual execution plus labeled execution fixture. White labels, single outline, grip, positions maximize, balance masking, local preset reload and confirmation draft PASS.
- `replay-toolbar.mjs`: actual historical GET navigation and sync persistence; canonical request intercepted into slow/conflict fixture. Pause during pending response and revision lock verified, no owner session step/order writes.
- `replay-selection.mjs`: actual native canvas selection of a known prior candle; GET cursor500→340, selection clears, no writes.
- [Independent review](independent/REVIEW.md) and [final receipt](independent/final-receipt.json): PASS, five configurations, no page errors/unexpected writes.
- Local API restarted only after verifying its exact launcher identity. API8010 and Vite5180 serve200; imported-history launcher runs without MT5 synchronization.

### Embedded browser compatibility

The owner's Codex browser canceled v23's blob iframe navigation (`Network.loadingFailed: net::ERR_ABORTED`), while normal Chromium loaded it. The explicit `chart_iframe=srcdoc` URL option now loads the same library-generated local document and options hash through srcdoc; default blob transport and the vendor bundle remain unchanged. Codex navigation, reload, rendered native candles/header and opening/closing the compact Chart tools menu passed. Screenshot: `codex-srcdoc-chart.jpg`. This option is scoped to the URL, not a browser security setting or a new vendor version.

TradingView's current [featuresets](https://www.tradingview.com/charting-library-docs/latest/customization/Featuresets/) and [troubleshooting](https://www.tradingview.com/charting-library-docs/latest/troubleshooting/) describe iframe loading compatibility for embedded browsers. The pinned v23 bundle does not implement that feature; this adapter explicitly handles that version's generated document.

Early layout probes exposed mobile minimum-width clipping and invisible right controls despite correct bounds. Final fixes and hit tests are retained; initial failed probes were not treated as acceptance. The reviewer's initial pytest cwd was corrected before its successful focused run.

## Consistency with Testing — applied after owner follow-up

Live dashboard computed styles are in `testing-comparison.json`, screenshot `testing-reference-1710.png`. Testing controls use Inter13px/20px, pill radius, 140ms state transitions and project focus#7ABBE6; the pre-change chart snapshot used compact Arial12–14px, mixed4–20px radii, instant or100–120ms feedback and reference blue#5695FE.

The owner subsequently authorized this consistency slice and eleven further visual comments. App-owned dialogs/popovers/drawers now use the same Inter baseline and project hover/focus/disabled tokens, 140ms feedback and reduced-motion handling. Compact native chart dimensions, blue replay/scalper actions, turquoise/red candles/Buy/Sell and neutral chart surfaces are preserved.

Header separators now draw inside clipped v23 groups instead of outside; mentor has two separators and theme a right separator. Undo/redo stay left, session name centers in the remaining area, and layout/save controls end beside Quick Search without a separator inside the session group. Quantity hover/focus spans the one outer rounded outline. All six-dot grips use filled circles and normal text contrast. The owner asked to remove the quick-action toolbar entirely; its visibility setting and unused CSS were removed as well, while rail destinations remain.

Keyboard review also found hidden initial popovers could not receive focus. The popup is now visible before initial focus; selected enabled options focus correctly, disabled form fields are skipped, Tab leaving dismisses including browser-chrome transitions, and Escape/explicit dismissal returns focus appropriately. Compact overflow navigation uses the same keyboard rules.

Validation: production build PASS; `consistency.mjs` actual local GET UI at1920dark/light,1080dark and360dark PASS for separators/center layout, no overflow, quantity hover/focus, grips, selected menu focus/Tab/Escape, Scalper dismissal and reduced motion. Activity receipts are explicitly intercepted fixtures; replay/order mutations and remote requests are blocked. Early probes caught the hidden-focus bug and were repaired; an initial outline-width assertion was corrected to inspect outline-style, since prefers-contrast can set a width on an invisible `none` outline. Independent QA passed twelve dark/light/desktop/mobile configurations across default blob and optional srcdoc, with matching hashes for all nine source files. Its receipt is [consistency-review.md](independent/consistency-review.md), with final reports `independent/consistency-review.json` and `independent/consistency-default-review.json`, without overwriting the prior scope's receipt. The owner's actual Codex tab renders with the known explicit srcdoc option; its menu selected focus and Escape return were verified (`consistency-codex.jpg`).

## Positions and hover — second owner follow-up

The owner requested six additional corrections. Header and left drawing controls, replay actions and right/account utilities now have rounded hover geometry without changing control sizes. The two six-dot grips retain their contrast and drag/keyboard behavior but have no pointer-hover surface or color change. Keyboard focus stays visible.

The quantity control previously painted its own border plus a focus outline offset outside it. Its focus outline now merges with the same outer edge at offset -2px; input and spinner buttons do not paint separate focus outlines. This supersedes the earlier outline treatment, which was a double contour even after removing the input's ring.

Position tabs have top/bottom rules, text-only hover and an active underline spanning the entire button including its horizontal padding. The table header uses the existing project-raised token, which differentiates both dark and light themes. Pagination uses rows-per-page at the left and previous/page-select/total/next at the right, with a top rule and the footer at the viewport bottom in normal and maximized table layouts. Page/size changes remain local UI state over the existing execution rows; no replay/order storage contract changed. Extra currency/SIM text was removed from the pager; account details remain in their existing control.

Responsive QA reproduced the floating replay toolbar covering tabs on a maximized table. It is now hidden only while the positions table is maximized and restored with its existing position/state when returning to the chart. `positions.mjs` and `positions-report.json` verify the actual local GET UI with locally fulfilled activity receipts and blocked owner mutations/external requests. Independent review is recorded separately under `independent/positions-*`; earlier consistency receipts retain their original scope. Initial probes are retained, including the real tab-hover/toolbar-overlap failures and the corrected zero-width-border oracle.

Independent QA also reproduced v23's sampled telemetry branch (internal feature `14851`, enabled with a 2% random sample): it requested Google Analytics and parsed `document.URL` as HTTP, which throws for `about:srcdoc`. The widget now disables that branch using its existing feature configuration; vendor source is untouched. This fixes the observed intermittent iframe exception and keeps the local chart from issuing that telemetry request. Final review includes forced sampling on both blob and srcdoc, separately from the response-only pagination fixture.

## Maximized positions grip and restore icon

The owner's next report established that a disabled grip in maximized positions was undesirable. The grip is now enabled in both modes. Pointer down captures the pointer without changing layout; movement beyond 3px restores adjustable mode and resizes from the largest height allowed by the existing chart minimum. Subsequent movement keeps resizing until release/cancel. A simple click preserves maximized mode. Keyboard resizing also restores adjustable mode. The regular height limit is calculated from the current trading-bar height and chart minimum, rather than a desktop-only fixed reserve; this fixes the mobile wrapped-bar overflow reproduced by independent review.

The owner clarified that dragging fully upward must maximize across the entire viewport, including the chart header. Full upward drag or keyboard End now enters maximized mode; the maximized table starts at top=0 and covers chart/header. Dragging downward or restoring brings both back. Ordinary partial resizing retains the existing minimum chart space.

The maximize toggle now uses four inward corner brackets in maximized mode, matching the supplied restore-icon reference, instead of overlapping squares. The outward-corner icon in normal mode remains. Both changes are local UI state and do not write replay/order records. Primary `positions-drag.mjs` / `positions-drag-report.json` cover dark/light desktop and dark mobile drag, continuous resize, release, click-only preservation, keyboard restore/close/reopen and replay visibility. Independent drag review is stored separately under `independent/positions-drag-*`.

## Continuous drag into full viewport

The owner reported a hitch when dragging to the top. The regular height clamp left the grip stationary over the last 240px of pointer travel, then changed directly to full viewport; restoring also seeded drag from the smaller regular cap. The captured upward baseline in `positions-smooth-baseline.json` measures 203px maximum pointer/grip deviation. That baseline run subsequently failed when its downward probe encountered the old prematurely collapsed panel; it is retained as a failed before-change probe, not a passing test or a frame-rate benchmark.

The table now continues upward over the native chart after reaching its minimum-space limit. Its flow reserve keeps the native chart at its minimum height while the bar/table follow the pointer, without shrinking the chart to zero. Full viewport still covers the header; downward dragging starts at the actual full panel height. Bounds are cached for a pointer gesture and updates are batched to animation frames; pointerup flushes any final pending size, cancel/lost capture stops pending updates, and unmount cancels the frame. This supersedes the prior regular-height clamp behavior; it changes local presentation state only.

`positions-smooth.mjs` / `positions-smooth-report.json`: actual guarded local GET UI, dark/light at 1368×790 and 360×844, dense 10px trajectories up to full and back down. All four pass with 0px sampled grip/pointer deviation, full/header coverage, release and bottom paging checks. This verifies spatial continuity, not a universal FPS guarantee. Existing `positions-drag.mjs` regression passes 3/3 and production build passes. Independent review is recorded separately in `independent/positions-smooth-*`.

Independent review caught stale overlay reserves after a viewport-height change and a floating replay toolbar painting over the near-full table. A ResizeObserver now recalculates bounds on container resize outside a gesture; gesture end also measures current bounds to handle resize during a drag. Replay controls hide for both expanded overlay and full mode. The retained old regression now distinguishes regular mode (replay visible) from overlay mode (hidden). Failure diagnostics are retained separately by the reviewer.

Final independent review passes 4/4 dark/light desktop/mobile with matching hashes for both source files. It checks 0px sampled tracking deviation, full→down→full in one gesture, immediate pointerup before the pending frame, release/cancel/lost capture, keyboard, viewport shrink in expanded/full modes and during a gesture, and paging within the resized viewport. No page errors or unexpected requests. Receipt: [positions-smooth-review.md](independent/positions-smooth-review.md).

## Quantity hover follows the supplied reference

The owner's next reference separates input hover from spinner hover: the quantity input and its outer container stay transparent, and only the arrow under the pointer receives the existing project-hover background. Each arrow fills its right-side half-cell without inset gutters; the existing outer rounded clip contains that fill. Focus keeps the single outer contour, and disabled arrows do not highlight. This is a CSS-only change; quantity stepping and simulator/order state are unchanged. Production build passes. Independent scoped review passes 8/8 dark/light desktop/mobile, enabled actual local GET and disabled historical-view response fixture, with matching CSS hash and no page errors/unexpected requests. The prior consistency runner's input-hover assertion was updated to this latest reference. Receipt: `independent/quantity-hover-review.md`.

## Compact interval menu, selected timeframe and positions opening

Three follow-up comments identified separate presentation issues. The replay interval popover inherited the shared 264px width while its child was only 132px; a scoped rule now makes this menu 146px with rows filling the available content width. Other popovers retain their widths. TradingView already marks the current interval with its native isActive class, but the project palette made it nearly indistinguishable white text; a header-interval-only rule now renders the native active choice blue with the existing active background. Native timeframe ownership and behavior remain unchanged.

The positions chevron previously reopened the saved height without normalizing it, including 130px after a short drag. Opening now chooses the larger of remembered height, 260px and 40% of available table height, capped to the regular chart minimum-space limit. This keeps larger regular user sizes and avoids reopening a tiny panel; drag still permits smaller panels and full overlay behavior. Production build passes. Independent baseline/review are recorded under `independent/chart-compact-*`.

Independent review passes four dark/light desktop/mobile cases: native 1→5 selection (including the mobile native dropdown), active descendant color/hover, compact menu keyboard and 5m selection, first opening at 296px desktop/301px mobile, short-height normalization, larger dragged height remembered, maximize-collapse-reopen, chart minimum/footer/no-overflow. No page errors or unexpected requests; three source hashes match. Existing guarded positions-drag regression passes 3/3. The owner's Codex tab was reloaded because the existing native iframe retained its older stylesheet; actual selected 1m now computes blue #5695FE on #343434. Receipt: `independent/chart-compact-review.md`.

## Neutral chart chrome and shared Session Settings

The owner's seven new notes supersede the previous blue active interval and quantity focus. Native selected intervals now use neutral active text (white dark / black light) while keeping the native active state/background. Quantity keyboard focus uses the single neutral outer contour; input hover remains transparent and spinner hover remains local to the arrow.

Dark upper chrome, drawing rail, time axis, replay toolbar and right rail use #0F0F0F above the #000000 trading footer. Pane/candle/text opacity is unchanged. Drawing separators are inset 8px using scoped pinned-v23 selectors. Only the duplicate left `showObjectsTree` shortcut is hidden; the right app object tree is retained. Search, chart properties and screenshot form one group with no two internal vertical lines; surrounding boundaries remain.

The right Session Settings button has an inset divider and opens the existing SessionSettingsDrawer. Its name/description save uses updateSessionMetadata with the captured revision. Successful saves merge metadata and revision into the viewed record without replacing chart rows, cutoff or historical execution. Conflicts, missing records and uncertain saves block resubmission; closing refreshes the current record at the same viewed cutoff. This is session metadata editing, not chart-layout save or simulator execution.

Production build passes. `positions-smooth.mjs` regression passes four dark/light desktop/mobile cases with 0px sampled pointer/grip tracking deviation. The existing compact menu/positions runner was updated to the latest neutral interval oracle and passes 4/4 with no errors/unexpected requests. Owner Codex tab was reloaded for native iframe CSS; selected 1m computes white on #343434, right rail #0F0F0F, footer #000000. The shared settings dialog opens with the actual session name/description and returns focus on close. Proof: `chart-chrome-codex.jpg`. Independent seven-note review is recorded under `independent/chart-chrome-*`.

Independent review found a shared dialog tab-scroller issue on narrow screens: moving from the final tab back to the first with Home left part of its label clipped. After each selected-tab render, the dialog now scrolls that tab fully into view using nearest horizontal/vertical positioning, without animated motion. This applies to the reused session-page dialog as well.

Final independent review passes six actual local browser cases (1368×790, 1710×987, 360×844, dark/light) and three isolated metadata response fixtures (200/409/500), with no page errors/unexpected requests. It checks actual right object-tree behavior, the absence of an empty left shortcut slot, divider geometry, neutral focus and selected/hover text, all settings tabs, fully visible first tab after Home, Escape/focus return, and no horizontal overflow. The success fixture deliberately returns payload cursor9999: the historical DOM still displays cursor500, its original cutoff and 501 candles after save; failures block retries and closing refetches cursor500. PATCH/activity responses were browser-local fixtures; backend persistence was not exercised. Receipt with seven source hashes: [chart-chrome-review.md](independent/chart-chrome-review.md). Build and scoped UI/regression pass do not close unrelated product gates.
