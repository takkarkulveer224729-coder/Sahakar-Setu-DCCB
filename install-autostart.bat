@echo off
title Coop Connect - start with Windows
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo Asking for administrator permission...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo Setting up Coop Connect to start by itself whenever Windows starts...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\autostart.ps1" -Action Install
if errorlevel 1 echo. & echo Something went wrong - see the message above.
echo.
pause
