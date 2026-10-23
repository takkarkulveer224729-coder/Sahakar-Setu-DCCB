# Coop Connect: check and repair the public (Tailscale Funnel) link.
# Run through check-online.bat (it asks for admin rights).
param([int]$Port = 3000)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Start-Transcript -Path (Join-Path $LogDir 'check-online.txt') -Force | Out-Null
# Windows PowerShell 5.1 may default to old TLS versions.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$problems = 0
function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Ok($text) { Say "  [OK]   $text" Green }
function Fixing($text) { Say "  [FIX]  $text" Yellow }
function Problem($text) { Say "  [X]    $text" Red; $script:problems++ }

function Test-Local {
  try { return (Invoke-WebRequest "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { return $false }
}

function Find-Tailscale {
  $cmd = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $path = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
  if (Test-Path $path) { return $path }
  return $null
}

Say ''
Say 'Checking your Coop Connect link...' Cyan
Say ''

# ---------- 1. Is Coop Connect running on this PC? ----------
Say '1. Coop Connect on this PC'
if (Test-Local) {
  Ok "Coop Connect is running (http://localhost:$Port)"
} else {
  Fixing 'Coop Connect is not running - starting it now...'
  if (Get-ScheduledTask -TaskName 'Coop Connect' -ErrorAction SilentlyContinue) {
    Start-ScheduledTask -TaskName 'Coop Connect'
  } else {
    Start-Process cmd.exe -ArgumentList '/k node server.js' -WorkingDirectory $Root -WindowStyle Minimized
  }
  for ($i = 0; $i -lt 20 -and -not (Test-Local); $i++) { Start-Sleep -Seconds 1 }
  if (Test-Local) { Ok 'Coop Connect started' }
  else { Problem "Coop Connect will not start. Open $LogDir\server.log or double-click start-coop-connect.bat to see why." }
}

# ---------- 2. Is Tailscale installed, running and signed in? ----------
Say ''
Say '2. Tailscale'
$ts = Find-Tailscale
if (-not $ts) {
  Problem 'Tailscale is not installed. Double-click start-online.bat first.'
  Stop-Transcript | Out-Null
  return
}
$svc = Get-Service -Name Tailscale -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -ne 'Running') {
  Fixing 'The Tailscale service was stopped - starting it...'
  Start-Service -Name Tailscale -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 5
}
if ($svc) { Set-Service -Name Tailscale -StartupType Automatic -ErrorAction SilentlyContinue }

$status = $null
try { $status = (& $ts status --json 2>$null | Out-String) | ConvertFrom-Json } catch { }
if (-not $status -or $status.BackendState -ne 'Running') {
  $state = if ($status) { $status.BackendState } else { 'unknown' }
  Problem "Tailscale is not connected (state: $state)."
  Say '         -> Click the Tailscale icon near the clock and sign in, then run this again.' Yellow
  Stop-Transcript | Out-Null
  return
}
$name = "$($status.Self.DNSName)".TrimEnd('.')
Ok "Tailscale is connected. This PC is: $name"

# ---------- 3. HTTPS certificate ----------
Say ''
Say '3. Security certificate (https)'
Push-Location $env:TEMP
$certOut = (& $ts cert $name 2>&1 | Out-String).Trim()
$certExit = $LASTEXITCODE
# Don't leave a copy of the private key lying around.
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $env:TEMP "$name.crt"), (Join-Path $env:TEMP "$name.key")
Pop-Location
if ($certExit -eq 0) {
  Ok 'The https certificate is ready'
} else {
  Problem 'The https certificate could not be created:'
  Say "         $certOut" DarkGray
  if ($certOut -match 'HTTPS|not enabled|disabled') {
    Say '         -> Open https://login.tailscale.com/admin/dns , click "Enable HTTPS", then run this again.' Yellow
  } else {
    Say '         -> Wait 10 minutes and run this again. If it keeps failing, send this screen to your helper.' Yellow
  }
}

# ---------- 4. Funnel (public link) ----------
Say ''
Say '4. Public link (Funnel)'
& $ts funnel reset 2>&1 | Out-Null
$funnelOut = (& $ts funnel --bg $Port 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -eq 0) {
  Ok "Funnel is on and points to Coop Connect (port $Port)"
} else {
  Problem 'Funnel could not be turned on:'
  Say "         $funnelOut" DarkGray
  if ($funnelOut -match 'https://login\.tailscale\.com\S*') {
    Say "         -> Open $($Matches[0]) in your browser, click Enable, then run this again." Yellow
  }
}

# ---------- 5. Does the https link work from this PC? ----------
Say ''
Say '5. The https link from this PC'
Start-Sleep -Seconds 3
try {
  $resp = Invoke-WebRequest "https://$name/" -UseBasicParsing -TimeoutSec 30
  Ok "https://$name works here (status $($resp.StatusCode))"
} catch {
  Problem "https://$name does not work even on this PC:"
  Say "         $($_.Exception.Message)" DarkGray
  Say '         -> Usually the certificate is still being made. Wait 10 minutes and run this again.' Yellow
}

# ---------- 6. Is the link published on the internet? ----------
Say ''
Say '6. Your link on the internet'
try {
  $ips = @(Resolve-DnsName -Name $name -Server 8.8.8.8 -DnsOnly -ErrorAction Stop | Where-Object { $_.IPAddress } | ForEach-Object { $_.IPAddress })
  if ($ips.Count -gt 0) { Ok "The internet can find your link ($($ips -join ', '))" }
  else { throw 'no address' }
} catch {
  Problem 'The internet cannot find your link yet.'
  Say '         -> Funnel was just turned on. Wait 10-15 minutes and run this again.' Yellow
}

# ---------- Result ----------
Say ''
if ($problems -eq 0) {
  Say '================================================================' Green
  Say '  Everything on this PC is working. Your link:' Green
  Say "     https://$name" Green
  Say '================================================================' Green
  Say ''
  Say 'If a phone still shows "This site can''t be reached":' Cyan
  Say '  1. Turn OFF Wi-Fi on the phone and try again on mobile data.'
  Say '  2. Use Google Chrome, not an ad-blocking or "private" browser.'
  Say '  3. Phone Settings -> search "Private DNS" -> set it to Off / Automatic.'
  Say '  4. Turn off any VPN or ad-blocker app on the phone.'
} else {
  Say "Found $problems problem(s) - follow the yellow -> steps above, then run check-online.bat again." Yellow
}
Say ''
Say "A copy of this report is saved in: $LogDir\check-online.txt" DarkGray
Stop-Transcript | Out-Null
