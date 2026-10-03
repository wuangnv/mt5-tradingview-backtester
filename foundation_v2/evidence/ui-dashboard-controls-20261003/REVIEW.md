# Independent Dashboard/common controls review — 03/10/2026

Final verdict: **SCOPED_ACCEPT**. The light chart speed-trigger contrast finding is resolved and verified below. Product source is root-owned; reviewer has made no product edits.

## Reviewed scope

Reviewed diffs for component-interactions.css, fx-shell-story.css, dashboard.css and component-interactions.browser.mjs. Neutral select hover/open pairs, independent selected/hover/checkmark option states, native focus/keyboard/change semantics, and rounded nonchart subnav using the aside palette are within scope. No framework/backend changes or new authority.

Read interactions-r2/report.json: eight PASS cases in both themes at1440/768/390/320, no errors or blocked requests. Test source uses real pointer hover/open and native keyboard handling, verifies no pointer-open shadow or outline, unchanged value under hover, visible keyboard focus after actual Tab, selected state, fallback and aside/subnav palette equality. Initial interactions/report.json remains FAIL because programmatic focus after mouse use did not establish keyboard modality; the harness fix is separate from product changes.

Read routes/report.json:56 SCOPED_PASS results, no failures, stable before/after source748ef5c49f086d4090576faeb61782c9575a836939613aa34eb33c123f9a0cc5. Read zoom/report.json:6 SCOPED_PASS results, same stable source, native125/200/100percent two themes. Build81modules/unit82PASS are coordinator-reported, not rerun by reviewer.

Visually inspected interactions-r2 hover-status-light320, subnav-hover-light1440, hover-status-dark1440, hover-scope-light768 and loaded-light320; routes replay-light320/1440 and settings-light320. Popup hover and selected backgrounds remain distinguishable; the current option keeps its checkmark, opening has no forced blue rim, and keyboard focus remains visible. Aside/subnav use matching neutral-dark/amber-light selected surfaces and neutral hover.

## Independent chart picker check and finding

Ran a focused isolated GET-only Playwright check, documented in review-chart-picker.mjs and chart-picker/report.json, to inspect light chart type/speed popup states at1440/320. It blocks nonlocal origins and methods other than GET/HEAD/OPTIONS, closes WebSockets, and asserts hover/Escape do not change values. No backend writes or personal browser involved. The helper PASS concerns those assertions; it is not visual contrast acceptance.

Inspected all four chart-picker captures. Popup options and chart-type trigger are readable with rgb29,41,48 text on rgb224,231,234 hover background. **Speed trigger while open loses readable text:** rgb220,227,231 on the same light background at1440 and320. Moving the pointer to a native option removes trigger hover color while the new open background persists; ReplayWorkspace.css retains legacy light speed text. Root received measurements/images and the proposed pairing of open background with color var(--wm-content).

Root added `color: var(--wm-content)` to the existing `select:open` rule. Reran the independent helper with `TW_REVIEW_PICKER_OUT` pointing to chart-picker-final and an added assertion that opened-trigger text matches readable option text after the pointer enters the popup. **PASS4**, no blocked requests, and hover/Escape preserve values. At1440/320 both chart-type and speed triggers now use rgb29,41,48 on rgb224,231,234. Visually inspected chart-picker-final/light-speed-1440.png and light-speed-320.png: the open `1×` label is readable in both captures. Before-fix evidence remains in chart-picker and product evidence chart-picker-before; its initial PASS did not assert contrast.

## Final replacement evidence

Read interactions-final/report.json: **PASS8** at1440/768/390/320 in dark/light, including16 chart-type/speed hover/open checks; errors and blocked requests are empty. Read routes-final/report.json: **SCOPED_PASS56**, failures and unexpected requests empty. Read zoom-final/report.json: **SCOPED_PASS12**, Dashboard and Replay in both themes at native125/200/100percent; failures and unexpected requests empty.

Routes-final and zoom-final both record identical before/after source hash `cc7b2c8af9412d334e2925f1b13cb14fd23a33e426d205d80854d6af14b867f3`. This is the final source reviewed; the independent focused rerun verifies the concrete contrast closure. Baseline route/zoom evidence above is historical, not the final replacement. Build81modules/unit82PASS remain coordinator-reported, not independently rerun.

## Data and limits

Read data-read.json: current persisted replay aggregate60unique closed fills,100percent, partial7of25,360inherited duplicates removed, UTC, includes archived, both durations null. Coordinator's preview configuration evidence identifies dedicated synthetic QA PostgreSQL; reviewer did not inspect a live MT5 account. CSS changes do not alter this flow.

No full WCAG or cross-engine runtime certification. Native fallback is simulated in installed Chromium; screenshots and automated checks establish only their scope. Product/broker/global-system acceptance stays separate. No open blocker remains within this controls/subnav review scope.
