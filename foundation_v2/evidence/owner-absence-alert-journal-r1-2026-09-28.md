# Owner-absence durable alert outbox — R1

`owner_absence_alert_journal.py` closes one offline portion of the P0 alert gap:
the pure retry/dedupe decision is now persisted as a local, hash-chained JSONL
outbox.  Each transition replays the previous ledger, evaluates one fenced
event batch while holding the same non-blocking OS lock used by the supervisor
journal, writes one canonical line, flushes and `fsync`s it, and only then
returns.  A missing outbox is an empty, not-ready ledger; malformed, truncated,
reordered, tampered, or semantically inconsistent bytes fail closed.

The outbox records input events, supplied sink receipts, the resulting retry
ledger, escalation and acknowledgement state.  A duplicate event therefore
cannot silently create a second delivery attempt before the retry delay, and a
future adapter can resume from the last verified ledger.  `expected_previous_
event_hash` provides a compare-and-swap guard for stale callers.

This is still **PREP_ONLY_OFFLINE**.  It does not send notifications, provide
an owner/delegate channel, supervise a process, renew a lease, access a
provider/broker, touch Job12, or grant execution capability.  A sink receipt
must still come from an explicitly reviewed adapter.

## Verification

From `projects/mt5-tradingview-backtester`:

```powershell
$env:PYTHONPATH='.'
uv run --directory foundation_v2 pytest -q `
  tests/test_owner_absence_alert_journal.py `
  tests/test_owner_absence_alerts.py `
  tests/test_owner_absence_host.py `
  tests/test_owner_absence_lease.py `
  tests/test_owner_absence_lease_binding.py `
  tests/test_owner_absence_journal.py `
  tests/test_owner_absence_supervisor.py
```

Result: **42 passed**.  Compileall and `git diff --check` passed.  Focused
tests cover first durable append, restart replay, early duplicate suppression,
bounded retry/manual acknowledgement, stale-writer CAS rejection, tamper
failure and torn-tail failure.

The remaining P0 gap is the adapter/host wiring: no external delivery or
unattended process supervisor is claimed by this receipt.
