# API platform gap audit — 09/10/2026

Result: **source/documentation audit completed; operational gaps identified**.
This is not a product implementation, new load test or production acceptance.
Source baseline: product `1ffe06e`, root `3dc66c31`, with unrelated CSS changes
preserved. Architecture owner: `../../docs/API-STACK-DECISION-20261009.md`.
Scope/progress remains with the canonical Product Completion Plan.

The owner approved the measured Axum target and requested review of queue,
server file storage, logs/metrics and other omissions. Findings were checked
against current source and primary documentation; no database/service was changed.

## Source findings and reproducible pointers

Paths below are relative to `foundation_v2/`; function names are the durable
search anchors. Line numbers refer to the audited snapshot.

| Finding | Evidence | Interpretation |
| --- | --- | --- |
| Research queue already exists | `trading_workspace_v2/store.py:1118–1258`, `_recover_expired_jobs`, `claim_next_job`, `renew_job_lease`; `complete_job` at 1260 and `fail_job` at 1381 | Claims commit before work; SKIP LOCKED, attempts/tokens, cancellation and expiry checks already implemented. Recovery requeues expired work; these paths have no scheduled backoff/max-attempt admission predicate |
| Bounded worker foundations exist | `trading_workspace_v2/worker.py:20–60`; `research.py:941–1012`; `nautilus_worker.py` child process memory/runtime budget | Global active cap and lease heartbeat exist. This does not establish fairness, aggregate deployment budgets or provider worker isolation |
| Download authority differs from research | `trading_workspace_v2/dukascopy_downloads.py:141–153`, `_read`, `_save`; `_run` at 311; `qdm_downloads.py:89–111`, `_public`, `pause`, `cancel`; `_run` at 131 | Filesystem job.json plus PostgreSQL advisory locks. QDM declares no pause/cancel and null transferred_bytes; preserve these limits during migration |
| Local immutable artifact foundations exist | `trading_workspace_v2/artifacts.py`, `_safe_component`, `write_dataset_iter`, `write_raw_source`, `write_result_candidate`, `quarantine_result_candidate`; `store.py`, `complete_job` | Relative scoped paths, hashes, temp files and attempt publication already exist. No S3 backend in this module. Rename/checksum is not a universal crash-durability/no-overwrite guarantee |
| Some range reads still scan all file content | `trading_workspace_v2/artifacts.py:185`, `read_dataset_range` | Full SHA-256 read followed by iteration of all batches and Python timestamp filtering. Returned max_bars does not bound total bytes scanned. Other readers may differ; this finding is specific to this path |
| Connection churn and N+1 remain | `trading_workspace_v2/store.py:534`, `connect`; `1558`, `list_records` | Fresh psycopg.connect each call; IDs followed by per-record get_record. Rust must replace the access pattern, not reproduce it |
| Pagination follows full projection | `trading_workspace_v2/trades_page.py:69–165`, `build_trades_page`; earlier `../performance-assessment-20261009/RECEIPT.md` | Journal matching and filtering precede slicing. Preserve counts/facets and stable ordering when moving pagination toward its source |
| Lazy UI imports exist; shell navigation still uses document links | `web/src/main.jsx:1–12`; `web/src/FxReplayShell.jsx:258,279,322,337,341` | Lazy chunks do not keep shell state alive across document navigation. Client navigation and scoped request/cache lifecycle remain separate work |
| Local auth and lifecycle exist | `trading_workspace_v2/auth.py`, `LocalWorkspaceAuthorization.status`; `api.py:245`, `lifespan`; `314`, `health` | Explicit local-only identity/membership, shutdown hooks and informational health response. Health does not check current DB readiness; not hosted multi-user authentication |
| General operational telemetry not found in reviewed runtime | `trading_workspace_v2/api.py` middleware/health; search of `trading_workspace_v2/*.py` and `pyproject.toml` for tracing/prometheus/opentelemetry | Body request_id fields are domain commands, not general request tracing. No verified runtime metrics exporter or global correlation middleware in this scope; server access logs/PnL metrics are insufficient |
| Schema evolution and restore foundations exist | `trading_workspace_v2/store.py:250+`, SCHEMA_SQL and `initialize`; `scripts/f7_restore_rehearsal.py:223–304`; `evidence/F7-restore-rehearsal-r1.json`; `evidence/wm-all-plan-20261002/restore/restore-final.json` | Embedded initialization DDL; prior receipts report PASS for synthetic DB dump/restore plus artifact copy. Reviewed historical receipts, not rerun here; not a current online backup/PITR/restore guarantee |
| Measured Rust driver is already available | `experiments/api-stack/rust/Cargo.toml` and Cargo.lock | deadpool-postgres + tokio-postgres; reuse as first port candidate. SQLx documentation reviewed as alternative; no comparative driver benchmark conducted |

## Research and decisions

- PostgreSQL explicitly supports SKIP LOCKED for queue-like consumers, while
  warning that it gives an inconsistent general read view. Use for claims, not
  ordinary financial report consistency:
  https://www.postgresql.org/docs/current/sql-select.html
- NOTIFY delivers after commit, may fold duplicate payloads, and is not durable
  replay history. Reconnect reads committed scoped state; notifications carry
  only small non-sensitive invalidations:
  https://www.postgresql.org/docs/current/sql-notify.html
- Private server disk is the current local artifact target. S3 is the multi-host
  target, with checksums/manifests, interrupted-upload cleanup and scoped access.
  S3 consistency is not a DB/blob atomic transaction or proof of compatibility
  for another provider:
  https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html
- DuckDB supports projection/filter pushdown and row-group skipping when metadata
  permits. This is a candidate for existing read paths, not an automatic benefit
  from retaining the dependency:
  https://duckdb.org/docs/current/data/parquet/overview
- Structured Rust logging is supported by tracing-subscriber JSON formatting.
  Official OpenTelemetry Rust documentation labels all three signals Beta at
  audit time; exporter version/compatibility needs its own validation:
  https://docs.rs/tracing-subscriber/latest/tracing_subscriber/fmt/index.html
  https://opentelemetry.io/docs/languages/rust/
- Tower limits and Tokio blocking-task documentation support bounded execution;
  already-started spawn_blocking work cannot be canceled by abort alone:
  https://docs.rs/tower/latest/tower/limit/index.html
  https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html
- Rust PostgreSQL pools need deployment-wide limits, timeout/readiness and
  session-lock handling. Deadpool creation alone does not establish DB health:
  https://docs.rs/deadpool-postgres/latest/deadpool_postgres/
  https://docs.rs/sqlx/latest/sqlx/struct.Pool.html
- Preserve and extend existing restore work; define loss/time targets and test
  consistent metadata plus artifact recovery before hosted operation:
  https://www.postgresql.org/docs/current/backup.html

No new packages, paid infrastructure, hosted provider, credentials or global AI
configuration were installed/changed. No performance percentage or capacity was
measured by this audit. Earlier API-stack fixture and performance-probe receipts
retain their original scope and limitations. Documentation/source references and
scoped diff checks are the validation appropriate to these changes.
