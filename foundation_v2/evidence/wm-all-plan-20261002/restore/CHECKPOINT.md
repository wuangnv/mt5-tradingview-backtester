# Current-schema restore rehearsal — 2026-10-02

Status: PASS_SYNTHETIC_RESTORE / REAL_USER_BACKUP_NOT_ACCEPTED.

Reuse: existing F7 pg_dump/pg_restore rehearsal, PostgreSQL transactions, immutable ArtifactStore, ReplayService and ProductService. The previous script creates a frozen Playbook directly, which the current lifecycle correctly rejects; it also leaves random fixture databases behind. This slice repairs the harness and extends the oracle to the current replay/drawing behavior required by U9/M7.

The fixture creates a draft then freezes it through the real transition; creates a named replay; queues one predeclared simulated BUY; steps through a protective TP; creates a historical branch and revision-2 drawing. A metadata dump plus immutable artifact copy is restored to a second fresh database. The comparator then reads the actual service records, execution analytics and historical cursor against the source oracle.

15 restore checks PASS: every table count, dataset/result hashes and reads, frozen Playbook revision, complete replay records, historical execution projection, canonical cursor retained, branch lineage/cutoff, drawing revision, tenant denial, canonical analytics equality and one trade with USD18 net. Source and target contain 4 records / 10 revisions. Empty Prop/connector tables are counted but their nonempty payloads are outside this fixture's scope.

Ownership: two random `tw_restore_src_*` / `tw_restore_dst_*` names, tracked only after successful CREATE, dropped with identifier quoting in finally; no shared QA database TRUNCATE/drop. Current PostgreSQL server and pg_dump/pg_restore are 18.6. Preflight refuses remote hosts or client/server-major mismatch before any CREATE. A partial seed failure also exercised finally cleanup; all attempts left zero owned restore databases. No tools were installed or active service restarted.

Validation commands (existing Python runtime, parent `TW_V2_DATABASE_URL` is inspected without printing its DSN):

- `foundation_v2/.venv/Scripts/python.exe foundation_v2/scripts/f7_restore_rehearsal.py --host 127.0.0.1 --port 5432 --user <configured user> --admin-db <configured database> --pg-bin "D:/Program Files/PostgreSQL/18/bin" --output foundation_v2/evidence/wm-all-plan-20261002/restore/restore-final.json` — PASS.
- Same script with `--host example.invalid` — exit1 before connection/CREATE.
- Same script with old portable PostgreSQL17 client — exit1 before CREATE.
- `guard-checks.json` pins exits and zero leftover databases. Failure logs are preserved: outdated frozen Playbook seed; initial lowercase fixture side; old pg_dump17/server18 mismatch. Existing source contracts were not weakened to make the fixture pass.

This is a restore rehearsal of synthetic data, not a backup of the user's real database, clean-clone acceptance, cloud/multiuser deployment or full M7/U9 closure. Original F7 receipts remain immutable. Rollback: revert only this harness change; the disposable databases and temporary bytes have already been removed.
