@echo off
setlocal
title Coop Connect - online (permanent link)
cd /d "%~dp0"
if not defined PORT set PORT=3000

rem Tailscale Funnel needs an administrator window on Windows.
net session >nul 2>&1
if errorlevel 1 (
  echo Asking for administrator permission...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

where node >nul 2>nul || (echo Node.js is not installed. Download it from https://nodejs.org and run this again. & pause & exit /b 1)
if not exist node_modules (echo Installing for the first time, please wait... & call npm install)

rem Find or install Tailscale, which gives this PC a permanent public https address.
set "TS="
where tailscale >nul 2>nul && set "TS=tailscale"
if not defined TS if exist "%ProgramFiles%\Tailscale\tailscale.exe" set "TS=%ProgramFiles%\Tailscale\tailscale.exe"
if not defined TS (
  echo Installing Tailscale, this happens only once...
  winget install --id Tailscale.Tailscale -e --accept-source-agreements --accept-package-agreements
  if exist "%ProgramFiles%\Tailscale\tailscale.exe" set "TS=%ProgramFiles%\Tailscale\tailscale.exe"
)
if not defined TS (
  echo Could not install Tailscale automatically.
  echo Install it from https://tailscale.com/download and run this file again.
  pause
  exit /b 1
)

"%TS%" status >nul 2>&1
if errorlevel 1 (
  echo.
  echo Sign in to Tailscale in the browser window that opens.
  echo Any Google, Microsoft, Apple or GitHub account works. This is needed only once.
  "%TS%" up
)

start "Coop Connect server" /min cmd /k node server.js

echo.
echo Turning on the public link. The first time, Tailscale may show a link to
echo enable Funnel - open it in your browser and click Enable.
"%TS%" funnel --bg %PORT%
if errorlevel 1 (
  echo.
  echo The public link could not be turned on. Approve Funnel using the link above, then run this file again.
  pause
  exit /b 1
)

echo.
echo ================================================================
echo   Your permanent Coop Connect link is the https address below.
echo   It stays the same every time - share it with everyone.
echo ================================================================
"%TS%" funnel status
echo.
echo Keep the "Coop Connect server" window open while people chat.
pause
