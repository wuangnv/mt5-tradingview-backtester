# Local API platform runtime

The offline launcher now selects Rust/Axum for the loopback HTTP listener. Python
owns domain-command execution and research jobs, with no publicly listening
FastAPI process. This guide describes the launcher; acceptance of the complete
migration belongs to the product plan and its integration receipt.

From the product repository in PowerShell:

```powershell
.\scripts\restart_offline_api.ps1 -CheckOnly
.\scripts\restart_offline_api.ps1 -Build
```

`-CheckOnly` verifies configuration, release binary, licensed QDM location,
migration checksums and absence of active jobs. It makes no schema, process or
provider changes. An occupied port must be the exact legacy offline launcher or
the manifest-owned Rust runtime; foreign listeners are never stopped.

Before applying pending migrations, quiesce all jobs and verify a backup of both
PostgreSQL and the artifact directory. The flag is an acknowledgement of this
backup; it does not create or verify a backup by itself.

```powershell
.\scripts\restart_offline_api.ps1 -Build -ApplyMigration -BackupConfirmed
```

Migration runs once through the Python checksum-verified SQL authority before
workers start. Normal launch refuses pending versions, so worker initialization
cannot silently introduce an unapproved migration. To import legacy download
checkpoints, add `-AdoptLegacyDownloads` explicitly. Adoption uses the existing
PostgreSQL locks and does not request automatic resume of interrupted downloads.

The inherited `TW_V2_DATABASE_URL` must point to a loopback PostgreSQL server.
This existing offline profile selects database
`trading_workspace_v2_exness_history`, artifacts `.runtime/exness-market-data`
and QDM `.runtime/quantdatamanager`. It configures local owner `local-owner` in
`tenant-a`, and the shared education root. No MT5 process, live broker, cloud
service or provider download is started by the launcher itself.

For a disposable fixture or another explicitly prepared local profile:

```powershell
.\foundation_v2\.venv\Scripts\python.exe -B .\foundation_v2\scripts\run_api_platform.py --port 18010 --database-name prepared_fixture --artifact-root C:\fixture\artifacts --download-engine none --manifest C:\fixture\runtime\owner.json --check-only
```

Run the same command without `--check-only` for a foreground supervisor. Initial
setup adds `--setup-only --migrate`; an existing DB also requires
`--backup-confirmed`. `--build` creates a locked release build with a ten-minute
deadline. A guarded stop uses the same profile arguments with `--stop`.

The hidden PowerShell launch leaves a foreground Python supervisor attached to
its children. It starts four domain-command threads, one research worker and
then the Rust API only after its own command workers advertise readiness. It
checks HTTP `/health/ready`, detects a child exit and stops the remaining owned
runtime. Ownership records contain PID, kernel creation time and executable,
never a DSN. Logs live under `.runtime/api-platform`; each run has separate
stdout/stderr files.

Shutdown writes a run-specific marker, allowing API requests and workers to
drain. After 45 seconds the supervisor can terminate only the process handles it
created. It never uses tree-wide termination or kills a process merely because
it holds a port. Restart refuses queued/running jobs and active downloads; it
cannot make an active QDM download pause when that provider has no pause API.

The runtime is local-only. Hosted authentication, multi-machine workers and
production deployment retain their separate acceptance and authorization gates.
