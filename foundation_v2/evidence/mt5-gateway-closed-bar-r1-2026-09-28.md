# MT5 gateway closed-bar boundary — R1 (2026-09-28)

Status: **PREP_ONLY / static gateway hardening**.

The EA history response now carries an explicit closed/provisional state for each `GET_DATA` row. The latest tick-backed row remains available for current chart behavior, but is marked `closed=false` and `provisional=true` so canonical closed-bar adapters can drop it rather than treating a live tick as historical evidence. Older rows are marked `closed=true` and `provisional=false`.

The gateway also rejects unknown timeframe strings instead of silently falling back to `PERIOD_CURRENT`, and bounds `bars` requests to `1..100000` before `CopyRates`.

Validation:

- Static contract test: `PYTHONPATH=. uv run pytest -q tests/test_gateway_closed_bar_contract.py tests/test_mql_parity.py` — **13 passed**.
- `git diff --check` for the gateway/test slice — **pass**.
- MetaEditor/terminal compile was not available in this environment; this receipt does not claim EA binary acceptance or terminal runtime acceptance.

Commit: `fff5cc1 fix(mt5): mark forming history rows provisional`

No broker order, provider, network, OAuth, holdout or live execution was started. The existing demo/live permission gates remain unchanged.
