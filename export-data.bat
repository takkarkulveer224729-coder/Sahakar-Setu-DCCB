@echo off
title Coop Connect - export data
cd /d "%~dp0"
rem Packs all accounts, messages and shared files into coop-data-backup.zip
rem (to move Coop Connect to another PC or a cloud server, or as a backup).
if not exist data\db.json (
  echo No Coop Connect data was found in this folder.
  echo Run this file from the coop-connect folder on the server PC.
  pause
  exit /b 1
)
if not exist uploads mkdir uploads
set "OUT=%~dp0coop-data-backup.zip"
echo Packing accounts, messages and shared files...
powershell -NoProfile -Command "Compress-Archive -Path 'data','uploads' -DestinationPath $env:OUT -Force"
if errorlevel 1 (
  echo Something went wrong while creating the backup.
  pause
  exit /b 1
)
echo.
echo Done: %OUT%
echo Upload this file to the new server together with coop-connect.zip.
explorer /select,"%OUT%"
pause
