# Research checkpoint read API — PREP_ONLY receipt

Status: **PREP_ONLY / offline contract**, 28/09/2026.

This slice adds a tenant-scoped, read-only view of the latest worker checkpoint:

`GET /api/v2/research/jobs/{job_id}/checkpoint`

The route first resolves the job through the authenticated workspace, then
returns the latest validated `research-job-checkpoint-v1` record and progress
snapshot. Missing jobs remain `job_not_found`; jobs that have not persisted a
checkpoint remain `checkpoint_not_found`. The response includes an explicit
`execution_capability: false` marker and does not expose lease owner/token,
resume commands, provider credentials, broker state, holdout data, or a write
operation. Cross-workspace reads resolve to `job_not_found`.

## Verification

- `PYTHONPATH=foundation_v2 uv run --project foundation_v2 pytest -q foundation_v2/tests/test_owner_absence_host_cli.py` — **3 passed**.
- `PYTHONPATH=foundation_v2 uv run --project foundation_v2 python -m compileall -q foundation_v2/trading_workspace_v2 foundation_v2/tests/test_f7_product_slice.py` — **pass**.
- `git diff --check` — **pass**.
- The endpoint integration test is included in `tests/test_f7_product_slice.py`. It requires the existing destructive PostgreSQL fixture flag (`TW_V2_ALLOW_DESTRUCTIVE_TEST_DB=1`); that flag was not enabled for this receipt, so no shared database was mutated.

This receipt does not claim worker resume, external-provider, broker, live,
holdout, or production acceptance. A future resume operation remains a separate
authorized worker action.
