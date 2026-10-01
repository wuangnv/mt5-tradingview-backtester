@echo off
setlocal
title WuangVibeTrading Legacy Flask Launcher

cd /d "%~dp0"

echo.
echo ============================================================
echo  WuangVibeTrading - Legacy Flask Windows Launcher
echo ============================================================
echo.

where powershell >nul 2>nul
if errorlevel 1 (
    echo PowerShell was not found on this Windows machine.
    echo Please install PowerShell or run: python workspace_app.py
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows_start.ps1"

if errorlevel 1 (
    echo.
    echo Launcher stopped with an error.
    pause
    exit /b 1
)

endlocal
