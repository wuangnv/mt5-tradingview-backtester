@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0scripts\restart_offline_api.ps1" %*
set "restart_result=%ERRORLEVEL%"
echo.
pause
exit /b %restart_result%
