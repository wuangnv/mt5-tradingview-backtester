# Chart intelligence stress audit — R1 (2026-09-27)

## Scope

This receipt covers the deterministic, provider-free C1 chart intelligence and overlay contract only. It does not enable a broker, provider, alert delivery, chart renderer, or order route.

## Focused validation

Command:

```text
$env:PYTHONPATH='.'; uv run pytest -q tests/test_chart_intelligence.py tests/test_chart_overlay_contract.py tests/test_chart_intelligence_stress.py
```

Result: **22 passed in 0.45s**.

The stress additions cover:

- malformed timestamps, OHLC bounds, negative volume, and unsupported bar fields fail closed;
- post-fallback `Europe/London` session boundaries use the correct UTC offset;
- exactly 256 overlay events validate, while 257 events fail closed at the contract cap;
- a 20,000-bar prefix replay produces the same event identities as the full input at the same cutoff.

## Runtime probe

An additional disposable in-process probe processed **100,000 bars** in **1.007376 seconds**, emitted **11,764 events**, and produced **11,764 unique event IDs**. The fixture is synthetic and contains no provider, broker, account, secret, or network path.

## Explicit limits and follow-up gates

- `validate_overlay_packet` intentionally caps one packet at 256 overlays. A caller with more events must paginate or window packets before a renderer integration is accepted.
- Session matching is wall-clock based in the declared IANA timezone. A session interval that itself crosses a DST fold (for example `01:30-02:30` in `Europe/London` on the autumn transition) is ambiguous and can produce a close/reopen pair across the repeated hour. A future MTF/session slice must choose and test an explicit fold policy (first occurrence, second occurrence, or continuous UTC interval) before renderer acceptance.
- The 100,000-bar probe is a runtime signal, not a performance SLO or production capacity claim. Memory/renderer limits, multiple symbols/timeframes, and concurrent streams remain untested.
- This receipt is **PREP_ONLY**. It does not claim SMC/ICT completeness, MTF correctness, AI quality, live data correctness, or trading safety.
