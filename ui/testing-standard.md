# Testing component contract

Testing is the reference consumer for the existing **Gọn đồng bộ** direction. This
contract covers Dashboard, Sessions, Trades, Analytics (Sessions and Prop), Market
Data, session settings/actions, creation forms and application-owned chart controls.
It complements `workspace-patterns.md`; it is not a product progress ledger.

Project color roles are defined in `project-palette.md` and apply across all areas.
Trading chart panes use their separate native TradingView palette; application
controls and report charts retain their project roles.

## Presentation

The current compact size/color/state/motion/layout rules are owned by
[compact-system.md](compact-system.md) and the pinned
[Compact contract](../../../UI-Systems/core/tokens/compact/0.1.0/CONTRACT.md).
These supersede the previous 40px control / 32px metric / neutral-only scope.
`component-interactions.css` maps the generated semantic roles; `testing-standard.css`
now applies action roles across the app; `compact-system.css` owns project adapters.
Route CSS owns composition and documented rich/vendor exceptions, not a new palette.

Market Data history keeps two UTC date columns, dd/mm/yyyy; exact timestamps are
available in details. Unsupported download bytes/speed/ETA stay hidden; a known
zero is not unknown. Row progress omits redundant state prose as requested; errors
and controls remain discoverable. Action placement does not move between states.
Financial colors, chart cutoffs, navigation context and dataset source are unchanged.

## Components and language boundaries

| Owner | Use |
| --- | --- |
| `FxSelect` | Single/multiple, search, disabled choices, select all/mixed, keyboard and native scrollbar |
| `SessionFilter` | Raw session names and full-row multi selection |
| `AnalyticsFilterBar`, `LedgerFilterDrawer` | Draft editing; Apply commits filter scope |
| `TimeFilter`, `DateFilter` | Native typed input plus calendar; ISO values and IANA timezone IDs |
| `SessionSettingsDrawer`, `SessionActionDialog` | Focus management, cancel, immutable facts, duplicate/delete confirmation |
| `TestingSkeleton`, `TestingReadState` | Initial read, unavailable/error/retry and route load failure |
| `TestingIcon`, `ChartIcon` | SVG icons; do not replace them with font glyphs |
| `TestingComponentReference` | Internal reference at `?area=testing&ui_reference=1` |

Shell language drives `TestingLocaleProvider`. `testing-copy.json` owns system copy,
including accessible labels, help, validation and enum chips. `testing-enums.json`
owns status families. `Intl` formats displayed numbers and dates for EN/VI; UTC
and filter timezone semantics remain explicit. Do not parse display text into
calculations or change API/CSV identifiers when switching language.

Names, descriptions, symbols, tags, strategies, dataset IDs and hashes are user or
source data: keep them raw. Set `localize:false` on data options or
`localizeOptions={false}` on a data-only select. Translate only the surrounding
system copy. Language switches must retain drafts and exact delete confirmation.

Backtesting is labeled **Backtest**, with **Phiên backtest** for sessions:
testing a trading method against historical market data. Prop firm means a company
providing trading capital, not an investment fund; this product's simulated
source is labeled **Prop Firm**, and its simulated evaluation workflow is
labeled **Thử thách prop firm**. Date filters use **Ngày backtest**. Keep English labels and API
identifiers intact. Do not imply that a simulated result earns real funding.

Use **Mã giao dịch** for the generic instrument/symbol label throughout the
project (short **Mã** in compact labels). **Cặp tiền** applies only to Forex
contexts; metals, indices, stocks and crypto are also valid instruments. Keep
actual identifiers such as EURUSDm and XAUUSDm raw and English labels as Symbol.

Journal and trade-detail entry controls share the 16px notebook glyph in
`TestingIcon`; the ledger entry still opens its existing trade inspector.
New session has a separate SVG plus, never a symbol embedded in translated copy.
The ledger tools/filter boundary uses one short divider, not a navigation divider.
Dashboard omits the partial-scope info icon; its accessible section description
still identifies partial scope, and error/blocked/unknown states remain explicit.

Session archive/restore UI is deferred, including old `manage=archive` links.
Previously archived records remain stored and can be read from All sessions or a
direct link, with replay/duplication unavailable. No data migration is performed.
Deletion still requires the exact session name and revision, and retains the
Prop-linked-session refusal. Demo mutations affect local component state only.

## Data and loading

- Demo uses shared presentation components and labeled fixtures. Demo session
  edits stay local; unsupported data and experiments stay unavailable.
- Actual reads never use demo as an error fallback. Unknown values are `—`; a
  known zero is `0`. An empty source differs from an empty filtered result.
- Initial reads and lazy route loads show skeletons. Background refresh preserves
  available data; failed refreshes show stale/error state and an explicit retry
  where applicable. Changed scope hides the previous scope immediately.
- Partial/stale scope and provenance must remain discoverable. Avoid redundant
  banners, but never claim that incomplete data is complete.
- Route chunks load on demand. Analytics experiment data waits for Drawdown or
  Simulation; Monte Carlo code loads only when simulation runs.

## Paging contract

Aggregate actual Trades uses opt-in `GET /api/v2/replay/trades?page=1&page_size=10`
with `replay-trades-page-v1`. Existing unpaged consumers remain compatible.
The server joins journal tags, applies full-scope filters, returns full facets and
filtered count, sorts stably, then slices. Dates/timezones, inclusive ranges,
overnight times and tag AND/OR semantics match the client model.

Each response carries scope, sources, exclusions, snapshot key and per-row
provenance. Unknown count is null, not zero. Scope/filter/size/sort changes reset
the page. A changed snapshot detected during same-scope refresh resets to page 1;
late aborted responses cannot overwrite the current scope. This is not a
transaction spanning independent requests across concurrent source mutations.
Do not compute full analytics from a page: `advancedAnalytics` rejects paged models.

The existing canonical execution projection still visits execution events on each
request. This is server response paging, not indexed database paging. Add indexed
storage only with measured need and an approved persistence design.

Market Data pages the metadata catalog locally (25 rows by default); it does not
load all bar/tick history. Demo Trades also pages locally. Neither may be described
as server paging. Actual Analytics reads its complete filtered analytics scope.

## Verification

Use Playwright with native scrollbars (`ignoreDefaultArgs: ['--hide-scrollbars']`).
Cover EN/VI, dark/light, desktop/tablet/mobile, keyboard/focus, popup bounds and
scrollbar dragging, applied-vs-draft filters, dialogs/cancel, pagination and fixed
table header/footer. Use labeled fixtures for loading/empty/partial/denied/error,
snapshot changes and out-of-order responses. Actual QA is GET/HEAD/OPTIONS only;
do not mutate saved sessions, data providers or broker state for visual tests.

Focused commands from `foundation_v2/web`:

```powershell
npm run build
node --test tests/tradingAnalytics.test.mjs tests/ledgerFilters.test.mjs tests/tradesPage.test.mjs tests/testingCopy.test.mjs
node tests/testing-standard.browser.mjs
```

Backend contract checks from `foundation_v2`:

```powershell
./.venv/Scripts/python.exe -m pytest -q tests/test_trades_page.py tests/test_dashboard_read_model.py tests/test_replay_analytics.py
```

The browser smoke needs the UI on 5180 and API on 8010; it blocks actual writes.
Independent acceptance evidence lives in
`foundation_v2/evidence/testing-standard-20261006/`. Build and fixture results do
not establish broker authorization or whole-product completion.

Recent session headers expand on non-action clicks, with hover feedback and a
darker expanded surface. The existing chevron supplies keyboard activation and
`aria-expanded`/`aria-controls`; actions within the header do not expand it.
Empty expanded reports use a single left-aligned message; known balance curves
remain visible even if no full ledger is available. The peach list count uses
prose (e.g. "1 phiên trong tổng số 6") for filtered matches against the entire
catalog, independent of page size. It is local catalog
filtering, not server paging. Popup search fields share transparent background
against the raised menu surface and the same underline/focus treatment.

Dashboard presets **Tuần trước / Last week** and **Tháng trước / Last month**
use the completed Monday–Sunday week and completed calendar month in UTC.
**Tất cả / All time** removes date bounds; **Tuỳ chọn / Custom** keeps explicit
ISO bounds. Previously saved rolling 7/30/90-day ranges retain their original
bounds and an accurate rolling label when they still match today's range.


## Pointer and keyboard states

Interaction colors are project roles owned by `component-interactions.css`;
component geometry/button roles are owned by `testing-standard.css`.
Never add a catch-all hover rule for every button/link: table headings, text links,
menu options, tabs, price controls and record rows have different semantics.

| Role | Rest | Pointer hover | Keyboard / open |
| --- | --- | --- | --- |
| Record/table row | Canvas | Subtle `--wm-row-hover` | Selection `--wm-row-selected`; selected record remains distinct |
| Secondary toolbar/dialog action | Neutral control surface | `--wm-control-hover` | Focus ring; 1px transparent border stays reserved |
| Inline table/session action | Transparent | `--wm-control-hover`, distinct from row | Same surface while menu open; keyboard focus ring |
| Primary action | Peach | Peach hover | Focus ring; never converted to neutral gray |
| Destructive confirmation | Red, white text | Red hover, white text | Focus ring |
| Text action | Transparent | Underline/foreground only | Focus ring; no filled box |
| Field/select | Field geometry with border | Border strengthens | Focus/open indication retained |
| Disabled action | Muted, native disabled | No hover change | No activation or keyboard tab stop |

Buttons reserve their border geometry and do not gain a visible outline merely
from pointer hover. Focus-visible is an independent keyboard indication, not the
same thing as hover. Text Catalog/Settings actions stay flat and underlined on hover;
New Strategy retains its owner-requested orange. Dashboard quick actions retain
their existing orange hover. Financial markings and native chart controls keep
their established semantics. Table actions use 32px circles on desktop and 44px
on mobile/coarse pointers. Download/progress stay text controls, never oval icon areas.
Row and control tokens are separate so a nested hovered action cannot merge into
its row, including selected rows. Popup option hover uses the control surface;
menus retain their panel border even though their individual items do not.
