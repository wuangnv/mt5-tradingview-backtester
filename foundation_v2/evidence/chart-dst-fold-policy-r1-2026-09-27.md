# Chart session DST autumn-fold policy — R1 (2026-09-27)

Status: **PREP_ONLY**. This receipt closes the autumn-fold ambiguity identified
by the chart stress audit for the deterministic, offline session detector. It
does not enable a renderer, provider, alert route, broker, or order execution.

## Policy

`SessionSpec.dst_fold_policy` is explicit and defaults to `reject`:

- `reject` fails closed when an observed UTC bar maps to an ambiguous local
  wall-clock time that is inside the session. The error names the session and
  asks the caller to choose an occurrence. This prevents the detector from
  silently turning one local session into two different UTC intervals.
- `first` accepts only the first occurrence (`datetime.fold == 0`) of an
  ambiguous autumn local time. Unambiguous local times remain eligible.
- `second` accepts only the second occurrence (`datetime.fold == 1`).
  Unambiguous local times remain eligible.

The implementation verifies that both fold candidates round-trip through UTC;
spring-forward nonexistent wall-clock values are not treated as an autumn
fold. Session start remains inclusive and end remains exclusive. The selected
policy is included in session event parameters and in the indicator parameter
hash so a renderer/cache cannot accidentally reuse a definition with a
different fold interpretation.

The default remains fail-closed. A caller that wants deterministic historical
replay across an autumn transition must opt into `first` or `second` and keep
that choice in the persisted indicator definition. The implementation does
not infer a policy from the exchange, symbol, or local machine timezone.

## Europe/London fallback fixture

The fixture uses 25 October 2026, when `01:30` occurs once in BST and once in
GMT. For a `01:30-01:45` session:

- the default `reject` policy raises on the first in-session ambiguous bar;
- `first` emits only the 00:30 UTC occurrence and its close;
- `second` emits only the 01:30 UTC occurrence and its close;
- the two policies never produce a duplicate/reopened session for the other
  occurrence.

## Validation

```text
$env:PYTHONPATH='.'; uv run pytest -q tests/test_chart_intelligence.py tests/test_chart_intelligence_stress.py
23 passed in 0.43s

$env:PYTHONPATH='.'; uv run pytest -q tests/test_chart_intelligence.py tests/test_chart_intelligence_stress.py tests/test_chart_overlay_contract.py tests/test_chart_renderer_contract.py tests/test_chart_ai_contract.py
46 passed in 0.63s

uv run python -m compileall -q trading_workspace_v2 tests/test_chart_intelligence.py tests/test_chart_intelligence_stress.py
PASS
```

The original stress audit remains a historical baseline; its open
`dst-fold-ambiguity` item is resolved by this follow-up receipt. Remaining
limits are sparse bars that skip the entire repeated hour (the detector cannot
observe an ambiguity it never receives) and future renderer/alert integration.
