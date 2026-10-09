# Session period acceptance — 2026-10-09

The asset picker no longer displays recent/downloaded group headings. Recent
versions still sort first without duplication. Selecting assets reveals a
compact UTC session period: required initial date, calendar/random date,
automatic/custom end and +1D/+1W/+1M shortcuts. Month shortcuts clamp to the last
valid day; unavailable durations are disabled. No common range or invalid dates
prevent submission.

## Verified scope

- 13 frontend unit tests passed: catalog order/deduplication, UTC conversion,
  range intersection, invalid dates, calendar month/leap-year and random bounds.
- Production Vite build passed. Actual local GET-only UI QA passed six
  dark/light cases at 1710, 1440 and 360px. Date fields align at 36px on desktop;
  mobile stacks without overflow. Asset-field regression passed six cases.
- Independent frontend review accepted the visual/interaction scope.
- [Backend receipt](backend.md): 155 tests + 21 subtests passed, including
  financial protection, mixed timeframes, gap dates, reload, branch and legacy
  behavior. Frozen command/OpenAPI schema check passed for 102 routes.
- [Real integration](integration.json) used a disposable PostgreSQL instance,
  actual Axum/domain/research workers and the production frontend, with two
  synthetic 40-bar M1 datasets. All fixture processes were stopped afterward.
- [Browser journey](integration-browser.json): auto start at cursor 10 opened
  the chart with 11 historical bars; custom start 10/end 12 completed after two
  steps, disabled stepping, exposed no later bars and retained its period on a
  fresh GET. Workspace navigation preserved the shell with one document load.

The first integration attempt failed because the new test expected HTTP 200
for creation; the actual API correctly returned 201. The assertion was corrected
and the complete isolated acceptance rerun passed. This was a test issue, not
hidden/mocked API success.

The owned local API on port 8010 was restarted only after idle/schema preflight,
without migrations. The existing owner's session was not stepped, changed or
recreated. Screenshot/browser QA uses read-only APIs and blocks mutations.

## Semantics and limits

Requested dates persist alongside resolved native bar bounds. Earlier bars are
context; execution cannot pass the selected end. Dates inside a market gap can
resolve to different actual bar times. Multiasset replay advances at a common
closed-bar clock; mixed timeframes can yield different active-asset timestamps.
No new full-dataset decode is introduced. This is scoped replay-period acceptance,
not a capacity benchmark or whole-product acceptance. Prop creation retains its
existing availability and domain restrictions.
