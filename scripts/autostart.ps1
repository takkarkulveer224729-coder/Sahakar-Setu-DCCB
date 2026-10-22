# Coop Connect: start automatically when Windows starts.
# Run through install-autostart.bat / uninstall-autostart.bat (they ask for admin rights).
param(
  [ValidateSet('Install', 'Uninstall')][string]$Action = 'Install',
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Coop Connect'
$Root = Split-Path -Parent $PSScriptRoot
$Runner = Join-Path $PSScriptRoot 'run-server.bat'
$ServerJs = Join-Path $Root 'server.js'

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }

# Stop servers started by the startup task (and the runner that restarts them).
function Stop-CoopServer {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'cmd.exe'" |
    Where-Object {
      $cmd = "$($_.CommandLine)".ToLower()
      $cmd.Contains($ServerJs.ToLower()) -or $cmd.Contains($Runner.ToLower())
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Find-Tailscale {
  $cmd = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $path = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
  if (Test-Path $path) { return $path }
  return $null
}

if ($Action -eq 'Uninstall') {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  Stop-CoopServer
  Say 'Coop Connect will no longer start with Windows, and the server has been stopped.' Green
  Say 'Your messages and files are kept. Use start-online.bat to run it by hand.'
  return
}

# ---------- Install ----------

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js is not installed. Download it from https://nodejs.org and run this again.' }

if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
  Say 'Installing for the first time, please wait...'
  Push-Location $Root
  try { & npm.cmd install --omit=dev } finally { Pop-Location }
}

# Replace any earlier task, and stop a server that is already using the port
# (for example one started from start-online.bat), so the task can take over.
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Stop-CoopServer
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
foreach ($conn in $busy) {
  $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -eq 'node') {
    Say 'Closing the Coop Connect window that was already running...'
    Stop-Process -Id $proc.Id -Force
  } elseif ($proc) {
    throw "Port $Port is used by another program ($($proc.ProcessName)). Close it and run this again."
  }
}

# Runs as SYSTEM at boot, so it works even before anyone logs in. No time limit,
# and Windows restarts it if it fails.
$taskAction = New-ScheduledTaskAction -Execute 'cmd.exe' `
  -Argument "/c `"`"$Runner`" `"$node`" $Port`"" -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $trigger -Principal $principal `
  -Settings $settings -Description 'Runs the Coop Connect chat server when Windows starts.' -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Say 'Starting Coop Connect...'
$up = $false
for ($i = 0; $i -lt 30 -and -not $up; $i++) {
  Start-Sleep -Seconds 1
  try { Invoke-WebRequest "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 2 | Out-Null; $up = $true } catch { }
}
if (-not $up) {
  throw "The server did not start. See $(Join-Path $Root 'logs\server.log') for details."
}
Say "Coop Connect is running and will start by itself every time Windows starts." Green

# ---------- Permanent public link (Tailscale Funnel) ----------
# Funnel settings made with --bg are remembered by Tailscale across restarts.
# Native tools report problems through exit codes, which are checked below.
$ErrorActionPreference = 'Continue'

$ts = Find-Tailscale
if (-not $ts) {
  Say 'Installing Tailscale for the permanent public link...'
  & winget install --id Tailscale.Tailscale -e --accept-source-agreements --accept-package-agreements
  $ts = Find-Tailscale
}
if (-not $ts) {
  Say 'Could not install Tailscale. Install it from https://tailscale.com/download and run this again' Yellow
  Say "to get a public link. Until then Coop Connect works at http://localhost:$Port on this network." Yellow
  return
}

& $ts status *> $null
if ($LASTEXITCODE -ne 0) {
  Say ''
  Say 'Sign in to Tailscale in the browser window that opens (any Google, Microsoft, Apple or GitHub account).' Cyan
  & $ts up
}

# Tailscale also has to start with Windows for the link to come back by itself.
Set-Service -Name Tailscale -StartupType Automatic -ErrorAction SilentlyContinue

Say ''
Say 'Turning on the public link. The first time, open the link Tailscale shows and click Enable.' Cyan
& $ts funnel --bg $Port
if ($LASTEXITCODE -ne 0) {
  Say 'The public link could not be turned on. Approve Funnel using the link above, then run this again.' Yellow
  return
}

# ---------- Stay awake ----------

Say ''
$answer = Read-Host 'Keep this PC from going to sleep while plugged in, so the link always works? (Y/N)'
if ($answer -match '^[Yy]') {
  powercfg /change standby-timeout-ac 0
  powercfg /change hibernate-timeout-ac 0
  Say 'Done: this PC will not sleep while plugged in (the screen can still turn off).' Green
}

Say ''
Say '================================================================' Green
Say '  All set! Your permanent Coop Connect link is the https address below.' Green
Say '  It works after every restart - nobody needs to start anything.' Green
Say '================================================================' Green
& $ts funnel status
