# Owner-absence watchdog and alert contract — R1

`owner_absence_alerts.py` adds the deterministic offline boundary that was
missing from the departure-readiness audit. Heartbeats become `healthy` or
fail-closed `paused` (including clock skew), while fenced supervisor events
produce a bounded retry plan at 0/60/300 seconds. The ledger deduplicates by
`(run_id, fence_token, event_type, event_id)`, escalates P0 events to the owner
and delegate, and requires manual acknowledgement after retry exhaustion.

An attempt is never reported as delivered merely because a sink is configured
or reachable. Delivery becomes true only when the caller supplies an explicit
receipt for the exact dedupe key. The module has no process, network, provider,
broker, OAuth, Job12, or execution path and remains `PREP_ONLY_OFFLINE`.

Focused validation: **34 passed** across the alert, host, lease, journal, and
supervisor contracts. Compileall passed; Ruff was unavailable in the bundled
environment (`command not found`).
