# Offline library cleanup — 07/10/2026

Owner requested removing the blank-catalog instruction and all three permanent
disclosure rows. The library now shows its toolbar/count when blank; pagination
appears only for matching rows. Filter misses, catalog errors/retry and unknown
dataset links retain feedback.

Import CSV opens a native modal using the existing CSV preview/import API and
form. Dataset rows and valid dataset deep-links open the existing provenance/QA
detail in a native modal. Provider metadata presentation and its unused GET were
removed. Preview/import locks the form and modal dismissal until settlement;
success closes import, clears filters, selects the new dataset and reloads the
server-owned catalog. Modal close restores opener focus.

Validation:

- `npm run build`: PASS.
- Focused Node tests: 13/13 PASS (`workspaceContext`, `retry-boundaries`,
  `dataDeskApi`, `researchDataApi`).
- `node foundation_v2/evidence/offline-library-cleanup-20261007/verify.mjs`:
  7/7 PASS; no page errors or unexpected blocked requests.
- Actual empty local API/catalog tested at 360/1428px in dark/light. No removed
  instruction/disclosures/paging; only dataset GET requested; CSV modal stayed
  inside viewport with no horizontal overflow; keyboard/Escape/X and focus return
  passed.
- Labeled fixtures cover detail provenance, Research link, filter miss, per-row
  session preselection, deep-link, failed catalog, pending CSV preview/import
  dismissal lock and successful refresh. CSV POSTs are intercepted fixture
  responses; no dataset was written or broker/provider contacted.
- Initial primary probe used the pre-translation searchbox label `Tìm asset` and
  timed out. Locator changed to the scoped searchbox role (`Tìm tài sản` is the
  rendered label); the full probe rerun passed. No source change was needed.
- User's existing Kho dữ liệu tab reloaded and accessibility state confirmed
  count 0 plus search/source/Import CSV only.
- Independent review: see `independent/review.json` and its review receipt.

Screenshots are local evidence; do not commit generated images. Historical
offline-data-purge evidence remains unchanged. This UI cleanup does not add
Dukascopy downloads or MT5/online functionality and does not represent whole
product acceptance.
