@echo off
setlocal
set "QDM_HOME=%~dp0foundation_v2\.runtime\quantdatamanager"
if not exist "%QDM_HOME%\QuantDataManager.exe" (
  echo QuantDataManager is missing. See docs\quantdatamanager.md for local setup.
  pause
  exit /b 1
)
echo Close QDM before starting downloads in Trading Workspace.
start "" /D "%QDM_HOME%" "%QDM_HOME%\QuantDataManager.exe"
