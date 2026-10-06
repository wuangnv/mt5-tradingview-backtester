# Live and Market Data UI — 7 October 2026

Scope: apply the accepted Testing control system and vintage project palette to
canonical Market Data and six Live surfaces, adapting the owner's FX Replay
references. Strategies and the Trading chart are outside this change.

## Result and ownership

Market keeps its existing reader, filtering, update request and replay-link
contracts. Its stylesheet supplies eagerly loaded button/pager geometry for the
shared DataDesk consumer. Live reuses the existing workspace-local status reader
and polling, with a shared real/demo presentation for Calendar, Trades, Notes,
Tag analysis, Analytics and Accounts. EN/VI copy and responsive layouts are in
the same components. No new dependency or provider integration was added.

Filters have draft and applied state. Applied changes reset local deal paging;
polling retains the user's page. Net deal P/L includes every supplied cost,
excludes cashflows, and remains unknown if costs are incomplete. Calendar only
uses zero for fully covered empty days. Synced deals are not paired trades, so
win rates, account-equity curves and capital returns are not invented.

Unspecified actions open a local preview that explains no changes are saved and
no connection is made. Closing/Escape restores focus. This deliberately lets the
owner review the reference UI before defining persistence/integration behavior.

## Verification

- Final Vite build and diff whitespace check pass.
- Primary final rerun: 20 focused model, reader, locale/preferences, demo,
  workspace-navigation and data-helper tests pass.
- Primary seven interaction journeys pass; a separate positive canonical
  DataDesk probe confirms a 56px flex pager and 64px selector without Testing
  area opt-in. Fixtures are explicitly intercepted QA data.
- Independent review: 64 real/demo route cases across EN/VI, dark/light and
  desktop/mobile; 16 Axe scans with zero violations; eight synthetic state
  cases; 17 financial-model oracles; eight accepted interaction journeys;
  four locale delta cases; 16 accepted layout cases. See
  `independent/REVIEW.md` and `independent/final-receipt.json`.
- Accepted source boundary: r5 full matrix, r6 copy delta, r7 shared control
  layout, r8 eager catalog styles. The receipt pins 27 current source files.
  Rejected DataDesk cases that forced Testing styles remain diagnostic evidence.
- Primary visually inspected final Calendar, Accounts mobile, canonical Market
  desktop/mobile and positive natural DataDesk screenshots.

## Limits and resume

Actual GET `/api/v2/live/status` for tenant-a returned `unavailable` with
`execution_capability=false`. Positive financial journeys use demo or labeled
fixtures. This is UI/read-route acceptance, not broker, accounting, execution or
integration acceptance. QA did not invoke downloads, practice creation, provider
connection, file uploads, persistence writes or broker sends.

The local UI remains at port 5180 and the API at port 8010. Use Live's demo toggle
to inspect populated states. UI contract: `ui/live-market-standard.md`.
Browser QA runners under `independent/` run from the product root; primary
interaction/probe runners run from `foundation_v2/web`. Large screenshots,
build output and rejected diagnostics stay local; accepted receipts and runnable
checks are committed with the implementation.
