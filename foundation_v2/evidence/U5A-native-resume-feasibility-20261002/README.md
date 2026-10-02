# U5a native resume feasibility — 2026-10-02

**Decision:** keep durable mid-computation resume open. The installed primary
Nautilus 1.231.0 API supports continuing batches in the same engine/process. It
does not provide a demonstrated export/import of the complete backtest runtime.
No product runtime, configuration, database, worker or ledger was changed here.

`primitive_probe.py` runs the accepted adapter against nine synthetic bars. The
one-shot result exactly matches processing eight prefix quote events followed by
ten suffix events in the same engine; both canonical output hashes are
`12c78640b12da2a0e435e1c14b250f1e6185778388cdc08140f8216fc8ec2af1`.
The equality includes all four fills, native fill identifiers and signal counts.

At the batch boundary the first trade is closed: no pending strategy action,
open/inflight orders, open positions or strategy timers remain. Native balance is
`10004.50 USD`; the factory has emitted two client order IDs. Even there,
serializing the populated cache fails on a native struct member; serializing the
engine and kernel also fails. A registered default strategy saves `{}`. An empty
cache and one general byte entry can round-trip, which does not restore the
matching engine, kernel, account lifecycle or populated execution history.

The source audit adds constraints that an account-only reconstruction would miss:

- Fresh engine execution initializes venue accounts to starting balances.
- Strategy start sets order counters from historical orders/order lists in cache.
- Native venue order and fill counters are private Cython state. Native fill IDs
  include the execution counter; there is no audited public restoration setter.
- Strategy `save/load` hooks save only user-supplied strategy state. Trader
  `save/load` delegates to cache; persistence needs configured backing storage.
- `dump_pickled_data/load_pickled_data` serialize input data, not runtime state.
- Worker input/results live in a temporary directory, while Windows Job Object
  ownership deliberately terminates the native child when its worker dies.

The smallest supported slice is bounded **same-process streaming** using
`add_data`, `run(streaming=True)`, `clear_data` and `end`. This probe generates the
entire small source stream before batching, so it does not prove lower peak
memory. No crash/fresh-process restore oracle, protective-position recovery or
durable cursor integration was performed. Adding Redis is not a substitute for
proving that the complete exchange/matching state can be recovered.

Any future durable implementation must preserve immutable tenant/job/protocol/
dataset/cost/source/runtime identities; fence checkpoint writes by lease and
attempt; export the settled cursor plus strategy, account, cache, clock/timers,
matching/contingent-order state, deterministic IDs and RNG state; and demonstrate
a killed worker followed by a fresh process that skips prefix engine events and
matches uninterrupted business outputs and native evidence. Unsupported state
must fail closed. Replaying from the beginning remains recomputation.

Run from the product repository with the pinned runtime:

```powershell
& .\foundation_v2\engine_runtime\.venv\Scripts\python.exe -I `
  .\foundation_v2\evidence\U5A-native-resume-feasibility-20261002\primitive_probe.py
```

The script only prints JSON. It denies Python socket connection entry points,
configures no database/provider/broker client, uses generated pickle objects only
and writes no files. The caller saved stdout/stderr here. Python socket denial is
not a network sandbox for C extensions. The two stderr warnings are Nautilus's
existing deprecated `Timestamp.utcnow` call, not probe failures.

`receipt.json` pins source locations/hashes and artifact hashes;
`probe-output.json` contains the measured output and exact serialization errors.
This is feasibility evidence, not U5a, U5, or product acceptance.
