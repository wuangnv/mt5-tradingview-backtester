# Offline launcher verification

Scope: guarded Windows setup/restart and supervision of Rust HTTP API plus Python
domain/research workers. No real user database, provider download, MT5 terminal
or currently listening API was modified during these checks.

## Checks run

- `foundation_v2/.venv/Scripts/python.exe -B -m unittest discover -s tests -p test_api_platform_launcher.py -v`: **12 tests PASS**.
- PowerShell AST parser on `scripts/restart_offline_api.ps1`: **PASS**, no syntax errors.
- `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/restart_offline_api.ps1 -CheckOnly`: refused safely because the release Rust binary did not yet exist. Existing API was not stopped; no migration was applied.
- Focused `git diff --check`: PASS; Git emitted the repository's expected LF/CRLF warning for PowerShell.

Tests cover read-only mode, rejecting conflicting action flags, explicit pending
migration authority, existing-DB backup acknowledgement, refusing active jobs,
legacy checkpoint directories, corrupt checkpoint fail-closed, DSN/password/token
log redaction, PID creation-time fencing, stop-marker path scoping, current Win32
process identity and exclusive runtime-profile locking.

## Runtime behavior

The supervisor starts four domain threads and one research worker. It waits for
the run-specific domain-worker heartbeat before starting the Rust listener, then
checks `/health/ready`. Children inherit a run-specific shutdown marker. On child
failure or stop, all owned children receive the marker; after 45 seconds only
the supervisor's own process handles may be terminated. No foreign port owner,
process tree, provider process or global service is killed.

The manifest has project/port/run ID, exact PID, kernel creation time and
executable, plus readiness/stopped state. It does not contain DSN/secret values.
Child stdout/stderr is streamed through credential redaction into per-run logs.

Normal startup requires every migration checksum to match and all versions to
be applied. Migration is a separate explicit setup action. Existing DB setup
requires backup acknowledgement; the flag itself does not create a backup.

## Not accepted by these tests

The mock guards and Win32 ownership tests do not establish whole-platform
integration, provider correctness, production security or real-data migration.
The integrated acceptance harness owns disposable PostgreSQL + real Rust/worker
start/stop evidence. Real user cutover still requires current release binary,
verified backup, schema setup and idle-job checks.
