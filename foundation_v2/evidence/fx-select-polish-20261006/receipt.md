# Select checkmarks and hover spacing

Scope: the owner's two comments on Analytics Type `All` and Dashboard Recent Sessions sort hover. Baseline product commit: `475867f`.

`All` now reuses the option checkbox appearance instead of a native browser checkbox. Its whole row remains clickable, with checked, unchecked and mixed states exposed through `aria-checked`; Space and Enter operate the button. Selection still calls the existing `onChange` with available option values. Disabled choices and the filter draft/Apply flow are unchanged.

Short dropdowns no longer reserve an unused native scrollbar gutter. List rows have explicit border-box sizing and equal 2px inner spacing, so both rounded hover corners fit. Overflowing lists retain their native scrollbar and existing focus handling. No new wrapper, dependency or data source was added.

Validation against the running local UI on port 5180:

- `node tests/selectPolish.browser.mjs`: 8 focused checks PASS, 1710/360px in dark/light; identical checkmark styling, whole-row click, keyboard/mixed state, symmetric hover, selection and Escape. Zero page errors or API writes.
- `$env:TW_UI_EVIDENCE_DIR='../evidence/fx-select-polish-20261006/regression'; node tests/controlsRefinement.browser.mjs`: 7 regression journeys PASS, including native scrollbar drag/wheel and Type/Time/Timezone/date filters at 360/768/1440px. Zero page errors or API writes.
- Independent review: 10 checks PASS and 2 scoped Axe scans with zero violations; see `independent/REVIEW.md` and `independent/report.json`. Checked appearance, interaction, hover geometry and native scrollbar behavior with source unchanged.
- `npm run build`: PASS. Existing large-chunk warning remains.
- `git diff --check`: PASS.

Reviewed screenshots include `primary/type-dark-1710.png` and `primary/hover-light-360.png`. The visible focus ring after keyboard activation is intentional. Raw independent r1 hover failures were caused by reading the CSS transition before it settled; retained in `independent/report-r1-hover-timing.json`, with the corrected final oracle documented by the reviewer.

This receipt covers these two controls and their focused regressions. It does not claim whole-product, broker or full WCAG acceptance. The previously documented Analytics narrow-screen content overflow is outside this change. No actual session was edited, archived or deleted.

Rollback: revert the select-polish commit; no data migration is required.
