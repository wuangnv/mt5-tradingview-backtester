# Independent dialog/button QA - 2026-10-08

PASS: 10/10 fresh browser journeys; no page errors and no unexpected blocked request. Scope is library dialogs and shared session-delete styling; this is not full provider/history-download acceptance.

## Coverage

- Dark/light, Vietnamese desktop 1710 x 987 and English mobile 360 x 987: Details, Delete, CSV, Progress, Catalog.
- Four shared session-delete demo regressions, opened/closed without submitting deletion.
- Two CSV success fixtures, starting with Not downloaded: preview/import success opens the correct CSV-QA Details, resets download status to All statuses, and makes the new row visible after dismissal.
- Neutral/primary/danger rest, hover, keyboard focus; busy/disabled/errors; Escape guard and opener focus return. Catalog busy overlay and inert drawer content prevent dismissal/interaction; intercepted failure unlocks controls.

## Confirmed styling and fixes

- Dataset delete and shared session delete use the same filled red and white text: dark rest rgb(197,62,72), hover rgb(204,65,75); light rest rgb(181,55,60), hover rgb(152,41,47). Minimum rest/hover text contrast 4.75:1.
- Neutral, CSV primary, catalog primary and danger buttons use radius 999px, height 40px desktop / 44px mobile. Dialog closes use circular radius 50%, 32px desktop / 44px mobile.
- Disabled close, primary and neutral controls have opacity .45. No disabled hover background changes after the shared hover guard fix. Catalog overlay intercepts pointer interaction as intended.
- Keyboard focus remains a solid 2px ring. Resume focus geometry fits inside the dialog-body and modal clip edges. Mobile screenshot visually confirms the complete ring after removing the redundant download-job scroll container.
- Dialogs stay within the viewport, without page/dialog horizontal overflow; focused close/action screenshots inspected in both themes.

## Evidence and historical probe notes

Run: node foundation_v2/evidence/library-dialogs-20261008/independent/review.mjs

- review.json: final passing results and source hashes.
- attempt-1.json: original passing eight journeys before follow-up changes.
- attempt-2-oracle-errors.json: expanded interim probe. Its failures were test oracle mistakes: ancestors outside the top-layer modal were counted as clips; catalog busy overlay correctly intercepted a locator hover; CSV Details selector was incorrect. The final probe stops clip traversal at the modal, moves the real pointer over disabled controls, and uses the actual rd-detail-grid selector.
- Interim real issue: disabled compact close changed background on hover. Reported to root and verified fixed in the final run.
- Representative screenshots: library-dark-en-360-delete.png, library-light-en-360-progress.png, library-dark-vi-1710-catalog-primary.png, library-light-en-360-catalog-primary.png, csv-success-light-en-360-details.png, csv-success-light-en-360-visible.png.

## Safety and limits

All DELETE/POST responses were intercepted in isolated browser contexts and fulfilled locally. Unmocked mutations, external origins, provider/Live APIs and WebSockets were blocked. No actual deletion, CSV import, catalog refresh, resume/download or product source edits occurred in this review. Existing mixed-language Details body content was visible but outside this styling scope.

## Final source SHA256

- DataDeskWorkspace.jsx: f8bffc2e5cff73576fcf971e608afcf35bdca969b6179f51a2b95240bbf55057
- data-library.css: 6fac1dfa99576f1f3b294ea52495ecfc6b7c9e9b233ff8ecec311fcf225f6a06
- testing-standard.css: 3aad75c0706c43b9c4c111c98e89d7fde1ab34458c26201a2aa4938ec959a0ed
- component-interactions.css: be56d7731d312e4eafcf1cd3dfea705ddb04ebd712a631c9192fb8710a27e3c4
