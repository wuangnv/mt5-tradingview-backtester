# Testing page-state workflow QA

Task started 2026-10-10; final validation completed 2026-10-11.

Each Testing page previews its own resource workflow. A disconnected download
provider does not hide persisted sessions, trades, reports or downloaded datasets.
No sessions uses shared welcome presentation; no closed trades is a separate
known-zero state. Refresh keeps data only for the same scope; failed background
reads become stale, while 401/403 clears retained data.

## Results

| Check | Result and scope |
| --- | --- |
| Preview browser matrix | PASS 212 cases; five Testing routes, supported states, dark/light, 1710px/390px; no page errors, real API reads or writes |
| Real component browser checks | PASS 14 cases; actual local GET smoke plus explicitly intercepted response fixtures for pending, empty, 503 and 403; no writes |
| Focused Node tests | PASS 31 tests covering preview selection, dashboard reads/top-three behavior, copy and trade pagination contracts |
| Backend dashboard tests | PASS 10 tests, including bounded summary/cache reads on a 1000-record fixture |
| Production Vite build | PASS |
| Independent review | Accepted; source scope guards plus independent aggregate 503/retry recovery and library 503/403 checks; no material findings |

`browser.json` and `real-components.json` distinguish preview/fixture checks from
actual GET smoke. Selected screenshots show centered onboarding, viewport loading,
page-scoped report failures and saved datasets retained after a failed refresh.
The historical `actual-failure.png` is a failed test artifact, not accepted evidence.

## Reproduce

With UI on 5180 and API on 8010, from `foundation_v2/web`:

```powershell
node --test tests/demoMode.test.mjs tests/dashboardModel.test.mjs tests/dashboardSessions.test.mjs tests/testingCopy.test.mjs tests/tradesPage.test.mjs
node tests/viewStatePreview.browser.mjs
node tests/pageStateReal.browser.mjs
node node_modules/vite/bin/vite.js build --outDir ../.runtime/page-state-workflow/dist --logLevel error
```

From `foundation_v2`:

```powershell
./.venv/Scripts/python.exe -m pytest -q tests/test_dashboard_sessions.py
```

## Limits

Browser failure cases are labeled intercepted fixtures, not evidence of an actual
provider outage. The owner session was not mutated. Cross-session navigation is
source-reviewed; the actual local catalog contained one session. Dashboard filters
apply across the catalog before selecting up to three; cold profit sorting may
still compute many summaries. These checks establish this UI workflow, not a
production load benchmark, live broker authority or whole-product acceptance.
