# Independent library cleanup review — 2026-10-07

**PASS: 10 scoped UI cases. No product findings.** Reviewed DataDeskWorkspace.jsx and data-library.css diff. Reviewer made no product source edits or commits.

Run from product root: `node foundation_v2/evidence/offline-library-cleanup-20261007/independent/review.mjs`. Result: `review.json`.

- Actual empty catalog: dark/light 360/1428. Only compact toolbar remains; empty instructional text, all three disclosure rows and useless pagination absent. CSV remains accessible.
- Native CSV dialog: file input receives focus; Escape, backdrop and X close and restore opener focus. Native Tab sequence does not reach underlying product controls (Chromium may visit browser chrome between cycles).
- Details fixtures: dark/light 360. Source provenance preserved; long IDs/hashes wrap; dialog body scrolls to lower details without horizontal overflow. Escape restores row-button focus.
- Held preview/import fixtures: dark/light 360. X and file fields disabled; Escape/backdrop cannot dismiss while pending. Successful intercepted import refreshes catalog and opens details; subsequent close restores CSV-opener focus.
- Failed catalog + rejected CSV preview fixtures: dark/light 360. CSV can open; failed preview releases busy lock, shows alert and allows dismissal with focus return.

Mobile dialog bounds x=16–344 in a 360px viewport. Details height remains within y=24–963 in 987px viewport, with scrolling confined to body. No page/dialog horizontal overflow, page errors or forbidden API attempts observed.

Representative screenshots: `empty-dark-1428.png`, `empty-dark-360-csv.png`, `details-light-360.png`, `details-light-360-bottom.png`, `pending-dark-360-import.png`, `error-light-360.png`.

Local GET datasets only in real cases. All CSV POSTs are fulfilled by independent fixture routes, never forwarded. Provider/Live/MT5 endpoints, other writes, external origins and WebSockets blocked. No actual datasets imported, changed or deleted. This is UI acceptance, not data-quality/provider-readiness acceptance.

Probe calibration report is retained as `probe-calibration.json`: initial strict Tab assertion mistook native browser-chrome focus for underlying-page focus, and error fixture waited for a count absent in the error state. Both probe assumptions were corrected without product changes.

Final source SHA-256:

```text
DataDeskWorkspace.jsx b2349f7f73dda4280c43f4dc0c0b58dd3ee4c67f19cc762441f2ddb9cf0043fb
data-library.css      a55275216b2f900187e351cbea2370c3a234d9f4bdc384cc1a1abcc52a656653
```
