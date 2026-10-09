[CmdletBinding()]
param([switch]$CheckOnly, [switch]$ApplyMigration, [switch]$BackupConfirmed, [switch]$Build, [switch]$AdoptLegacyDownloads)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$foundationRoot = Join-Path $projectRoot 'foundation_v2'
$pythonPath = Join-Path $foundationRoot '.venv\Scripts\python.exe'
$launcherPath = Join-Path $foundationRoot 'scripts\run_api_platform.py'
$legacyPath = Join-Path $foundationRoot 'scripts\serve_exness_history.py'
$manifestPath = Join-Path $foundationRoot '.runtime\api-platform\owner.json'
$apiUrl = 'http://127.0.0.1:8010'
$headers = @{ 'X-Workspace-Id' = 'tenant-a' }

function Get-OfflineListener {
    $listeners = @(Get-NetTCPConnection -LocalPort 8010 -State Listen -ErrorAction SilentlyContinue)
    if (-not $listeners.Count) { return $null }
    $owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($owners.Count -ne 1 -or @($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') }).Count) {
        throw 'Port 8010 does not belong to one loopback API. Nothing was stopped.'
    }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($owners[0])"
    if (-not $process) { throw 'API process could not be verified.' }
    if (Test-Path -LiteralPath $manifestPath) {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        if ($manifest.project -eq $projectRoot -and $manifest.port -eq 8010 -and -not $manifest.stopped -and
            $manifest.processes.api.pid -eq $process.ProcessId -and
            $manifest.processes.api.executable -eq $process.ExecutablePath) {
            return @{ Kind = 'managed'; Process = $process }
        }
    }
    $command = $process.CommandLine
    $relativeLauncher = $command -match '(?i)(?:^|\s|")scripts[\\/]serve_exness_history\.py(?:\s|")'
    $absoluteLauncher = $command -and $command.Contains($legacyPath)
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ParentProcessId)" -ErrorAction SilentlyContinue
    $projectPython = $process.ExecutablePath -eq $pythonPath -or $parent.ExecutablePath -eq $pythonPath
    if ($process.Name -notmatch '^python(?:w)?\.exe$' -or -not $projectPython -or
        (-not $relativeLauncher -and -not $absoluteLauncher) -or
        $command -notmatch '--port\s+8010(?:\s|$)' -or $command -match '--mt5-python|--ticks') {
        throw 'Port 8010 is not an owned offline API. Nothing was stopped.'
    }
    return @{ Kind = 'legacy'; Process = $process }
}

function Assert-NoActiveDownload {
    $response = Invoke-RestMethod -Uri "$apiUrl/api/v2/data/downloads" -Headers $headers -TimeoutSec 5
    if ($null -eq $response.items -or $null -eq $response.available) {
        throw 'Could not verify download state. Nothing was stopped.'
    }
    if (@($response.items | Where-Object { $_.status -in @('queued', 'running', 'pausing') }).Count) {
        throw 'A download is active. Pause it in the UI and wait until paused before restart.'
    }
}

try {
    if ($CheckOnly -and ($ApplyMigration -or $Build -or $AdoptLegacyDownloads)) { throw 'CheckOnly cannot be combined with actions.' }
    foreach ($path in @($pythonPath, $launcherPath)) {
        if (-not (Test-Path -LiteralPath $path)) { throw "Required local path is missing: $path" }
    }
    if (-not $env:TW_V2_DATABASE_URL) { $env:TW_V2_DATABASE_URL = [Environment]::GetEnvironmentVariable('TW_V2_DATABASE_URL', 'User') }
    if (-not $env:TW_V2_DATABASE_URL) { throw 'TW_V2_DATABASE_URL is missing; restore the existing local database configuration.' }
    if ($Build) {
        $cargoPath = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
        & $cargoPath build --release --locked --manifest-path (Join-Path $foundationRoot 'api-rust\Cargo.toml')
        if ($LASTEXITCODE -ne 0) { throw 'Rust release build failed; existing API was not stopped.' }
    }
    $preflightArgs = @('-B', $launcherPath, '--check-only', '--require-idle')
    if ($ApplyMigration) { $preflightArgs += '--allow-pending-migrations' }
    & $pythonPath @preflightArgs
    if ($LASTEXITCODE -ne 0) { throw 'Runtime preflight failed. Existing API was not stopped.' }
    if ($ApplyMigration -and -not $BackupConfirmed) { throw 'Back up and verify BOTH PostgreSQL and artifact files, then pass -ApplyMigration -BackupConfirmed.' }
    $listener = Get-OfflineListener
    if ($listener) { Assert-NoActiveDownload }
    if ($CheckOnly) { Write-Host 'Preflight passed. Check-only: no schema/process/provider changes.'; exit 0 }
    if ($listener) {
        $current = Get-OfflineListener
        if (-not $current -or $current.Process.ProcessId -ne $listener.Process.ProcessId -or
            $current.Process.CreationDate -ne $listener.Process.CreationDate) { throw 'API ownership changed. Nothing was stopped.' }
        Assert-NoActiveDownload
        if ($current.Kind -eq 'managed') {
            & $pythonPath -B $launcherPath --stop --allow-pending-migrations
            if ($LASTEXITCODE -ne 0) { throw 'Owned runtime shutdown failed; replacement was not started.' }
        } else {
            # Explicit legacy cutover only after PID/time/path and idle checks.
            Stop-Process -Id $current.Process.ProcessId
        }
        $deadline = (Get-Date).AddSeconds(10)
        while (Get-NetTCPConnection -LocalPort 8010 -State Listen -ErrorAction SilentlyContinue) {
            if ((Get-Date) -gt $deadline) { throw 'Port 8010 remains occupied; replacement was not started.' }
            Start-Sleep -Milliseconds 250
        }
    }
    if ($ApplyMigration) {
        & $pythonPath -B $launcherPath --setup-only --migrate --backup-confirmed
        if ($LASTEXITCODE -ne 0) { throw 'Explicit migration failed; runtime was not started.' }
    }
    $logRoot = Split-Path -Parent $manifestPath
    $null = New-Item -ItemType Directory -Path $logRoot -Force
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $stdoutPath = Join-Path $logRoot "supervisor-$stamp.out.log"
    $stderrPath = Join-Path $logRoot "supervisor-$stamp.err.log"
    $startArgs = @('-B', ('"' + $launcherPath + '"'))
    if ($AdoptLegacyDownloads) { $startArgs += '--adopt-legacy-downloads' }
    $started = Start-Process -FilePath $pythonPath -ArgumentList $startArgs -WorkingDirectory $foundationRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    $deadline = (Get-Date).AddSeconds(70)
    do {
        Start-Sleep -Milliseconds 500
        $started.Refresh()
        if ($started.HasExited) { throw "Runtime supervisor exited. Inspect sanitized log: $stderrPath" }
        try {
            $newListener = Get-OfflineListener
            if ($newListener -and $newListener.Kind -eq 'managed') {
                $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
                $supervisor = Get-CimInstance Win32_Process -Filter "ProcessId=$($manifest.processes.supervisor.pid)"
                if ($manifest.ready -and ($supervisor.ProcessId -eq $started.Id -or $supervisor.ParentProcessId -eq $started.Id)) {
                    $health = Invoke-RestMethod -Uri "$apiUrl/health/ready" -TimeoutSec 2
                    if ($health.ok -eq $true) {
                        Write-Host "Rust offline API and Python workers ready: $apiUrl"
                        Write-Host 'Reload the page. MT5/live execution and public services were not enabled.'
                        Write-Host "Runtime logs: $logRoot"
                        exit 0
                    }
                }
            }
        } catch { }
    } while ((Get-Date) -lt $deadline)
    if (Test-Path -LiteralPath $manifestPath) { & $pythonPath -B $launcherPath --stop }
    throw "Runtime readiness timed out; inspect sanitized log: $stderrPath"
} catch {
    Write-Host "Restart failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
