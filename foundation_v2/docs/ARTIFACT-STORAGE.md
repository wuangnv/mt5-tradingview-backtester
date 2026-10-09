# Artifact storage contract

Local server disk remains the default runtime backend. Existing dataset/raw/
result relative paths and SHA256 manifest fields are unchanged; browser storage
is not an artifact backend. Rust must authorize the workspace before resolving
any manifest reference. It must not accept arbitrary client filesystem paths.

`ArtifactStore.read_dataset_range()` verifies the full SHA256 on the same open
file descriptor used for Parquet decoding, prunes row groups using timestamp
statistics, and projects timestamp/OHLC only. Row-level filtering preserves the
exclusive upper cutoff and refuses output beyond `max_bars`. Missing statistics
fall back to reading that group. Descriptor identity is checked around hashing
and decoding; pathname identity detects a replacement. There is no digest cache:
each read still scans all raw bytes for integrity, but no longer decodes every
row. This intentionally trades some disk I/O for the existing integrity contract.

All publishers write a unique temporary file, sync its contents, then publish
without overwriting a concurrent winner. Windows uses a write-through move
without `REPLACE_EXISTING`; POSIX uses a no-overwrite hard link and directory
sync. Unsupported filesystem operations fail rather than fall back to overwrite.
Path components reject traversal, reserved Windows device names, symlinks and
junctions. This protects the application boundary; the artifact directory must
also remain private to the service account. Hardware/filesystem power-loss
behavior is not established by a process-crash fixture.

## Backup and restore

`artifact_backup.create_backup_bundle()` packages a PostgreSQL custom-format dump
and the artifact references captured from that same quiesced snapshot. The caller
must stop mutations/deletions **before pg_dump and reference capture**, and keep
them stopped through copying. `mutations_quiesced=True` records that caller
precondition; it does not itself acquire a live database/storage barrier. Never
claim a concurrent live backup is consistent based only on matching hashes.

The versioned manifest contains `snapshot_id`, `consistency=quiesced`, and a list
of relative paths, byte counts and SHA256 values. It is published last, so an
interrupted bundle has no completion marker. Restore verifies every file before
copying into a new destination, checks again while copying, and returns the
checked dump path. It never runs pg_restore or overwrites an existing directory.
The F7 synthetic restore rehearsal consumes this helper; it has no running source
writers. A hosted backup needs its deployment's explicit barrier/retention policy.

## Optional S3-compatible backup repository

`S3BackupRepository(client, bucket, prefix=..., max_object_bytes=...)` accepts an
explicitly configured boto3-compatible SDK client. It does not discover credentials,
create buckets, start services or install an SDK. The client must use the selected
provider's endpoint/region and credential policy. SDK compatibility must be tested
against that provider before deployment; only the injected SDK fixture was tested
here.

`upload_bundle()` uploads checked files under a unique bundle ID using conditional
`IfNoneMatch="*"` writes, then publishes the manifest last. Its returned reference
contains the bundle ID and manifest SHA256. `download_bundle()` verifies that
reference, enforces per-object/total budgets, checks all lengths/hashes and
publishes the local completion manifest last. Failed uploads can leave orphan
objects; they are not complete backups and need a deployment retention policy.

This is an **optional backup consumer**, not a transparent runtime dataset backend.
It deliberately supports only bounded single-put objects (64 MiB maximum per
object) and does not claim multipart upload, remote range reads or automatic cloud
restore. Large historical archives and multi-host dataset reads require those
contracts and provider-specific failure tests before promotion. No cloud access
was performed and no paid dependency was added.

Verification: `tests/test_artifact_storage_architecture.py` covers range/cutoff/
budget parity, corruption outside the requested range, identity invalidation,
concurrent no-overwrite and quarantine, disk failure, backup restore and mocked
S3 success/failure/budgets. Windows symlink creation can require privilege; that
case skips when unavailable. The synthetic range benchmark receipt is under
`evidence/api-platform-implementation-20261009/artifact-range-benchmark.json`;
its percentage is a fixture result, not whole-product speed or production capacity.

## Local full backup and rollback

`scripts/backup_api_platform.py --mutations-quiesced --pg-bin <audited PostgreSQL bin>`
requires the API port stopped, no active jobs or other DB clients, and sufficient
disk space. It captures a custom `pg_dump` archive plus every artifact/checkpoint
file into a new ignored `.runtime/api-platform-backups` bundle and verifies all
hashes. Use a `pg_dump` version compatible with the database server. No service is
stopped or migration applied by this script. Canceled/paused download partial files
are preserved when their terminal checkpoint is verified; unowned publication
temporary files fail closed. The caller must keep other filesystem writers stopped.

For rollback, stop the manifest-owned API/workers, verify the bundle, and restore
the archive with compatible `pg_restore` into a **new** local database. Use
`restore_backup_files()` to restore files into a **new** artifact directory. Compare
table counts and manifest hashes before selecting that restored profile with the
matching code revision. Do not run `pg_restore --clean` on the active database or
revert only the executable against a different migration ledger. Database switch
or deletion of the old profile is an explicit owner operation, not automated here.
