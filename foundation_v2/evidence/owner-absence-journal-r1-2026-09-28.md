# Owner-absence durable journal — R1

## Result

`OwnerAbsenceRunJournal` now provides a small local cold-start boundary around
the pure owner-absence supervisor reducer. Each accepted transition is stored
as one UTF-8 JSONL event with a contiguous sequence, previous-event hash,
transition fingerprint, and event hash. The writer takes a non-blocking OS file
lock, flushes and `fsync`s the event, and retries of the exact last transition
are idempotent.

On restore, the complete journal is verified before a snapshot is returned.
Missing journal state returns a safe `new` snapshot with
`execution_capability=false`; an empty, truncated, malformed, tampered,
reordered, or lifecycle-inconsistent journal raises a typed corruption error.
The contract does not start processes, renew leases, call providers, send
orders, or grant broker authority.

## Verification

Command (from `projects/mt5-tradingview-backtester`):

```powershell
$env:PYTHONPATH='.'
uv run --directory foundation_v2 pytest -q `
  tests/test_owner_absence_journal.py `
  tests/test_owner_absence_supervisor.py
```

Result: **13 passed** in 0.29s.

The tests cover empty cold start, hash-chain replay, snapshot restoration,
idempotent retry, tamper detection, truncated-tail detection, invalid
transition rejection, and the existing supervisor invariants.

## Remaining boundary

This is an offline persistence primitive, not a daemon or process supervisor.
The host still needs a separate, reviewed runner to call the reducer, decide
when to stop/restart, and surface a recovery alert. A corrupt journal is
intentionally not auto-repaired; preserve the file and perform an explicit
operator recovery before continuing.
