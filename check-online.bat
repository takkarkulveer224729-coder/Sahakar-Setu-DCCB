@echo off
title Coop Connect - check the public link
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo Asking for administrator permission...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\check-online.ps1"
echo.
pause
