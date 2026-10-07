# Testing component contract

Testing is the reference consumer for the existing **Gọn đồng bộ** direction. This
contract covers Dashboard, Sessions, Trades, Analytics (Sessions and Prop), Market
Data, session settings/actions, creation forms and application-owned chart controls.
It complements `workspace-patterns.md`; it is not a product progress ledger.

Project color roles are defined in `project-palette.md` and apply across all areas.
Trading chart panes use their separate native TradingView palette; application
controls and report charts retain their project roles.

## Presentation

`foundation_v2/web/src/testing-standard.css` owns Testing semantic tokens, scoped by
`data-ui-area="testing"`. Live explicitly opts into the same rules through
`data-ui-area="live"`; its layout and data semantics are defined in
`live-market-standard.md`. Reuse existing components before adding another control.

| Role | Size |
| --- | --- |
| Metric value | 32px |
| Page title | 22px |
| Dialog title | 20px |
| Section title | 16px |
| Body | 14px |
| Controls and table | 13px |
| Metadata and help | 12px |

Icons use 16px for chevrons and compact actions, 18px for standard actions, 20px for navigation and 24px for
larger illustrative controls. Standard controls are 40px on desktop, 44px below
480px or with coarse pointers. Circular actions share the duplicate-session
reference: 32px desktop, 44px mobile/coarse, with 16px icons.
Summary uses the same compact height beside session icon actions, with 13px/500
text. Dashboard remaining-days track and text form a centered group beside the
action row and use sea blue. Empty session expansion uses one text line plus
bottom padding, without a minimum chart height. Chart controls retain their
recorded compact arrangement and vendor controls keep vendor sizing. The compact
mobile ledger pager shows previous/current/next; desktop also exposes first/last
and nearby page numbers. The row-count selector remains a text pill.

Spacing uses 4/8/12/16/24/32px. Buttons and ordinary select triggers use pill
radii, one transparent 1px border and a muted control surface; primary actions use the
Go-to-chart peach surface with a contrasting foreground. Open and keyboard-focus states remain visible.
Destructive actions use a filled red surface with white text in resting and hover
states. Remaining-days badges use the softer peach surface/text pair. Dashboard keeps a compact Delete icon; the Sessions toolbar uses the text
Delete session pill. The Recent Sessions filter toggle shares compact icon sizing.
Trades toolbar icons and text controls align around one vertical center.
Text buttons and select triggers use a 20px line box. Text buttons use
500 weight and 8px/12px padding; compact circles override padding to zero.
Pagination flex layout belongs to the shared standard, so a standalone Market
Data or Live route never depends on lazily loaded Analytics styles. Action SVGs have a fixed,
non-shrinking box (18px standard, 16px compact) and no inline baseline gap.
Metric icons align with the label's first 18px line when the label wraps; search
icons track the input's vertical center. Market Data fields follow the shared
40/44px control height, including date fields.
Rich session selectors, input fields and popups retain their field/panel geometry;
popups use 12px radii. Inline Settings retains its underline interaction.

Dashboard KPI values use 32px/600 numerals; duration units use 14px text aligned
on the numeral baseline. Durations come from typed seconds, shown as elapsed
days/hours/minutes, never inferred calendar months. Unknown durations remain
“—”; demo durations remain explicitly sample data. There are no information
icons. Overall win rate shows only its percentage. The closed-trade card uses a
green/red Buy/Sell split from the same deduplicated, filtered closure aggregate;
percentages appear only for a positive total with complete side counts. Monthly counts
stay labeled as trades until measured activity time is available. Report bars
use solid peach/blue/violet and aligned dashed grids; zero values have zero area.

Replay timing follows the public [FX Replay definitions](https://support.fxreplay.com/faqs):
practice time is active interaction; historical time is market time moved through.
Exact FX Replay idle/multi-tab/skip algorithms are not public. Our replay workspace
counts visible, focused interaction (including chart iframe input and paused
analysis), with a 120-second idle cutoff. Ten-second flushes submit immutable
segments of at most 30 seconds; the server unions overlaps across selected
sessions to avoid counting simultaneous tabs twice. Heartbeats do not change
execution revisions. Failed saves retry the same event ID, with a per-tab browser
queue capped at 120 events; unsupported storage retains only in-memory retries.
Crash/close before a successful flush can lose a short unsaved tail.

Historical time adds real timestamp differences only on successful canonical
forward steps. Read-only seek/reload does not add time; a new branch starts at
zero and does not inherit the parent's counters. Legacy sessions are measured
from activation, never backfilled from creation dates or old cursor positions.
Dashboard timing totals are for the selected sessions, independently of trade
date/side/outcome filters; since-tracking and partially measured scopes remain
visible. Practice/replay metrics can be measured even without closed trades.

Shell chrome and generic actions use neutral white/black/gray in both themes.
Primary actions use peach; financial positive/negative colors and the separate
report chart palette retain their meaning. The sidebar shows the current raw workspace
ID with a Settings link above the separated primary group. It does not imply a
signed-in profile, tier, or workspace-switching capability.
Icon actions are circles, filter pills retain the established rounded shape.
Use alignment and spacing before surfaces; avoid nested cards. Dividers extend
to the content edges; the table scroll region, header and footer remain separate.

Hover uses the shared neutral surface and ivory/dark text in each theme. Semantic positive/negative financial
values retain their colors. Selected dropdown options show a check; selection
does not permanently apply hover background. Focus remains visible without a
second overlapping border. Respect reduced-motion preferences.

Workspace tabs use 52px height and 18px navigation icons. Hover brightens text and
icons without a background or border; selected tabs use contrast text and a 2px underline
(ivory in dark theme, dark in light theme), with no persistent fill. Analytics
source tabs stay beside Analytics on the same horizontally scrolling row, with
no vertical separator. On Analytics, the underline runs continuously from the
Analytics parent through both source tabs in peach. The parent text/icon is
peach. Source labels are muted at rest and brighten on hover; only the selected
source uses full-contrast text. Hover never adds a fill. Other selected tabs retain the
ivory/dark underline. The rail toggle has a transparent background and brightens its icon
on hover. Keyboard focus retains its visible outline.

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
