@echo off
title Coop Connect
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Download it from https://nodejs.org and run this again. & pause & exit /b 1)
if not exist node_modules (echo Installing for the first time, please wait... & call npm install)
start "" http://localhost:3000
node server.js
pause
