# Owner-absence safety contract r1

This offline slice gives the system an explicit `research`, `paper`, or
`advisory` absence mode. The default is `research`. Every mode carries the
literal `execution_capability=false`; `paper` means local accounting only and
does not grant broker or live authority.

`evaluate_owner_absence` returns `allow` only when the kill switch is clear and
all required evidence is present and fresh: lease expiry, heartbeat, resource
check, and data observation. Missing, future, expired, or stale evidence stops
the run with stable stop reasons. A supplied data cutoff rejects observations
after the cutoff to prevent look-ahead leakage.

The module is pure and has no scheduler, network, provider, broker, OAuth,
secret, or persistence side effect. It is a policy projection for a future
orchestrator, not a background process or a claim that the unattended system
can earn money.

Validation: `pytest -q tests/test_owner_absence_safety.py` (run locally before
publishing this receipt).
