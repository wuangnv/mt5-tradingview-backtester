# Offline library search parity — 2026-10-07

Scope: match the existing Practice Dashboard search, including neutral hover/keyboard focus. No data, provider, broker, API or search-state changes.

The `.fx-app .wm-page :where(input...)` rule overrode the original low-specificity library radius with 4px and a 44px minimum height. The library now uses a scoped selector matching Dashboard specificity, the existing 999px control-radius token, 44px height, 38px icon padding, canvas background, neutral hover border, no inset focus ring, muted placeholder, normal line height and 420px maximum search width. State remains owned by the existing library search/filter model.

Validation:

- `npm run build` from `foundation_v2/web`: PASS on final source.
- `node foundation_v2/evidence/offline-library-search-20261007/verify.mjs`: 6/6 PASS, real local GET-only UI, widths 360/768/1710, dark/light. Compared Dashboard and library rest/hover/keyboard focus computed styles, input typing and clearing, and no content overflow. No page errors or forbidden requests. Results: `verification.json`; screenshots beside script.
- Independent review: `independent/REVIEW.md`, runnable `independent/review.mjs`.
- Primary visual inspection: desktop dark and mobile light screenshots. This is search-component acceptance, not whole-product or provider acceptance.
- Initial comparison found inherited 19.5px line height versus Dashboard normal; repaired before final runs. Independent reviewer retained the initial failed report.

Research clarification (no adapter added):

- Official Trading Tools instrumentList documentation JSON requires an issued `key`: https://www.dukascopy.com/trading-tools/api/documentation/instruments.json
- Official website offers free historical CSV export: https://www.dukascopy.com/swiss/english/marketwatch/historical/
- Bounded anonymous Node fetch of https://www.dukascopy.com/datafeed/EURUSD/2026/00/05/12h_ticks.bi5 returned HTTP 200, application/octet-stream, Content-Length 13783. Read one chunk then canceled; no persistent dataset, credentials, account, billing or download job created. The alternate datafeed hostname timed out in a 30-second PowerShell probe. One successful file is not proof of complete history, all assets or automated-use permission.
- The documented S3 route separately requires AWS credentials and requester-pays billing: https://www.dukascopy.com/wiki/en/development/data-export/
- Existing automated-provider license gate remains intact. Current project download buttons remain disabled because no Dukascopy downloader is integrated; this is not evidence that every historical download needs a Trading Tools key.

Rollback: revert the scoped CSS commit; evidence files contain no product state.
