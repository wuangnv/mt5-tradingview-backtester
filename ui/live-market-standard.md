# Live and Market Data UI contract

Live and the Testing Market Data catalog consume `testing-standard.md` and
`project-palette.md`. FX Replay references guide layout only. Source data,
read access and unknown states come from this project's existing adapters.

## Ownership and presentation

- `testing-standard.css` explicitly opts Live into Testing typography, control
  sizes, pill/circle geometry, focus/hover, peach actions and report colors.
- `LiveWorkspace` owns the existing workspace-local reader, five-second polling,
  loading, unavailable/locked/denied, stale snapshots and compact source disclosure.
- `LiveSurfaces` owns Calendar, Trades, Notes, Tag analysis, Analytics and Accounts.
  Demo calls the same component with `DEMO_LIVE`; it never calls the live reader.
- `LiveBrokerSnapshot` renders account facts, positions, orders, quotes, raw deals
  and separate transactions. Its pagination is local to the synced snapshot.
- `MarketAssetCatalog` remains shared by canonical Market Data and DataDesk.
  Search/group/enabled filters, dates, existing update requests and replay links
  retain their existing data contracts. Update actions are disabled in demo.
  Its own stylesheet supplies button and pager geometry so DataDesk does not
  depend on Testing opt-in or a previously visited Analytics route.
- Shell supplies one main landmark for canonical Live/Market Data. Accounts uses
  `account_tab=connect|transactions` children with the existing continuous peach
  parent underline; selected children use contrast text without a hover fill.

Calendar uses a Monday–Sunday grid, week totals, soft-peach month total and
Analytics side region. Trades uses its deal table plus the Analytics side region.
Notes retains the reference toolbar/group/empty arrangement. Tag analysis keeps
its curve/list/summary arrangement without inventing broker tags. Accounts uses
account facts and an Add account side region. At narrower widths, side regions
stack below content; calendars and tables scroll within their own regions.

## Data and state

`liveWorkspaceModel.js` is the read model. Deal net requires finite numeric
profit, commission, swap and fee. Deposits and withdrawals never enter deal P/L.
Missing fees remain unknown. Deal entries/exits are not paired into complete
trades, so no trade win rate, duration, or equity curve is inferred.

Calendar buckets use the selected IANA timezone. A fully covered empty day can
show zero. Missing feeds, absent coverage bounds, future days and incomplete
boundary days remain unknown when they have no recorded deals. Totals explicitly
cover synced deals only. Percent return requires opening capital and remains
unavailable when that capital is missing. Analytics plots cumulative deal P/L,
not account equity; an incomplete net result stops the cumulative curve.

Filters use draft state; Apply commits it. Clear restores the default scope.
Search, page size and applied filter changes reset local paging. Polling does not
reset a user's selected page. No server paging capability is claimed for an API
that returns the entire synced snapshot.

Errors keep previous data with a stale warning. Denied responses, a locked or
unavailable payload and workspace changes clear account data. A current balance
is never substituted for historical opening capital. Symbols, tickets, account
references and IANA timezone identifiers remain raw when locale changes.

## Presentation-only actions

Add trade, note/group editing, Tags/Advanced, table columns, Share, monthly review,
CSV template/upload, manual accounts, broker providers and Smart Picks open a
local interface preview. That preview states that no changes are saved and no
connection is made, has keyboard/Escape dismissal and restores opener focus.
It does not select/read a file, authenticate, save an account, connect a provider,
or send an order. Backend behavior is deferred to the owner's follow-up task.

Financial fixtures and browser interceptions are labeled test evidence, never
fallbacks for actual unavailable data. Reports remain read only; Trading chart
rendering and broker execution permissions are outside this UI change.
