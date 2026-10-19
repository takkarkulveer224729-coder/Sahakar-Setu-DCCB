@echo off
title Coop Connect - stop starting with Windows
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo Asking for administrator permission...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\autostart.ps1" -Action Uninstall
if errorlevel 1 echo. & echo Something went wrong - see the message above.
echo.
pause
