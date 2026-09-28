# Owner-absence host startup seam — R1

## Result

`OwnerAbsenceHostSupervisor` is a project-local, offline startup boundary around
the existing pure reducer and hash-chained journal. `cold_start()`/`status()`
replay the complete JSONL before reporting the persisted lifecycle. A missing
journal returns a safe `new`/not-ready snapshot; an existing empty, truncated,
malformed, tampered, or lifecycle-inconsistent journal raises and is never
repaired automatically. `tick()` performs reduction and append under one OS
lock acquisition, so a competing stale writer cannot append from an obsolete
snapshot. The journal flushes and `fsync`s each event, and exact re-append of a
durable step remains idempotent.
Event timestamps are required to be nondecreasing, so a rolled-back host
clock cannot append a later lifecycle event as if it were fresh.

When a fresh host object replays a persisted `running` snapshot, it marks the
host not-ready and rejects the persisted fence. A new fence first records a
fail-closed `stop`; only a subsequent tick can perform the reducer's explicit
`restart`. This prevents a reboot from silently continuing an old owner
attempt.

The seam intentionally does not spawn/restart child processes, acquire or renew
leases, call providers, send broker orders, touch Job12, or grant an execution
capability. Process ownership/watchdog/alerting and cross-project registry are
separate P0 work; this receipt only closes the local cold-start/replay/CAS
boundary.

## Verification

From `projects/mt5-tradingview-backtester`:

```powershell
$env:PYTHONPATH='.'
uv run --directory foundation_v2 pytest -q `
  tests/test_owner_absence_journal.py `
  tests/test_owner_absence_host.py `
  tests/test_owner_absence_supervisor.py `
  tests/test_paper_execution_bridge.py
```

Result: **32 passed**. `uv run --directory foundation_v2 python -m compileall -q
trading_workspace_v2` and `git diff --check` also passed.

The adjacent safety-contract regression set (adding
`tests/test_owner_absence_safety.py`) also passed: **42 passed**.

The focused host tests cover safe cold start, durable start/continue/replay,
stale-writer CAS rejection, reboot/new-fence recovery, exact journal retry
behavior, clock rollback, nested OS-lock contention, final-line truncation, and
the literal false capability boundary, including preserving the reboot fence
requirement after a busy append.
