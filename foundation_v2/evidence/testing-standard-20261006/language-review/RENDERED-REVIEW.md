# Testing EN/VI review receipt — 2026-10-06

Result: **PASS within the language-review scope below**, after the root integrated the reported fixes. No outstanding reproduced locale defect remains in these journeys. This receipt is not whole-product acceptance.

## Evidence

- `rendered-report.json`: 32 snapshots; Dashboard, Sessions, Trades, Session Analytics, Prop Analytics and Market data in EN/VI demo mode; Type/Time/Timezone/date menus, Basic/Tags drawers, four settings tabs, delete confirmation cancelled, Monte Carlo result and validation; six EN actual-data surfaces.
- `focused-report.json`: 36 snapshots; all six actual-data surfaces in EN/VI after GET requests settle; eight settings tabs with input values captured; raw user-data collision fixtures.
- `final-aria-report.json`: 3 final narrow snapshots/cases, all passed, covering EN demo, VI demo and EN actual SessionPerformance after the final accessible-label corrections.
- Total: 71 captured screenshots in `rendered/` and `focused/`. The overlapping final 3 cases supersede the earlier SessionPerformance accessible-label findings.
- All final reports: zero application runtime errors; zero attempted API writes. Only GET/HEAD/OPTIONS are allowed by the review harness. Real records were never modified.
- `focused-report.json`: **20/20 raw-boundary checks passed**. Disposable intercepted demo module responses supplied session names `Buy`, `Performance`, `Assets`, asset `Buy`, strategy `Performance`, tags `Buy` and `Performance`. Names remain exact in titles, session menus/triggers, ledger session menus, delete confirmation, tag menus/triggers, asset/strategy menus and applied chips in both languages.

## Confirmed fixes

The root corrected untranslated select-search/expand labels, settings tabs and read-only values, Monte Carlo input labels, report error reasons, analytics notes and currency formatting, chart captions and accessible descriptions, weekday captions, and filter enum chips. EN Wins/Losses/Breakeven use named headings so a count of one remains grammatical. Final EN session chart labels use Mon–Sun; VI uses T2–CN.

Actual Analytics now says that this session's trading simulation has not been initialized instead of exposing `replay_execution_not_initialized`. Actual Sessions retain unavailable figures as `—`; actual Prop Analytics and Market data show their respective unavailable-source or empty states. Actual user descriptions and session names are preserved as data.

Locale examples verified in rendered output: `10,960 USD` / `10.960 USD`, `10,412.5` / `10.412,5`, EN/VI formatted session dates. Source UTC values, filter values and replay cutoffs are retained.

## Glossary and domain review

Delivered 778 initial copy entries, 161 requested additions and 135 chart additions. The integrated 1,126-key glossary has **zero named-placeholder mismatches** in EN or VI. `final-copy-additions.json` records the final multi-count and weekday terms. Strategy IDs/names, user names/descriptions/tags, broker descriptions, instrument symbols, IANA timezones, IDs/hashes, engine/cost versions and currency identifiers stay raw.

Payoff ratio describes average win divided by average loss magnitude. Monetary return is Net P/L; recorded time is UTC recording time. Market-session analytics distinguish market sessions from saved replay sessions. “Actual data” avoids implying a live broker connection.

## Limits

Rendered language review used dark mode at 1710×987. Light/mobile layout and broader keyboard/scroll/visual state checks belong to the root's other QA receipts. Chart wording received the 135-entry static domain review; this language lane did not execute every chart-object or replay mutation. Real archive/delete/save flows and broker/provider activation were not exercised. Monte Carlo validation was local demo behavior.

Earlier harness-only navigation/locator failures were repaired and rerun. They were not application errors. The final three reports named above contain the completed successful runs.
