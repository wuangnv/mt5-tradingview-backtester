# Testing component contract

Testing is the reference consumer for the existing **Gọn đồng bộ** direction. This
contract covers Dashboard, Sessions, Trades, Analytics (Sessions and Prop), Market
Data, session settings/actions, creation forms and application-owned chart controls.
It complements `workspace-patterns.md`; it is not a product progress ledger.

## Presentation

`foundation_v2/web/src/testing-standard.css` owns Testing semantic tokens, scoped by
`data-ui-area="testing"`. Reuse existing components before adding another control.

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
reference: 32px desktop, 44px mobile/coarse, with 16px icons. Chart controls retain their
recorded compact arrangement and vendor controls keep vendor sizing. The compact
mobile ledger pager shows previous/current/next; desktop also exposes first/last
and nearby page numbers. The row-count selector remains a text pill.

Spacing uses 4/8/12/16/24/32px. Buttons and ordinary select triggers use pill
radii, one transparent 1px border and a gray surface; primary actions use the
Go-to-chart white/black surface. Open and keyboard-focus states remain visible.
Rich session selectors, input fields and popups retain their field/panel geometry;
popups use 12px radii. Inline Settings retains its underline interaction.

Shell chrome and generic actions use neutral white/black/gray in both themes.
No additional brand accent is required; financial positive/negative and data
series colors retain their meaning. The sidebar shows the current raw workspace
ID with a Settings link above the separated primary group. It does not imply a
signed-in profile, tier, or workspace-switching capability.
Icon actions are circles, filter pills retain the established rounded shape.
Use alignment and spacing before surfaces; avoid nested cards. Dividers extend
to the content edges; the table scroll region, header and footer remain separate.

Hover is neutral white/gray in both themes. Semantic positive/negative financial
values retain their colors. Selected dropdown options show a check; selection
does not permanently apply hover background. Focus remains visible without a
second overlapping border. Respect reduced-motion preferences.

Workspace tabs use 52px height and 18px navigation icons. Hover adds a neutral
surface without a border; selected tabs use contrast text and a 2px underline
(white in dark theme, dark in light theme), with no persistent fill. Analytics
source tabs stay beside Analytics on the same horizontally scrolling row, with
no vertical separator. Keyboard focus retains its visible outline.

## Components and language boundaries

| Owner | Use |
| --- | --- |
| `FxSelect` | Single/multiple, search, disabled choices, select all/mixed, keyboard and native scrollbar |
| `SessionFilter` | Raw session names and full-row multi selection |
| `AnalyticsFilterBar`, `LedgerFilterDrawer` | Draft editing; Apply commits filter scope |
| `TimeFilter`, `DateFilter` | Native typed input plus calendar; ISO values and IANA timezone IDs |
| `SessionSettingsDrawer`, `SessionActionDialog` | Focus management, cancel, immutable facts, archive/restore/delete confirmation |
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
