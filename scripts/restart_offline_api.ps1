[CmdletBinding()]
param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$foundationRoot = Join-Path $projectRoot 'foundation_v2'
$pythonPath = Join-Path $foundationRoot '.venv\Scripts\python.exe'
$launcherPath = Join-Path $foundationRoot 'scripts\serve_exness_history.py'
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
    $command = $process.CommandLine
    $relativeLauncher = $command -match '(?i)(?:^|\s|")scripts[\\/]serve_exness_history\.py(?:\s|")'
    $absoluteLauncher = $command -and $command.Contains($launcherPath)
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ParentProcessId)" -ErrorAction SilentlyContinue
    $projectPython = $process.ExecutablePath -eq $pythonPath -or $parent.ExecutablePath -eq $pythonPath
    if (-not $process -or $process.Name -notmatch '^python(?:w)?\.exe$' -or
        -not $projectPython -or
        (-not $relativeLauncher -and -not $absoluteLauncher) -or
        $command -notmatch '--port\s+8010(?:\s|$)' -or $command -match '--mt5-python|--ticks') {
        throw 'Port 8010 is not the expected offline launcher. Nothing was stopped.'
    }
    return $process
}

function Assert-NoActiveDownload {
    $response = Invoke-RestMethod -Uri "$apiUrl/api/v2/data/downloads" -Headers $headers -TimeoutSec 5
    if ($null -eq $response.items -or $null -eq $response.available) {
        throw 'Could not verify download state. Nothing was stopped.'
    }
    if (@($response.items | Where-Object { $_.status -in @('queued', 'running', 'pausing') }).Count) {
        throw 'A download is active. Pause it in the UI, wait until paused, then run this file again.'
    }
}

try {
    foreach ($path in @($pythonPath, $launcherPath, (Join-Path $foundationRoot '.runtime\exness-market-data'))) {
        if (-not (Test-Path -LiteralPath $path)) { throw "Required local path is missing: $path" }
    }
    if (-not $env:TW_V2_DATABASE_URL) {
        $env:TW_V2_DATABASE_URL = [Environment]::GetEnvironmentVariable('TW_V2_DATABASE_URL', 'User')
    }
    if (-not $env:TW_V2_DATABASE_URL) {
        throw 'TW_V2_DATABASE_URL is missing. Set the existing local database configuration before retrying.'
    }
    # Validate the inherited configuration before stopping the working API; never print the DSN.
    & $pythonPath -c "import os; from psycopg.conninfo import conninfo_to_dict; c=conninfo_to_dict(os.environ['TW_V2_DATABASE_URL']); assert c.get('host') in ('127.0.0.1','localhost','::1'), 'Database must be loopback'"
    if ($LASTEXITCODE -ne 0) { throw 'Local database preflight failed. Nothing was stopped.' }

    $listener = Get-OfflineListener
    if ($listener) { Assert-NoActiveDownload }
    if ($CheckOnly) {
        Write-Host 'Preflight passed. Check-only mode: no process was stopped or started.'
        exit 0
    }
    if ($listener) {
        # Recheck just before the stop rather than acting on an old PID snapshot.
        $current = Get-OfflineListener
        if (-not $current -or $current.ProcessId -ne $listener.ProcessId -or $current.CreationDate -ne $listener.CreationDate) { throw 'API process changed. Run this file again.' }
        Assert-NoActiveDownload
        Stop-Process -Id $current.ProcessId
        $deadline = (Get-Date).AddSeconds(10)
        while (Get-NetTCPConnection -LocalPort 8010 -State Listen -ErrorAction SilentlyContinue) {
            if ((Get-Date) -gt $deadline) { throw 'Port 8010 is still occupied. New API was not started.' }
            Start-Sleep -Milliseconds 250
        }
    }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $stdoutPath = Join-Path $foundationRoot ".runtime\manual-api-$stamp.out.log"
    $stderrPath = Join-Path $foundationRoot ".runtime\manual-api-$stamp.err.log"
    $started = Start-Process -FilePath $pythonPath -ArgumentList @('-B', 'scripts/serve_exness_history.py', '--port', '8010') -WorkingDirectory $foundationRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    $deadline = (Get-Date).AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 500
        if ($started.HasExited) { throw "API startup failed. Check log: $stderrPath" }
        try {
            $newListener = Get-OfflineListener
            if ($newListener -and ($newListener.ProcessId -eq $started.Id -or $newListener.ParentProcessId -eq $started.Id)) {
                $health = Invoke-RestMethod -Uri "$apiUrl/health" -TimeoutSec 2
                $null = Invoke-RestMethod -Uri "$apiUrl/api/v2/data/downloads" -Headers $headers -TimeoutSec 2
                if ($health.ok -eq $true) {
                    Write-Host "Offline API is ready: $apiUrl"
                    Write-Host 'Reload the page. Paused downloads stay paused; click Resume when ready.'
                    Write-Host "Startup log: $stderrPath"
                    exit 0
                }
            }
        } catch {
            # Startup may temporarily have no listener or healthy HTTP response.
        }
    } while ((Get-Date) -lt $deadline)
    throw "API was not ready within 30 seconds. Check log: $stderrPath"
} catch {
    Write-Host "Restart failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
