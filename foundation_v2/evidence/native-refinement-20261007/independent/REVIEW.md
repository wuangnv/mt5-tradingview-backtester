# Independent native header refinement review

Scoped PASS on final frozen source. `final-receipt.json` pins12source files and states limits.

Actual service matrix5PASS: dark1710VI, light1710EN, dark768EN, light360VI, dark1300VI. Native `header_widget` remains enabled. The library renders interval/style/indicator/undo/settings controls;5application extension hosts come from official `createButton`, with no recreated application header row. Every visible application extension fits the iframe and receives its center-point hit test.

FX extension previews open/close with keyboard focus restored. Dock starts below the native header at every width. Compact768→1710 menu resize restores visible iframe focus. Native interval favorite/dropdown changes to5m; replaybar and API agree. Replaybar selection15m updates native header/bar/API and the native legend repaint settles at15; symbol/cutoff/visible-row count stay unchanged.

Native settings dialog opens at every width. Mobile360VI/tablet768EN overflow opens the actual native Indicators dialog. Undo/Redo are present and wired to official chart actions. Sync switch is disabled with unsupported-state labeling. Final replaybar has no horizontal overflow: mobile outerclient/scroll252/252, content220/220; desktop395/395, content363/363. Quick actions no longer overlap replaybar. Visible price-axis bounds end exactly at iframe width. Footer has Buy/Sell/Scalper controls and no redundant Trade/SIM.

Focused Axe5scans of the application extensions:0violations. Independent advanced chart unit suite7PASS. No page errors or unexpected requests.

Reviewed original FX reference `codex-clipboard-8737fcc4-4ea1-446d-90d6-47d3eec42fdf.png` and final dark desktop/light mobile screenshots. Native toolbar ordering, drawing rail, price-axis area, replay controls and footer composition match the intended reference structure. WMReplay retains its own session/dataset labels and deliberately omits the FX logo. This is not a pixel-identical copy claim.

## Findings and failed attempts

Independent WIP review found mobile header extensions outside iframe, the active native interval incorrectly hidden, quickactions overlapping replaybar, and mobile replaybar overflow. Root corrected header density, responsive specificity, separate quickbar default/preference key, slider sizing and absolute checkbox margin. A later screenshot exposed a genuine synchronization race: the interval event published old `chart.resolution()`; root now consumes its string interval argument. Final5→15 assertions pass.

Compact resizing originally dropped menu focus; root restores a visible iframe opener. Native interval clicks do not emit `widget.mouse_down` (diagnostic `pause-probe.mjs`); root added native-header capture listeners for pointerdown/keydown and removes them during teardown. Reviewer checked this source wiring, without starting actual autoplay.

Indicators/Undo/Redo were missing when native mobile groups hid. Root added official actions to overflow and reused translated `Indicators` copy for EN/VI. The observed native interval dropdown uses `item-...` on768 and `smallWidthMenuItem... item-...` on360; early harness width/MenuItem assumptions failed. Retained `attempt1-native-adaptive-oracle.json` and `attempt2-native-menu-oracle.json` are harness diagnostics, not product defects. `attempt3-mobile-checkbox-sync.json` records the WIP overflow finding; all final strict assertions remain enabled.

## Data/state and acceptance limits

Native header controls remain vendor-owned. React renders only the FX-specific extensions into official hosts; menus outside iframe listen in both documents. Application controls use the published ready native chart API. Interval publication consumes the event value to avoid a stale controlled dropdown. Replay datafeed continues to aggregate only the visible causal prefix.

All browser runs allow localhost GET/HEAD/OPTIONS only, block WebSockets and external origins, and intercept only the exact session activity endpoint as a labeled fixture. No reviewer source edits, stage/commit, restart, actual session write or broker operation occurred. Reference diagnostic scripts are distinct from final guarded matrix evidence.

Focused extension Axe does not certify native vendor/whole-page accessibility. Existing positions and other pages retain earlier scoped receipts. Compare/Layout/Editor/Mentor remain previews. Parent primary6cases/build and IAB readiness investigation are separately owned; this independent Playwright PASS does not certify the IAB tab or whole-product completion.

Parent runtime limitation: both the existing and a fresh localhost IAB tab kept a blank/about:blank chart iframe, while the external FX reference loaded. Parent traced bundledv23 Blob/createObjectURL behavior without an observed iframe_loading compatibility feature. No vendor modification or architecture bypass was introduced. Final native UI acceptance here is the guarded Playwright service matrix; IAB chart readiness remains unresolved and separately reported.
