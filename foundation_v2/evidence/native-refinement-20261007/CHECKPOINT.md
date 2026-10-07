# Native Legacy chart correction — 07/10/2026

Scope: owner-approved correction of the existing Legacy chart UI after review against FX Replay. This receipt accepts the scoped Chromium UI change, not the entire product or broker/data gates.

## Result and ownership

The pinned Advanced Charts v23.040 distribution now renders its native header controls and menus. Five official createButton hosts receive React portals for application-only actions: market, layout, session, search and tools. Native intervals/chart style/Indicators/Undo/Redo/Settings are no longer recreated in a React header. A fullscreen cap in the right rail completes the top row through the viewport edge, with a 4px divider. The chart and price scale retain their full allocated width; the dock overlays below the header.

The API still owns the session/cutoff/execution snapshot. Header interval changes aggregate the same visible causal prefix; they never advance replay. The interval event payload synchronizes the replay-bar selector, avoiding an old resolution read during the native event. Native pointer/keyboard capture pauses replay before toolbar actions. Local saved layouts retain their viewport; otherwise TradingView uses its default viewport.

Replay order is grip/reset/speed/previous/play/timeframe/next/sync. Quick actions begin below the replay bar. Mobile controls fit without horizontal clipping; overflow exposes Indicators/Undo/Redo and app controls. Outside click/Escape and resize restore focus across iframe/main-document boundaries. Checkbox margins no longer create a 4px hidden hitbox overflow. Footer removes redundant Trade/SIM text while order ownership remains simulated. Alerts and FX logo remain absent; widget_logo stays disabled under owner-confirmed rights.

Compare, multi-layout, Editor, Mentor and Scalper remain explicit previews. Mentor has no provider transmission. Save remains browser-local and PNG client-only. Timeframe sync remains disabled. Existing palette and data/execution/cutoff guards are unchanged.

## Reference and validation

Reference: direct read-only inspection of the owner's FX Legacy session, plus C:/Users/MIIKEY/AppData/Local/Temp/codex-clipboard-8737fcc4-4ea1-446d-90d6-47d3eec42fdf.png. Identified AI Mentor sparkle and Scalper rocket separately. No FX play/order/cloud-save/provider action was performed.

Primary: node foundation_v2/evidence/native-refinement-20261007/verify.mjs — 6/6 PASS (1710 dark VI,1273 dark EN,768 dark EN,390 light EN,360 dark VI,1710 light EN). Actual local service GET, isolated activity fixture, every other write and websocket blocked. Verified native IDs and API actions, visible header bounds, full row/price scale, no scrollbar/toolbar overlap, preview dock width/top, Settings, native 5m and replay 15m synchronization, local Save, unchanged cutoff and no JS errors. report.json and screenshots retain evidence.

Independent: independent/review.mjs and independent/report.json — separate reviewer checks the same native controls, mobile Indicators, keyboard/resize focus, cutoff/prefix preservation and scoped axe over application extensions. Its final receipt owns that review conclusion; scoped axe does not imply whole-vendor WCAG acceptance.

Final source: npm run build PASS; node --test tests/advancedChart.test.mjs tests/replayActivityClock.test.mjs — 12/12 PASS. git diff --check PASS. Health/server/session GET verified; API started without broker connector.

Failures resolved: adaptive native interval menu selectors differed from the desktop favorite; fixed test oracle based actual visibility. Mobile range cascade and default checkbox margins caused clipping; fixed source. Early interval read caused replay selector to lag chart; fixed event payload. English overflow Indicators reused the existing translation. Fullwidth iframe plus overlaid rail was rejected during development because it clipped the price scale; current cap preserves native widget width.

## Limits

Native vendor versions/icons and genuine labels/data differ from FX; this is structural/workflow alignment, not pixel identity. CSS group ordering is pinned to v23 and must be revalidated on upgrade. Panel overlay deliberately preserves chart/header geometry.

Codex in-app browser verification did NOT pass: existing and fresh local tabs left the chart Blob iframe at about:blank and timed out; screenshot API also failed. FX reference remained readable in the same browser. The shipped v23 loader unconditionally uses createObjectURL and exposes no tested loading compatibility option. No vendor edits or browser security bypass were made. Chromium matrix results remain separate from this unresolved in-app browser limitation. The temporary local tab was closed; the user's original local tab remains open. final Chromium screenshot is provided for review.

Source hashes: source-hashes.json. This checkpoint does not modify project ledger/STATE or shared UI foundations.
