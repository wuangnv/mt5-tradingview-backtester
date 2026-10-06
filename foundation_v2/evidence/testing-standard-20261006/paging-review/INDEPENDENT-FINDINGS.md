# Independent WIP verification

Runnable suite: `test_paging_contract.py` in this directory. It uses synthetic table rows and existing canonical replay fixtures; its HTTP journey uses a FakeStore only. No real API session/journal mutation.

Initial result: **24 passed, 5 failed** (29 cases). Exact output: `INITIAL-RESULT.txt`.

## Findings requiring fixes

1. **Malformed extra list filters accepted silently** — `trades_page.py:49` uses `value or []`, so `{tagInclude:false}`, `{assets:null}` and `{reportKinds:0}` normalize to empty arrays instead of raising the contract's 422. For assets/include this broadens the result set, while reportKinds=0 unexpectedly filters every row. Validate the raw value as string or list before defaulting; only the documented empty string and valid empty arrays should represent empty selections.

2. **Timestamp parser differs from supported browser formats** — `trades_page.py:32-34` does not parse numeric strings, and recognizes milliseconds only from 1e12 instead of 1e11 used by closeTime and existing backend timestamp helpers. A Unix string `'1700000000'` and a valid year-2000 millisecond epoch `946684800000` become unknown. Sorting/time/day/year filters then produce different rows from the previous frontend. Current canonical replay integer-second values pass; compatibility for supported imported timestamp representations still needs repair.

## Verified passing behavior

- 137 rows: sorted before slicing, pages disjoint, full count=137, final page size37 and out-of-range clamp.
- Journal tag on a later page, comma-containing tag, include AND/OR, exclude, full scope facets.
- Known empty zero vs unavailable null vs partial readable count.
- Actual canonical replay source+fork dedup, exclusion and source_provenance retained; no input changes.
- Stable known-value ties and null-last sorting both directions; return percentage per row capital.
- Same snapshot repeats, source revision and journal revision change snapshot.
- Invalid page/size/sort and most malformed JSON/timezone/minute inputs reject.
- ReportKinds empty string vs explicit none, absent entry_type does not invent market.
- Runtime Python/Node filter parity for New York DST repeated hour, UTC overnight/single-bound minute, Vietnam weekday/hour, tag groups, unknown dates.
- FakeStore HTTP: old unpaged schema unchanged, paged schema opt-in, inclusive UTC close date, missing session404, cross-tenant403, bad supplied page contracts422.

This is a focused paging contract review, not browser acceptance, full production snapshot isolation, or a scalability benchmark. Canonical server projection still reconstructs all selected execution events per request.

## Retest after root repairs

Root repaired strict raw list validation, numeric-string timestamp handling and epoch threshold. Re-ran the unchanged 29-case suite: **29 passed**, output `RETEST-RESULT.txt` (two pre-existing TestClient dependency deprecations only).

Root also added session/workspace paging reset, same-request snapshot revision reset and preserved full facets during loading. Runnable browser verification `paging.browser.mjs` uses intercepted GET fixtures with 137 rows and aborts all writes. Result `BROWSER-RESULT.json`: **5 journeys passed**, zero page errors and zero writes.

Verified browser transitions:

1. Remote page14 receives only7 rows with total137; full asset facets include XAUUSD even while its rows are off the current page.
2. Page size25 and net-P/L sort dispatch API params and reset page1.
3. Switching from all sessions on a later page to Alpha resets first page.
4. Same-scope source snapshot revision during focus refresh resets page1.
5. Delayed size50 read shows busy/skeleton without false empty; full facets persist. Switching session scope aborts the delayed request, and its late completion cannot replace the newer all-session page.

Screenshot `remote-ledger.png` captures final rendered remote table. The server-paging contract findings above are resolved in the reviewed WIP source. Analytics remains on its full-report route; this is intentional and avoids deriving report totals from a table page.
