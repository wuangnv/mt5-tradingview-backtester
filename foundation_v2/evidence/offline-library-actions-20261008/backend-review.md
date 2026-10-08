# Independent backend audit — offline library actions

Date: 2026-10-08 (Asia/Saigon)
Scope: current uncommitted full-history / incremental update / local deletion / size and worker progress contracts. Read-only source review; no provider calls, product deletions, service restarts, commits, or source changes performed.

## Final finding status: resolved within reviewed scope

1. **P1: remote cancellation can race final publication.** `DukascopyDownloads.cancel()` and `_complete()` publication synchronize only through the instance-local RLock. A second API instance/process can write cancelled after the owner's final continue_check but before put_dataset/job completed. The owner then registers the dataset and overwrites cancelled with completed. The lifetime worker advisory lock is not acquired by cancel. Serialize cancellation and the short publication section across processes with a separate advisory lock, or explicitly reject remote-owner cancellation. Reported to root.

   **Resolved on final source inspection:** local-owner cancellation remains protected by the same RLock as publication. Remote cancellation now acquires the lifetime job advisory lock with `pg_try_advisory_lock`; if the active owner holds it, cancel returns download_busy/HTTP 409 without touching the journal. The owner holds that job lock until after publication, so remote writes cannot enter the former critical window. A stale/finished-owner journal can be cancelled after the lock is released. Cancellation that wins before worker startup is persisted and observed by the worker before it launches. Reviewed new regression `test_remote_cancel_cannot_overwrite_active_owner_progress_or_publication`.

2. **P2: valid empty/one-bar tail updates fail before merge.** Node `download()` rejects `rowCount < 2` universally. A full saved history ending Friday, updated on Monday UTC, requests only valid Saturday/Sunday buckets. Empty weekend data yields empty_range and cannot extend attempted coverage, although the parent's existing bars make the merged dataset valid. Permit a zero/one-row tail only when a validated parent-tail request is present; maintain the minimum-two-row requirement for initial datasets. A fake empty-weekend regression should cover it. Reported to root.

   **Resolved on final source inspection:** initial downloads still reject fewer than two rows. The internal worker request includes parent_dataset_id only for the server-derived update-tail path; a canonical dataset identifier permits zero/one source rows. Backend completion independently loads and validates the parent workspace/provider/M1/Bid/library/range, verifies its raw SHA, merges the tail, and retains the ordinary minimum-two-row final-import check. Missing/invalid parents cannot publish. Empty/one-bar tails produce an immutable merged version whose requested coverage reaches the cutoff; missing coverage remains review/unknown instead of being declared proven complete. Reviewed Python `test_empty_weekend_and_one_bar_tail_keep_parent_rows_and_review_coverage` and the Node initial-vs-tail regression.

No remaining blocker from these two findings. The trade-off is explicit: an active remote process cannot cancel the owner's worker; it receives a conflict and must route cancellation to the owner or wait until that owner exits. This audit does not approve service activation or live provider coverage.

## Contracts inspected and acceptable within scope

- Full-history dates derive from the pinned upstream minute-history start and the latest completed UTC day. No unfinished current-day bucket is included.
- Partial local copies trigger full backfill; full copies update the tail and produce a new immutable merged version. Parent raw SHA is verified, parent remains unchanged, mapping/timeframe/Bid/library source settings and requested coverage are recorded.
- Initial import validates raw timestamps/OHLC and removes synthetic upstream bars by retaining original timestamps. Gap disposition remains review rather than silently asserting completeness.
- Long preview/hash/copy/Parquet loops perform cancellation checks. Local single-instance cancellation and final registration are serialized; cancelled new artifacts are cleaned if not registered.
- Delete is workspace-scoped; exact Parquet/raw CSV paths are validated against canonical ownership and symlink/junction traversal. Files remain intact until the DB catalog removal commits. Failed cleanup leaves an exact-path retry journal.
- Dataset mutation advisory lock serializes delete cleanup and reimport. Replay pins use row key-share, research pins have a dataset FK, and historical replay/Prop revisions prevent deletion. Concurrent dataset deletion cannot introduce dangling new replay references through the reviewed store writers.
- size_bytes is actual Parquet file size, and unavailable size remains unknown. It excludes raw CSV and download bucket cache. Those retained cache files are outside the exact local-version deletion contract and should not be described as fully reclaiming all asset disk usage.
- Worker counts bytes read from successful response bodies separately from bytes reused from local checksum-verified cache. It does not invent total bytes; progress days and processing stage are separate. These are payload bytes as exposed by Fetch, not a packet-level wire-byte measurement (Fetch may transparently decompress).

## Evidence inspected

- `foundation_v2/tests/test_dukascopy_full_downloads.py`: full range, partial backfill/tail merge, parent hash/version preservation, bounded gap details, local cancellation before publication, cancelled artifact rollback.
- `foundation_v2/tests/test_local_dataset_removal.py`: disposable database isolation, exact-path deletion, actual size/unknown size, archived/nested pin rejection, concurrent pin rejection, mutation serialization, sharing-violation retry journal.
- `foundation_v2/data_worker/tests/worker.test.mjs`: >366-day fixture, actual payload/cached bytes, validated completed bucket resume, malformed/429 behavior.

Tests were read, not rerun by this reviewer; active implementation lanes own execution evidence. No whole-product, provider-history, broker, or UI acceptance inferred.
