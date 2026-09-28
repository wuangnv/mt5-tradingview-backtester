# Owner-absence supervisor r1

This receipt covers the pure `owner_absence_supervisor` reducer added on
2026-09-28. It wraps the owner-absence freshness decision with a durable,
fail-closed lifecycle: `new -> running`, exact-identity `continue`,
`recovery_required`, bounded `restart`, and permanent `quarantined` state after
the restart budget is exhausted.

The reducer requires a new fence token after a stop. A stale worker cannot
continue under a changed run identity, and a quarantined snapshot cannot be
revived by fresh evidence alone. Every returned decision retains the literal
`execution_capability=false` contract.

Validation run from `foundation_v2`:

```text
python -m pytest -q tests/test_owner_absence_safety.py tests/test_owner_absence_supervisor.py
15 passed in 0.29s
python -m pytest -q tests/test_execution_intent_contract.py tests/test_paper_execution_bridge.py tests/test_owner_absence_safety.py tests/test_owner_absence_supervisor.py
31 passed in 0.36s
python -m compileall -q trading_workspace_v2
git diff --check
```

This is offline software evidence only. It does not start or restart a process,
renew a lease, call a provider, access a broker, or authorize live execution.
The host supervisor still owns persistence, process management, alert routing,
and any owner-controlled reset of a quarantined snapshot.
