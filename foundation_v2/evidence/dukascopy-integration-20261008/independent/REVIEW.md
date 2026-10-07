# Independent Dukascopy integration review

Scope: pinned `dukascopy-node@1.50.0` worker, keyless catalog, resumable download service/API, price-only ingest, and Kho dữ liệu UI. Reviewed actual in-progress source; no product source edits, commit, upstream bulk fetch, MT5, broker or default-database mutation by reviewer.

## Findings resolved by integration owner

- UI error keys disagreed with backend busy/cooldown/date/unsupported-instrument codes. Latest source maps actual codes and separates poll failures from mutation errors.
- Saved import QA disposition was hidden by the older quality badge. Latest UI distinguishes basic checks from production verification and shows gap/duplicate counts.
- A second API instance could call an active job interrupted and overwrite its state on resume. Latest source uses global worker admission plus a job-specific session advisory lock, identifies remote ownership through database-scoped `pg_locks`, and rejects resume while that owner remains active.
- Requested history coverage previously counted only internal gaps. The final narrow delta passes the requested UTC range into preview/import, preserves explicit leading/trailing missing-interval counts and unknown classification, promotes nonempty boundary-incomplete data to review, and displays the boundary count in details. Actual day has0leading/1trailing missing interval alongside1internal gap.

No remaining blocking source finding in this assigned integration slice.

## Independent validation

- Four Node worker tests passed: original timestamps/zero volume retained, malformed source rejected, explicit429/redirect/size safeguards, checksummed raw resume/tamper refusal. One additional empty candle-bucket probe returned no rows safely.
- Fourteen Python catalog tests passed without network/database mutations, including keyless refresh, schema/code uniqueness, large cache reload, timeout/cooldown and retained stale/error cache.
- `review.json`: eight explicitly mocked browser cases passed. Dark/light360/768/1440 dialog start → running → reload → cancel; additional running-disabled and paused → resume checks. No page errors or document overflow. The mocked responses do not establish real upstream download success.
- `actual.json`: six actual disposable API8031 browser cases passed. Catalog1504, actual EUR/USD1438 original minute bars, saved-row controls, qualityreview/gap1 details, dropdown, Escape/focus restoration and reload; dark/light360/768/1440. Read-only API proxy; no external/mutating requests.
- `replay.json`: actual disposable price-only dataset rendered EUR/USD original M1 candles/OHLC/volume in legacy TradingView Advanced Chart atcursor10. Screenshot visually inspected; candle render is supported by observed bars, not canvas existence alone. Tick-data endpoint422 remains candle-only behavior, not evidence of tick support.
- Final delta: one price-only coverage unit test passed independently. `coverage.json` has two actual detail cases at360light/1440dark with boundary-count1, unknown classification, qualityreview, no overflow/errors/external requests. Both coverage screenshots visually reviewed. Full earlier UI matrix was not repeated for this narrow addition.
- Final focus delta: `focus.json` has one labeled360light download-form case. Date input uses a2pxsolid outline matching the resolved `--wm-focus` token (rgb36,101,139), and the form screenshot was reviewed. Focus styling now comes from the project token rather than the browser default.
- Screens reviewed: `form-dark-360.png`, `actual-library-dark-1440.png`, `actual-details-light-360.png`, `actual-replay-1440.png`. `git diff --check` passed.

Scripts/report hashes identify the reviewed source. Initial actual attempts failed because API8031 was deliberately restarting and because two test selectors used the wrong role/ancestor; evidence retained separately. Product assertions subsequently passed.

## Practical limits

This is M1/Bid public history, not Bid+Ask ticks or broker trading specifications. The real day returned1438 bars from00:00 through23:58 with one internal gap and one trailing missing interval, now explicitly recorded and visible. Missing intervals retain unknown classification: the system does not invent candles or claim to distinguish source loss from market closures. Basic QA must not be presented as complete backtest coverage or production data verification. No whole-product/broker acceptance is asserted.

Native date focus consistency concern is resolved by explicitly using the existing project focus token; it remains blue because that is the current light-theme focus token.
