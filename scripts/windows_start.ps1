$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$VenvDir = Join-Path $ProjectRoot ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$Requirements = Join-Path $ProjectRoot "requirements.txt"
$AppFile = Join-Path $ProjectRoot "app.py"
$ChartingLibrary = Join-Path $ProjectRoot "static\charting_library\charting_library.standalone.js"
$Url = "http://127.0.0.1:5000"

function Write-Step($Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Find-Python {
    $commands = @("py -3", "python", "python3")

    foreach ($command in $commands) {
        try {
            $parts = $command.Split(" ")
            $exe = $parts[0]
            $args = @()
            if ($parts.Count -gt 1) {
                $args = $parts[1..($parts.Count - 1)]
            }

            $versionOutput = & $exe @args --version 2>$null
            if ($LASTEXITCODE -eq 0 -and $versionOutput) {
                return @{ Exe = $exe; Args = $args }
            }
        } catch {
            continue
        }
    }

    throw "Python 3 was not found. Install Python 3.8+ from https://www.python.org/downloads/windows/ and tick 'Add Python to PATH'."
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host " WuangVibeTrading - Windows Launcher" -ForegroundColor Magenta
Write-Host "============================================================" -ForegroundColor Magenta

if (!(Test-Path $AppFile)) {
    throw "app.py was not found. Please keep this launcher inside the project root."
}

if (!(Test-Path $ChartingLibrary)) {
    Write-Host ""
    Write-Host "Warning: TradingView charting library was not found:" -ForegroundColor Yellow
    Write-Host "  $ChartingLibrary" -ForegroundColor Yellow
    Write-Host "The server can start, but the chart will not load until the licensed TradingView files are placed there." -ForegroundColor Yellow
}

$python = Find-Python

if (!(Test-Path $VenvPython)) {
    Write-Step "Creating local Python virtual environment"
    $venvArgs = @($python.Args) + @("-m", "venv", $VenvDir)
    & $python.Exe @venvArgs
}

Write-Step "Upgrading pip"
& $VenvPython -m pip install --upgrade pip

Write-Step "Installing Python dependencies"
& $VenvPython -m pip install -r $Requirements

Write-Step "Starting local web app"
Write-Host "Browser will open at $Url when the server is ready." -ForegroundColor Green
Write-Host "Keep this window open while using the app." -ForegroundColor Yellow
Write-Host "Use the red power button in the app or press Ctrl+C here to stop." -ForegroundColor Yellow
Write-Host ""

Start-Job -ScriptBlock {
    param($Url)

    for ($i = 0; $i -lt 90; $i++) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                Start-Process $Url
                return
            }
        } catch {
            Start-Sleep -Seconds 1
        }
    }
} -ArgumentList $Url | Out-Null

Set-Location $ProjectRoot
& $VenvPython $AppFile
