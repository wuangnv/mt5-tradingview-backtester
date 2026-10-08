# Local dataset removal and measured size

Implemented backend-only slice in `artifacts.py`, `store.py`, `data_sources.py`, new `local_datasets.py`, and focused `test_local_dataset_removal.py`. No API, downloader, UI, README or actual user dataset mutation in this lane; no commit.

`LocalCatalogProvider(store, artifacts)` returns `size_bytes` measured from the normalized Parquet file on disk. Missing/invalid artifact gives null rather than an estimate or0. The number excludes raw CSV and downloader caches.

`LocalDatasetService.delete_dataset(workspace, dataset_id)` removes one unpinned local version, not the provider catalog, another version or sessions. The transaction checks research FK references, every historical Replay revision (including archived/deleted pins), and nested Prop attempt resume references. Replay record create/update and normal Prop resume writers take dataset key-share locks so a concurrent deletion cannot create a new dangling pin.

Artifact removal accepts only canonical `<workspace>/datasets/<dataset>.parquet` and optional `<workspace>/raw/<dataset>/source.csv`, rejects traversal/cross-workspace/absolute/symlink/junction/non-file targets, and unlinks only those two exact paths. Extra files and directories are retained. A bounded exact-path journal is saved before catalog deletion; files stay available until the database transaction commits. If disk cleanup fails afterward, the same DELETE retries from that journal even when the manifest is already absent. A shared per-workspace/per-dataset PostgreSQL advisory lock spans manifest removal and exact-file cleanup; the data-ingest publisher uses the same lock, preventing a same-ID CSV reimport from publishing files that an older deletion would then remove. Root also serializes deletion against active downloader imports using its mutation guard. There is no automatic session deletion or broad directory cleanup.

Writers now accept `continue_check` per batch/1MiB and immediately before publication. Checksums are computed on temporary files before publication, so cancellation does not publish an incomplete artifact.

Validation:

- `python -m unittest discover -s foundation_v2/tests -p test_local_dataset_removal.py -v`: 14 tests discovered, 13 passed, 1 skipped because Windows symlink creation privilege is unavailable. The skipped real symlink fixture is explicit, not reported as verified.
- Integration tests create and drop their own UUID loopback PostgreSQL database, use temporary synthetic CSV/artifacts, and do not TRUNCATE or mutate the default/user database.
- Tested exact byte size and exact-file removal, unknown size for missing file, workspace isolation, research/historical replay/nested Prop conflicts, invalid manifest rollback, cleanup sharing-violation retry, concurrent Replay and Prop pin exclusion, concurrent real CSV reimport after old-file cleanup, and cancellation before publish.
- `test_artifacts_security.py`: 3 existing regression tests passed.
- Scoped `git diff --check` and Python `py_compile` passed after the final shared-lock changes.

Deletion can be catalog-committed while disk cleanup still needs retry after an OSError. The API/UI must preserve the failed target ID for retry and report cleanup failure rather than claim success. Public data redistribution, live/broker execution, whole-product acceptance and download UI are outside this receipt.
