# Independent legacy chart and palette review

Scoped PASS on final frozen source; source hashes and exact scope in `final-receipt.json`.

- Actual native chart matrix: 5 configurations, widths 360/768/1300/1710, Vietnamese/English, dark/light. Full-width header and every visible header control hit-test pass. Preview tools open/close, settings opens on desktop/mobile, iframe clicks dismiss menus. Native5m and Line preserve symbol, cutoff and visible rows. Footer balance and positions toggles preserve cutoff; actual missing snapshot remains unknown. Quick actions moves12px by keyboard and hides below900px.
- Readiness fixtures: 3 checks. Native controls disabled before ready, open style choices disabled if controls disappear, resize1710→360+Escape restores visible overflow focus.
- Positions fixtures: 8 checks across dark1710/light360. Open/pending quantities0.001/0.002 and eight-digit SL/TP retained; BAR entry joins and unknown fee preserved; tick snapshot SL/TP/zero commission preserved; rejected ledger events excluded. Keyboard tabs and26row paging10/10/6, size25 reset work. Null execution states unavailable at cutoff.
- Actual readonly palette: 10 checks across Dashboard/Trades/Analytics/Market data, both themes, mobileDashboard and reload. Computed canvas/text/semantic positive/negative match the final palette; no outer horizontal overflow. Focused contrast scans pass.
- Focused Axe: 17 scans,0 violations (header5, positions2, contrast-only pages10). Advanced chart unit suite:7PASS.

No product source edit, commit/stage, backend restart, broker access, actual activity storage or replay/execution write by reviewer. Every browser blocks WebSockets and non-local origins. Exact current-session activity POST is intercepted as `legacy-independent`; vendor analytics GET is blocked separately.

## Findings resolved and harness diagnostics

Independent review identified light Editor/Mentor contrast, missing mobile native actions/copy, CSS specificity defeating responsive hide, focus restoration to hidden style opener, fractional quantity/tick metadata loss and missing tab navigation. Root fixed each before final QA. Positions then exposed `scrollable-region-focusable`; root made its horizontal table focusable. Initial same label on nested regions exposed `landmark-unique`; root changed inner label to selected position tab. Both scoped Axe cases now pass without suppression.

The mobile native settings title is the selected tab “Mã”, so an earlier localized `Chart settings` heading oracle failed despite an open native dialog. Final test uses observed vendor `data-name=series-properties-dialog`. Isolated position fixture initially loaded a second locale context module; final harness imports the same transformed locale module as the component and wraps the EN provider. These were harness failures, not product failures. `settings-probe.mjs` and `failure.png` remain diagnostic artifacts.

Reviewed final dark desktop/light mobile chart screenshots and light desktopDashboard: quickbar labels/icons fit; compact native tools remain reachable; monochrome project surfaces keep positive/negative semantic colors. No FX logo or Alerts control added.

## Data/state and limits

Application header calls official native chart controls after readiness. Datafeed retains the causal dataset prefix; native interval/style only changes presentation. Footer positions receives `order.execution` from cutoff-scoped replay state, with no fetch or current-snapshot bypass. UI pagination/tab/balance/quickbar preferences stay local. BAR history lacking historical SL/TP/fees displays an unknown dash rather than fabricated values.

Editor/Mentor/Compare/Layout/Scalper remain labeled previews with execution disabled. Positions populated data is fixture acceptance; real requested cutoff was unknown. Root build and20pagechecks are separate primary evidence. This receipt does not certify the native iframe or whole-page accessibility, broker execution, whole-product completion, or every quickbar pointer-drag/reload/reset edge.
