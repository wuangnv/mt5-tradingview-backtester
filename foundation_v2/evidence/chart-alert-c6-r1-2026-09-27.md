# Chart alert C6 — R1 (2026-09-27)

## Scope

This receipt covers a deterministic, provider-free **local/advisory** alert
contract for confirmed chart events. It is a receipt boundary only. It does
not deliver a notification through an external service, call an AI provider,
connect to a broker, create an order, or represent a fill.

## Contract

`chart_alert_contract.py` validates a closed rule schema and canonical event
snapshots. A rule is mandatory `confirmed_only`, uses `dedupe_event_id`, and
is fixed to `local_advisory`, `PREP_ONLY`, and `offline-advisory`. Every
emitted receipt contains the normalized rule snapshot, the input snapshot and
its SHA-256 identity, the confirmed event snapshot, causal `known_at`, cutoff,
and bounded expiry timestamp.

The dedupe identity is `(rule_sha256, event_id)`. Carrying the returned
`AlertLedger` across reconnect or replay suppresses an already delivered
receipt. A provisional/invalidated event is never emitted. Expired matches are
recorded in the ledger as expired and are not emitted later. No wall-clock is
used: receipt emission time is the event's causal `known_at`, so the same
replay produces stable identities.

## Focused validation

```text
$env:PYTHONPATH='.'; uv run pytest -q tests/test_chart_alert_contract.py
13 passed
```

The tests cover canonical rule hashes, confirmed-only filtering, snapshots,
reconnect dedupe, replay dedupe, expiry, rule filters, disabled rules, cutoff
look-ahead rejection, rule/ledger mismatch, duplicate input, execution-looking
payload rejection, receipt tampering, and ledger round-trip stability.

## Sample identity

- rule SHA-256: `b28cde8e0b77f2ed26333a47d3f32135f5bccb825cb16b9192cd9d027a5d402a`
- input snapshot SHA-256: `7d949efe4e20cc62393aa037a59041f10a59e338946abb8e379540cdfbf674f1`
- alert ID: `6c3284e6bbd94e4df6edaf2d30f44dea65bf54fcdaa031a9914fcafcbf981981`

## Explicit limits

This is **PREP_ONLY**. It does not implement a notification worker,
subscription persistence, push/email/Telegram delivery, alert scheduling,
renderer integration, AI scoring, broker access, or execution permission.
Those adapters require separate contracts and gates.


