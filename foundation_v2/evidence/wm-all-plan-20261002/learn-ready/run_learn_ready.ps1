[CmdletBinding()]
param([ValidatePattern('^attempt-r\d+$')][string]$Attempt = 'attempt-r2')

$ErrorActionPreference = 'Stop'
$learnQaDir = $PSScriptRoot
$learnQaOut = Join-Path $learnQaDir $Attempt
if (Test-Path $learnQaOut) { throw 'Existing attempt evidence will not be overwritten; select a fresh attempt.' }
New-Item -ItemType Directory -Force -Path $learnQaOut | Out-Null
$learnQaProject = (Resolve-Path (Join-Path $learnQaDir '../../../..')).Path
$learnQaPython = Join-Path $learnQaProject 'foundation_v2/.venv/Scripts/python.exe'
$learnQaStarted = Get-Date
$learnQaProcess = $null
$learnQaServicePid = $null
$learnQaExit = 1
try {
    $learnQaProcess = Start-Process -FilePath $learnQaPython -ArgumentList @('-B', (Join-Path $learnQaDir 'serve_learn_qa.py'), $Attempt) -WorkingDirectory $learnQaProject -WindowStyle Hidden -RedirectStandardOutput (Join-Path $learnQaOut 'api.stdout.log') -RedirectStandardError (Join-Path $learnQaOut 'api.stderr.log') -PassThru
    $learnQaReady = $false
    for ($learnQaTry = 0; $learnQaTry -lt 30; $learnQaTry++) {
        if ($learnQaProcess.HasExited) { throw 'Owned Learn QA service exited before ready; inspect its bounded local log.' }
        try {
            $learnQaHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8030/qa/health' -TimeoutSec 1
            if ($learnQaHealth.scope -eq 'isolated-real-learn-qa' -and $learnQaHealth.attempt -eq $Attempt) {
                $learnQaService = Get-CimInstance Win32_Process -Filter "ProcessId = $($learnQaHealth.pid)"
                if ($learnQaHealth.pid -ne $learnQaProcess.Id -and $learnQaService.ParentProcessId -ne $learnQaProcess.Id) { throw 'Learn QA health PID is not the owned launcher or its child.' }
                $learnQaServicePid = [int]$learnQaHealth.pid
                $learnQaReady = $true
                break
            }
        } catch {}
        Start-Sleep -Milliseconds 250
    }
    if (-not $learnQaReady) { throw 'Owned Learn QA service did not become ready within bounded timeout.' }
    node (Join-Path $learnQaDir 'run_learn_ready.mjs') $Attempt
    $learnQaExit = $LASTEXITCODE
} finally {
    if ($null -ne $learnQaServicePid -and (Get-Process -Id $learnQaServicePid -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $learnQaServicePid
    }
    if ($null -ne $learnQaProcess) {
        $learnQaProcess.Refresh()
        if (-not $learnQaProcess.HasExited) { Stop-Process -Id $learnQaProcess.Id }
        $learnQaProcess.WaitForExit(5000) | Out-Null
    }
    $learnQaServiceGone = $null -eq $learnQaServicePid -or -not (Get-Process -Id $learnQaServicePid -ErrorAction SilentlyContinue)
    $learnQaListenerGone = -not (Get-NetTCPConnection -State Listen -LocalPort 8030 -ErrorAction SilentlyContinue)
    @{
        schema = 'learn-qa-owned-service-lifecycle-v1'
        started = $learnQaStarted.ToUniversalTime().ToString('o')
        finished = (Get-Date).ToUniversalTime().ToString('o')
        launcherPid = if ($null -ne $learnQaProcess) { $learnQaProcess.Id } else { $null }
        servicePid = $learnQaServicePid
        ownedLauncherStopped = if ($null -ne $learnQaProcess) { $learnQaProcess.HasExited } else { $true }
        ownedServiceStopped = $learnQaServiceGone
        listener8030Absent = $learnQaListenerGone
        browserExitCode = $learnQaExit
        commands = @("python.exe -B serve_learn_qa.py $Attempt (Start-Process -WindowStyle Hidden)", "node run_learn_ready.mjs $Attempt", 'Verify health attempt and launcher/child PID relation; Stop-Process -Id <owned-service-PID> in finally; verify PID and listener absent')
        effects = 'Task-only named disposable QA DB schema initialization; read-only Learn/browser requests; evidence files and screenshots only; existing API8020/Vite5180 untouched.'
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $learnQaOut 'lifecycle.json') -Encoding utf8
    if (-not $learnQaServiceGone -or -not $learnQaListenerGone) { throw 'Owned Learn QA teardown verification failed.' }
}
exit $learnQaExit
