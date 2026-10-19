@echo off
rem Keeps Coop Connect running: starts the server and restarts it if it ever stops.
rem Used by the "Coop Connect" Windows startup task (see install-autostart.bat).
rem Usage: run-server.bat [path-to-node.exe] [port]
setlocal
cd /d "%~dp0.."
set "NODE=%~1"
if "%NODE%"=="" set "NODE=node"
if not "%~2"=="" set "PORT=%~2"
if not exist logs mkdir logs

:loop
rem Keep the log from growing forever.
if exist logs\server.log for %%F in (logs\server.log) do if %%~zF GTR 10485760 move /y logs\server.log logs\server.old.log >nul
echo [%date% %time%] Starting Coop Connect>> logs\server.log
"%NODE%" "%CD%\server.js" >> logs\server.log 2>&1
echo [%date% %time%] Coop Connect stopped, restarting in 5 seconds>> logs\server.log
rem "timeout" needs a console, which a startup task does not have; ping just waits.
ping -n 6 127.0.0.1 >nul
goto loop
