# Chart zone lifecycle receipt r1

**Scope:** deterministic offline order-block (OB) and optimal-trade-entry
(OTE) zone contracts for the foundation chart research slice.

## Contract

- `ORDER_BLOCK` is created only from a confirmed canonical `BOS` carrying the
  protected swing timestamp. The origin is the nearest opposite-direction
  candle strictly between that protected swing and the displacement bar.
- `OTE` is derived from an explicit, already-confirmed leg. The retracement
  interval is parameterized (the default is `0.62..0.79`), and the payload
  carries `standalone_entry=false`.
- Both zone types emit a `confirmed` transition followed by zero or more
  causal `mitigated`, `invalidated`, or `expired` transitions. Invalidation
  wins when the same bar both touches and crosses the invalidation boundary.
- Every transition carries an immutable zone ID, event ID, source bar IDs,
  `known_at`, rule/config parameters, and a deterministic SHA-256 identity.
  A cutoff only emits transitions known at or before that cutoff.
- The schema is `chart-zone-transition-v1` and remains `PREP_ONLY` with
  `execution_capability` absent by design. It is not an alert/fill/order
  receipt and is not yet wired into Pine/MQL render adapters.

## Validation

```text
PYTHONPATH=foundation_v2 uv run pytest -q foundation_v2/tests/test_zone_lifecycle.py
12 passed

PYTHONPATH=foundation_v2 uv run python -m compileall -q \
  foundation_v2/trading_workspace_v2/zone_lifecycle.py \
  foundation_v2/tests/test_zone_lifecycle.py
PASS

git diff --check -- foundation_v2/trading_workspace_v2/zone_lifecycle.py \
  foundation_v2/tests/test_zone_lifecycle.py
PASS
```

This evidence uses only synthetic bars. No provider, broker, account, holdout,
network, or execution route was opened. The focused suite does not claim Pine
or MQL byte-for-byte parity, profitable expectancy, or production chart/UI
acceptance.
