# Baseline and reuse contracts

GET-only baseline4 demo/real×dark/light cases passed with11 source hashes unchanged; zero runtime/write/download/external violations. Captures and persisted GET oracles in `baseline.json`.

| Control | Real baseline | Demo baseline |
| --- | --- | --- |
| Performance source | Backtesting, Battles unavailable, Prop Firm, All | All sessions plus3 session names; wrong domain |
| Period | Last week, Last month, Lifetime, custom | Same |
| Recent sort | Newest, oldest, last updated, most profit | Only newest/oldest |
| Recent filters | Assets, Strategy, active/all/archived | Missing |
| Recent actions | Kết quả + overflow links to rename/duplicate/archive | Kết quả only |

Reuse `dashboardRecentSessions` for search/status/asset/strategy/sort, including comparable-currency profit guard. `readDashboardAnalytics` validates schema/scope/ledger, fails closed, preserves unavailable data. Actual catalog6 sessions,5 archived,1 active; active old session revision2/uninitialized/cursor500 of93810. Archived XAU revision6/cursor1061 has one closed trade, net-0.24USD, balance10000→9999.76. Initialized-empty archived EUR has0 closed trades. Prop GET has0 reports; no populated real Prop financial acceptance possible.

`SessionPerformance` already contains balance curve/month P&L/weekday P&L charts; its rows0 branch currently hides charts. `sessionPeriods` uses last historical close as calendar anchor and refuses incomplete close/P&L. `dashboardCurve` requires verified full curve/starting balance. Reuse these guards rather than rebuilding numbers from row labels. Real invested/replayed times lack source and must remain unknown.

Metadata mutation helper: PATCH `/api/v2/replay/sessions/{id}` includes `expected_revision`; branch helper: POST `/api/v2/replay/sessions/{id}/branch` includes revision/cursor. Existing SessionPicker handlers preserve notices and disabled archived/unavailable copy states. Reviewer will inspect real routing/dialog cancel/disabled behavior and source contract; never call these writes. Demo local mutations explicitly allowed and must cause0 API calls.

Shared option/search correction affects FxSelect, SessionFilter and native picker policy. Check unhovered/unfocused selected background separately from transient hover/keyboard focus; tick/checkbox and keyboard focus must survive. Search popup border/input border inherited from dashboard generic CSS may conflict; inspect computed border/focus plus images, not selector presence alone.
