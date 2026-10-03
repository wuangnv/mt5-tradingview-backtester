# Dropdown and subheader interaction repair — 03/10/2026

Owner scope: dropdown trigger/option hover, pointer-open blue rim, subheader/aside state consistency, and an explanation of Dashboard data. Three project CSS files and the existing component interaction probe changed; no backend/data/state rewrite.

## Behavior and decisions

- Select trigger hover now changes the neutral background and border. Opening by pointer no longer forces a blue border/glow; keyboard `:focus-visible` stays visible. Popup options distinguish hover, checked/checkmark and checked+hover, without a blue option outline.
- Aside and subnav reuse the same project shell hover/selected palette in both themes. Subnav items are40px high, rounded8px and inset in the52px bar, replacing full-height blue tint/underline. Recent Sessions disclosure/menu items reuse neutral hover.
- Native select value/change, type-ahead, disabled, URL/reload, reduced-motion and progressive fallback contracts remain. No dependency or JavaScript focus-modality layer was added. Unsupported engines retain the native picker; only installed Chromium and a simulated fallback were tested.

## Dashboard data verified locally

The running GET-only API adapter `.artifacts/mt5-ui-preview-20261003/serve_preview.py` uses dedicated loopback PostgreSQL `trading_workspace_v2_ui_20261001`. This is stored synthetic QA replay data, not the owner's real MT5 account history. UI5180/API8020 were retained without restart/reseed; the adapter denies non-GET/HEAD/OPTIONS and broker execution stays locked.

- Recent Sessions: `/api/v2/replay/sessions` reads the persisted catalog. Search/status/sort/page are applied on the client, independently of Performance filters.
- Performance: `/api/v2/overview` reads persisted replay execution and computes unique closed fills within root lineage, wins from positive net P/L, and monthly/symbol counts. It includes archived sessions and excludes inherited duplicate fills. Page/workspace/filter/refresh changes fetch data; there is no live broker stream.
- Actual sanitized [API snapshot](data-read.json):25stored sessions,7readable and18unavailable, so status is `partial`;60unique closed trades,60wins/100%,EURUSD/January2024.360inherited duplicate fills were excluded. These are QA outcomes, not evidence of trading performance.
- Date filters use historical UTC trade close dates, not when a session was opened. Last30days is empty for this January2024 fixture. Invested/replayed duration fields are null and remain unknown in the UI.

## Verification

- Web unit suite82/82PASS; build81modules PASS with existing chunk-size warning; `git diff --check` clean.
- [Final route/axe/reflow report](routes-final/report.json):56/56SCOPED_PASS, Overview/Sessions/Analytics/Settings/Prop/Data/Replay, dark/light at1440/768/390/320px. No failures or unexpected requests. Axe incomplete rules remain explicit; not full WCAG certification.
- [Final component interactions](interactions-final/report.json):8/8PASS across both themes/four widths. Covers all four Dashboard selects' actual trigger/option hover, value stability, pointer-open no blue outline/glow, keyboard focus, aside/subnav palette equality, selection/reload, selected row/results, reduced-motion and simulated native fallback. Adds16Replay chart-type/speed hover/open checks, including trigger text/background after pointer movement into options and Escape/value stability. No errors or blocked requests. Earlier [interactions-r2](interactions-r2/report.json):8/8PASS on the pre-speed-repair source; it does not supersede the contrast finding below.
- Final stable route/zoom source before/after: `cc7b2c8af9412d334e2925f1b13cb14fd23a33e426d205d80854d6af14b867f3`.
- [Final native zoom](zoom-final/report.json):12/12SCOPED_PASS, Dashboard and Replay in both themes at125%/200%/100%; source before/after matches the final route hash above. No page overflow or errors.
- Root visually reviewed dark desktop popup, light320px popup and light desktop aside/subnav captures, plus final light desktop speed picker with clearly readable1×trigger. The initial supplemental Replay probe only measured popup option text; it missed the opened speed trigger finding described below.

## Retained attempts and limits

Initial [interaction attempt](interactions/report.json) failed the focus assertion because programmatic focus after pointer use did not establish keyboard modality. The harness now sends actual Tab before focus; product source was unchanged for that repair. Failure remains retained. A supplemental Playwright probe initially ran from the product root and failed module resolution; rerunning from the existing web installation succeeded. Neither harness issue was disguised as a product defect.

Independent review found a real light Replay regression: the speed trigger kept legacy text `rgb(220,227,231)` over neutral `rgb(224,231,234)` while open. Moving the pointer into the popup removes trigger hover but keeps the open background. Paired `color:var(--wm-content)` with the existing open background rule; added chart-type/speed hover/open checks after pointer movement into options in the reusable component probe. [Before-repair measurement](chart-picker-before/report.json) has a technical PASS for its old value/Escape-only assertions; its speed-trigger color and [image](chart-picker-before/light-speed-1440.png) record the actual visual failure. Initial route56/zoom6/r2interaction8 source `748ef5c…` remains retained, separate from final replacement evidence.

Independent `support_patterns` [review](REVIEW.md):SCOPED_ACCEPT after read-only source/visual inspection and its separate [final chart picker probe](chart-picker-final/report.json),4/4PASS. Light speed text now matches readable option text at1440/320px; the pre-repair finding remains separate above. Reviewer read final8interaction/56route/12zoom receipts on source`cc7b2c8…`; build/unit results are root-run, not reviewer reruns.

No canonical goldens, shared-system pins, runtime ledger/STATE or whole-product acceptance are promoted. VI remains deferred. Preview: `http://127.0.0.1:5180/?workspace=tenant-a&view=overview&area=testing&section=dashboard`.
