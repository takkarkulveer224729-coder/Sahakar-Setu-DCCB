@echo off
title Coop Connect - temporary link
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Download it from https://nodejs.org and run this again. & pause & exit /b 1)
if not exist node_modules (echo Installing for the first time, please wait... & call npm install)
where cloudflared >nul 2>nul || (
  echo Installing Cloudflare Tunnel, this happens only once...
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  echo.
  echo Done. Close this window and double-click start-online.bat again.
  pause
  exit /b 0
)
start "Coop Connect server" cmd /k node server.js
echo.
echo  Your public link appears below. Look for:  https://....trycloudflare.com
echo  This link changes every time. For a permanent link use start-online.bat
echo.
cloudflared tunnel --no-autoupdate --url http://localhost:3000
pause
