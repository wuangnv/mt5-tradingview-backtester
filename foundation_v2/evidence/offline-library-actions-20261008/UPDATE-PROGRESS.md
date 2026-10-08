# Update progress verification and activation status — 2026-10-08

The owner clarified that dataset updates must use the same inline transfer
progress as initial downloads. Current application source already shares
`openDownload` and `DataLibraryProgress`: an update sends the selected
`dataset_id` with its instrument, then displays the job in that instrument's
grid row. No separate progress implementation or new application change was needed.

Expanded `independent/qa.mjs` verifies an enabled update action, exact payload,
inline transferred MiB / unknown total, sampled MiB/s, completed-day percentage,
processing with no network speed, progress dialog access, completion refresh,
disabled update after completion, and stable column geometry throughout.
The expanded full browser journey passed 4/4: dark/light, 360px Vietnamese and
1440px English. Network routes are explicit fixtures; no actual download,
deletion, catalog refresh, owner database write, or broker action occurred.
Results: `independent/update-results.json`. Original accepted
`independent/results.json` remains intact.

The first rerun exposed an outdated cancellation test oracle: it clicked Close
after cancellation had already closed the dialog automatically. All four
timeouts are preserved in `independent/update-first-run-results.json`. The test
now asserts automatic dialog disappearance. No application change was required.

## Runtime activation remains pending

The owner explicitly approved restarting local API8010. The prior stop/start
tool call was rejected before execution by automatic approval review with only
`blocked by policy` given as its reason. This follow-up did not retry that
rejected process operation through another interpreter or script.

Read-only checks confirmed listener PID1364 and launcher parent PID19248,
both running `serve_exness_history.py --port 8010`, with no MT5/ticks option.
There is no attached app terminal or reload/shutdown interface. Actual API GET
still reports 1 dataset, 1504 catalog instruments, zero queued/running jobs,
and missing `supports_full`; the old API remains in use and full actions stay
disabled. Fixture PASS does not establish activation in the owner's service.

Manual activation, preserving the existing database environment:

1. Stop only this API's existing launcher (Ctrl+C in its owning terminal, if
   available). If stopping by PID, recheck port8010 and both command lines
   immediately beforehand; the PIDs above are an observation, not permanent IDs.
2. From `D:/ANNAM/TradingWorkspace/projects/mt5-tradingview-backtester/foundation_v2`,
   run `./.venv/Scripts/python.exe -B scripts/serve_exness_history.py --port 8010`
   in the environment with the existing `TW_V2_DATABASE_URL` configured.
3. Reload the library page and confirm GET datasets exposes
   `download_state.supports_full: true`. No test download/delete is necessary
   for this activation check. MT5 is not enabled by this command.
