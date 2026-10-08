# Full offline history download backend

Scope: local implementation and mocked/disposable file tests; no upstream full-history download, user dataset mutation, service restart or commit.

- `request_full(workspace, instrument_id, dataset_id=None)` derives earliest bundled M1 metadata through yesterday UTC. Partial older imports backfill the full range; native full imports append only later completed days into a new immutable version. Current versions reject with `already_current`.
- `dataset_update_state` accepts manifests and normalized API dictionaries, returns calendar-based update availability plus coverage dates. Availability does not prove upstream has published the latest day.
- Node worker processes bounded daily payloads sequentially, validates metadata/UTC boundaries, and persists checksummed per-bucket receipts. Resume reuses completed buckets without rewriting a growing index every day.
- Worker emits cumulative actual transferred bytes, separately counts cached bytes, and backend persists downloading/processing stages. No total-byte estimate is fabricated.
- CSV preview streams rows into a disk-backed timestamp index; exact `gap_count` is preserved with at most 1,000 detailed gaps. Preview, hashing, raw copies and Parquet batches can be cancelled. Final dataset/job publication uses one short lock to avoid reporting a cancelled job after publishing its dataset.
- Same-dataset import publication is serialized with the store mutation guard used by deletion. Cancelled imports remove only newly written unpublished raw/Parquet files.
- Remote cancellation must claim the job advisory lock; it returns `download_busy` while another process owns progress/publication. Local owner cancellation stays immediate. Empty or one-bar tails are allowed only for identified native parent updates; initial downloads still require two bars. Calendar coverage advances with unknown trailing gaps marked for review, without inventing rows.

Validation:

- `.venv` Python focused full-download tests: 11/11 PASS. Tests cover full dates, partial backfill, native full tail, current/foreign/missing rejects, deleted manifest redownload, immutable merge/hash preservation, normalized dictionary extras, bounded gap count, interruptible parsing, cancellation rollback, remote owner cancellation denial, and empty/one-bar tail coverage.
- Existing pure price-only ingest regression: 1/1 PASS.
- Node worker tests: 7/7 PASS. Includes 367-day mock range, exact actual-byte counter, cache-only resume, bad/future/pre-metadata dates, interrupted per-bucket resume, 429 cooldown, malformed source, original-only candle handling, and parent-only empty/one-bar tails.
- Python source compilation and scoped `git diff --check` PASS. Initial PATH Python lacked pyarrow; reruns used the existing `foundation_v2/.venv` runtime.

Real full-history speed, disk requirement, source completeness and rate-limit behavior remain unmeasured. Root owns integrated API/browser acceptance.
