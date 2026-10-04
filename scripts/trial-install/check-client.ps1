<#
.SYNOPSIS
  VictorFlow trial install, desktop PC: checks that this PC can reach the VictorFlow server and writes
  report-client.txt beside this script.

.DESCRIPTION
  Run it on a company PC (no administrator rights needed): double-click check-client.cmd and type the server address
  from addresses.ini ("api=", for example 192.168.1.10:3000). It only reads; it changes nothing.

.PARAMETER Server
  The server address: 192.168.1.10, 192.168.1.10:3000, SHOP-SERVER:3000 or http://192.168.1.10:3000. Port default 3000.

.PARAMETER TrackerPort
  The tracking website's port (default 3001).

.PARAMETER DisplayPort
  The TV displays' port (default 3002).

.PARAMETER ReportPath
  Where to write the report. Default: report-client.txt beside this script (the USB stick), else the Desktop.
#>
[CmdletBinding()]
param(
    [string]$Server,
    [int]$TrackerPort = 3001,
    [int]$DisplayPort = 3002,
    [string]$ReportPath
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Continue'
$ScriptVersion = '2026-10-05'
# The origins the desktop app sends (Tauri on Windows serves the app from http://tauri.localhost).
$DesktopOrigin = 'http://tauri.localhost'

if (-not $Server) { $Server = Read-Host 'Server address from addresses.ini (api=...), for example 192.168.1.10:3000' }
$clean = ($Server.Trim() -replace '^https?://', '') -replace '/.*$', ''
$ServerHost = $clean
$ApiPort = 3000
if ($clean -match '^(.+):(\d+)$') { $ServerHost = $Matches[1]; $ApiPort = [int]$Matches[2] }

# ---- report helpers (same format as check-server.ps1) ----------------------------------------------------------------
$Details = New-Object System.Collections.Generic.List[string]
$Summary = New-Object System.Collections.Generic.List[string]
function Add-Line([string]$Text = '') { $Details.Add($Text) }
function Add-Section([string]$Title) {
    $Details.Add('')
    $Details.Add(('=' * 100))
    $Details.Add($Title)
    $Details.Add(('=' * 100))
}
function Add-Check([string]$Level, [string]$Message) {
    $line = ('[{0,-4}] {1}' -f $Level, $Message)
    $Summary.Add($line)
    $Details.Add($line)
}
function Invoke-Http([string]$Url, [string]$Method = 'GET', [hashtable]$Headers = @{}) {
    # Returns @{ Code; Body; Headers; Error } and never throws (Windows PowerShell throws on 4xx/5xx).
    try {
        $r = Invoke-WebRequest -Uri $Url -Method $Method -Headers $Headers -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
        return @{ Code = [int]$r.StatusCode; Body = [string]$r.Content; Headers = $r.Headers; Error = '' }
    } catch {
        $resp = $null
        if ($_.Exception.PSObject.Properties['Response']) { $resp = $_.Exception.Response }
        if ($resp) {
            $body = ''
            try { $reader = New-Object IO.StreamReader($resp.GetResponseStream()); $body = $reader.ReadToEnd() } catch { $body = '' }
            return @{ Code = [int]$resp.StatusCode; Body = $body; Headers = @{}; Error = $_.Exception.Message }
        }
        return @{ Code = 0; Body = ''; Headers = @{}; Error = $_.Exception.Message }
    }
}
function Test-Tcp([string]$HostName, [int]$Port) {
    # @{ Open = $true/$false; Detail = ... } within 3 seconds.
    $client = New-Object Net.Sockets.TcpClient
    try {
        $task = $client.ConnectAsync($HostName, $Port)
        if (-not $task.Wait(3000)) { return @{ Open = $false; Detail = 'no answer within 3 s (firewall, Public network, wrong address or the PC is off)' } }
        return @{ Open = $client.Connected; Detail = 'connected' }
    } catch {
        $inner = $_.Exception
        while ($inner.InnerException) { $inner = $inner.InnerException }
        return @{ Open = $false; Detail = $inner.Message }
    } finally { $client.Dispose() }
}

# ---- 1. This PC ------------------------------------------------------------------------------------------------------
Add-Section '1. This PC'
Add-Line "Server address tested: host '$ServerHost', API port $ApiPort, tracker port $TrackerPort, displays port $DisplayPort"
try {
    $os = Get-CimInstance Win32_OperatingSystem
    $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
    $displayVersion = ''
    if ($cv.PSObject.Properties['DisplayVersion']) { $displayVersion = $cv.DisplayVersion }
    Add-Line ("Windows        : {0} {1} (build {2}.{3}), {4}" -f $os.Caption, $displayVersion, $cv.CurrentBuild, $cv.UBR, $os.OSArchitecture)
    Add-Line "Computer       : $env:COMPUTERNAME"
} catch { Add-Line "Windows details unavailable: $($_.Exception.Message)" }
$MyIps = @()
try {
    foreach ($p in Get-NetConnectionProfile -ErrorAction Stop) { Add-Line ("Network        : '{0}' on {1}: {2}" -f $p.Name, $p.InterfaceAlias, $p.NetworkCategory) }
    $MyIps = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' })
    foreach ($a in $MyIps) { Add-Line ("IPv4           : {0}/{1} on {2}" -f $a.IPAddress, $a.PrefixLength, $a.InterfaceAlias) }
} catch { Add-Line "Network details unavailable: $($_.Exception.Message)" }

# ---- 2. Finding the server -------------------------------------------------------------------------------------------
Add-Section '2. Finding the server'
$serverIps = @()
$parsed = $null
if ([Net.IPAddress]::TryParse($ServerHost, [ref]$parsed)) {
    $serverIps = @($ServerHost)
    Add-Line "$ServerHost is an IP address"
} else {
    try {
        $serverIps = @([Net.Dns]::GetHostAddresses($ServerHost) | Where-Object { $_.AddressFamily -eq 'InterNetwork' } | ForEach-Object { $_.IPAddressToString })
        Add-Check 'OK' "The name '$ServerHost' resolves to $($serverIps -join ', ')"
    } catch { Add-Check 'FAIL' "The name '$ServerHost' does not resolve on this PC: use the server's IP address instead ($($_.Exception.Message))" }
}
# Same subnet? (both sides must be on the LAN; a different subnet means a router in between, or the wrong address)
foreach ($sip in $serverIps) {
    if ($sip -like '127.*') { Add-Line 'The server is this PC itself (loopback)'; continue }
    $same = $false
    foreach ($a in $MyIps) {
        $mask = [uint32]0
        if ($a.PrefixLength -gt 0) { $mask = [uint32]([math]::Pow(2, 32) - [math]::Pow(2, 32 - $a.PrefixLength)) }
        $toInt = { param($ip) $b = ([Net.IPAddress]::Parse($ip)).GetAddressBytes(); [Array]::Reverse($b); [BitConverter]::ToUInt32($b, 0) }
        if (((& $toInt $a.IPAddress) -band $mask) -eq ((& $toInt $sip) -band $mask)) { $same = $true }
    }
    if ($same) { Add-Check 'OK' "$sip is on the same network as this PC" } else { Add-Check 'WARN' "$sip is not on this PC's subnet: check the address, or that both PCs are on the same network" }
}
try {
    $ping = Test-Connection -ComputerName $ServerHost -Count 2 -Quiet -ErrorAction Stop
    if ($ping) { Add-Line 'Ping: answers' } else { Add-Line 'Ping: no answer (normal when the firewall blocks ping; the TCP tests below are what matter)' }
} catch { Add-Line "Ping: $($_.Exception.Message)" }

# ---- 3. Ports ---------------------------------------------------------------------------------------------------------
Add-Section '3. TCP connections to the server'
$open = @{}
foreach ($pair in @(@('API', $ApiPort), @('Tracking website', $TrackerPort), @('TV displays', $DisplayPort))) {
    $t = Test-Tcp $ServerHost ([int]$pair[1])
    $open[[int]$pair[1]] = $t.Open
    if ($t.Open) { Add-Check 'OK' "$($pair[0]): TCP $($pair[1]) open" } else { Add-Check 'FAIL' "$($pair[0]): TCP $($pair[1]) closed: $($t.Detail)" }
}

# ---- 4. HTTP ----------------------------------------------------------------------------------------------------------
Add-Section '4. HTTP'
$healthUrl = "http://${ServerHost}:$ApiPort/api/v1/health"
$h = Invoke-Http $healthUrl
Add-Line "GET $healthUrl -> HTTP $($h.Code) $($h.Error)"
if ($h.Body) { Add-Line "  $($h.Body)" }
$health = $null
try { if ($h.Body) { $health = $h.Body | ConvertFrom-Json } } catch { $health = $null }
$named = ($null -ne $health -and $health.PSObject.Properties['service'] -and $health.service -eq 'victorflow-api')
if ($h.Code -eq 200 -and $named -and $health.status -eq 'ok') { Add-Check 'OK' 'The VictorFlow API is healthy' }
elseif ($h.Code -eq 503 -and $named) { Add-Check 'FAIL' 'The API answers but its database is down (the desktop app shows "database is not running"): run check-server.ps1 on the server' }
elseif ($h.Code -gt 0) { Add-Check 'FAIL' "Something answers on port $ApiPort but it is not a healthy VictorFlow API (HTTP $($h.Code))" }
else { Add-Check 'FAIL' "No HTTP answer from the API: $($h.Error)" }

# The desktop app calls the API from the origin http://tauri.localhost: the server must allow it (CORS).
$pre = Invoke-Http $healthUrl 'OPTIONS' @{ Origin = $DesktopOrigin; 'Access-Control-Request-Method' = 'GET' }
$allowed = ''
if ($pre.Headers -and $pre.Headers['Access-Control-Allow-Origin']) { $allowed = [string]$pre.Headers['Access-Control-Allow-Origin'] }
Add-Line "OPTIONS $healthUrl (Origin: $DesktopOrigin) -> HTTP $($pre.Code), Access-Control-Allow-Origin: '$allowed'"
if ($allowed -eq $DesktopOrigin -or $allowed -eq '*') { Add-Check 'OK' 'The API accepts calls from the desktop app (CORS)' }
elseif ($pre.Code -gt 0) { Add-Check 'FAIL' "The API does not allow the desktop app's origin $DesktopOrigin (CORS): the app would show 'not a VictorFlow server'" }

foreach ($web in @(@{ Name = 'Tracking website'; Port = $TrackerPort }, @{ Name = 'TV displays'; Port = $DisplayPort })) {
    $url = "http://${ServerHost}:$($web.Port)/"
    $r = Invoke-Http $url
    Add-Line "GET $url -> HTTP $($r.Code) $($r.Error)"
    if ($r.Code -eq 200) { Add-Check 'OK' "$($web.Name) page loads ($url)" } else { Add-Check 'FAIL' "$($web.Name) page does not load ($url): HTTP $($r.Code) $($r.Error)" }
}

# ---- 5. The desktop app on this PC --------------------------------------------------------------------------------------
Add-Section '5. VictorFlow desktop app on this PC'
$apps = @()
foreach ($root in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
    foreach ($k in Get-ChildItem $root -ErrorAction SilentlyContinue) {
        $p = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
        if ($p -and $p.PSObject.Properties['DisplayName'] -and $p.DisplayName -like 'VictorFlow*') {
            $ver = ''
            if ($p.PSObject.Properties['DisplayVersion']) { $ver = $p.DisplayVersion }
            $loc = ''
            if ($p.PSObject.Properties['InstallLocation']) { $loc = $p.InstallLocation }
            $apps += "$($p.DisplayName) $ver ($loc)"
        }
    }
}
foreach ($a in $apps) { Add-Line "Installed: $a" }
if (@($apps | Where-Object { $_ -notlike 'VictorFlow Server*' }).Count -gt 0) { Add-Check 'OK' 'The VictorFlow desktop app is installed' } else { Add-Check 'WARN' 'The VictorFlow desktop app is not installed on this PC (yet)' }

$wv = $null
foreach ($key in @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')) {
    try { $wv = (Get-ItemProperty $key -ErrorAction Stop).pv; if ($wv) { break } } catch { $null = $_ }
}
if ($wv) { Add-Check 'OK' "Microsoft Edge WebView2 runtime $wv (the desktop app needs it)" } else { Add-Check 'WARN' 'Microsoft Edge WebView2 runtime not found (the desktop installer normally installs it)' }

$old = Join-Path $env:APPDATA 'dz.victorflow.desktop'
if (Test-Path -LiteralPath (Join-Path $old 'postgres-data')) { Add-Check 'INFO' "An earlier VictorFlow build left its own database in $old; the new app does not use it (not moved to the server)" }

# ---- write --------------------------------------------------------------------------------------------------------------
$fails = @($Summary | Where-Object { $_ -like '`[FAIL*' }).Count
$warns = @($Summary | Where-Object { $_ -like '`[WARN*' }).Count
$header = @(
    'VictorFlow trial install -- CLIENT report',
    "Written $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') on $env:COMPUTERNAME by check-client.ps1 ($ScriptVersion)",
    "Result: $fails failed, $warns warnings",
    '',
    'SUMMARY'
) + $Summary
$report = (($header + $Details) -join "`r`n") + "`r`n"

$targets = @()
if ($ReportPath) { $targets += $ReportPath }
$targets += (Join-Path $PSScriptRoot 'report-client.txt')
$targets += (Join-Path ([Environment]::GetFolderPath('Desktop')) 'report-client.txt')
$written = $null
foreach ($t in $targets) {
    try { [IO.File]::WriteAllText($t, $report, (New-Object Text.UTF8Encoding $true)); $written = $t; break } catch { $null = $_ }
}
Write-Host ''
Write-Host "Result: $fails failed, $warns warnings"
if ($written) { Write-Host "Report written to $written -- bring this file back." } else { Write-Host 'Could not write the report anywhere:'; Write-Host $report }
