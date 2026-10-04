<#
.SYNOPSIS
  VictorFlow trial install, server PC: checks the installation and writes report-server.txt beside this script.

.DESCRIPTION
  Run it on the server PC after VictorFlow-Server-Setup has finished (double-click check-server.cmd: it asks for
  administrator rights). It only reads; it changes nothing. It never prints secrets.json or first-login.txt, and any
  secret value that shows up in a log is replaced by [REDACTED] before the report is written.

.PARAMETER DataDir
  The data folder. Default: the one chosen at install (from the uninstall record), else C:\ProgramData\VictorFlow.

.PARAMETER InstallDir
  The program folder. Default: from the uninstall record, else C:\Program Files\VictorFlow Server.

.PARAMETER ReportPath
  Where to write the report. Default: report-server.txt beside this script (the USB stick), else the Desktop.

.PARAMETER NoElevate
  Do not ask for administrator rights (testing only; locked files are then reported as "access denied").

.PARAMETER Pause
  Wait for Enter before closing (set when the script relaunches itself as administrator in a new window).
#>
[CmdletBinding()]
param(
    [string]$DataDir,
    [string]$InstallDir,
    [string]$ReportPath,
    [switch]$NoElevate,
    [switch]$Pause
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Continue'
$ScriptVersion = '2026-10-05'
$AppGuid = '8B3F2D6A-4C1E-4E7B-9A55-2D7C6B1F0E93'
$ServiceIds = @('VictorFlowPostgres', 'VictorFlowApi', 'VictorFlowTracker', 'VictorFlowDisplay')

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ---- run as administrator (the data folder is readable only by administrators and the services) -----------------
if (-not (Test-Admin) -and -not $NoElevate) {
    $relaunch = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Pause')
    foreach ($name in 'DataDir', 'InstallDir', 'ReportPath') {
        if ($PSBoundParameters.ContainsKey($name)) { $relaunch += @("-$name", "`"$($PSBoundParameters[$name])`"") }
    }
    Write-Host 'Asking for administrator rights...'
    try {
        Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $relaunch -Wait
    } catch {
        Write-Host "Could not start as administrator: $($_.Exception.Message)"
    }
    exit
}

# ---- report helpers ------------------------------------------------------------------------------------------------
$Details = New-Object System.Collections.Generic.List[string]
$Summary = New-Object System.Collections.Generic.List[string]
$Secrets = New-Object System.Collections.Generic.List[string]

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
function Add-Block([string]$Label, $Text) {
    $Details.Add("--- $Label ---")
    if ($null -eq $Text -or "$Text".Trim() -eq '') { $Details.Add('(empty)') } else { foreach ($l in ("$Text" -split "`r?`n")) { $Details.Add("  $l") } }
}
function Protect-Text([string]$Text) {
    foreach ($s in $Secrets) { if ($s) { $Text = $Text.Replace($s, '[REDACTED]') } }
    $Text = [regex]::Replace($Text, '(postgres(?:ql)?://[^:/\s]+:)[^@\s]+@', '$1[REDACTED]@')
    $Text = [regex]::Replace($Text, '(?i)("?(?:password|secret|token)"?\s*[:=]\s*"?)[^\s",}]+', '$1[REDACTED]')
    return $Text
}
function Get-Tail([string]$Path, [int]$Lines = 50) {
    try { return ((Get-Content -LiteralPath $Path -Tail $Lines -Encoding UTF8 -ErrorAction Stop) -join "`n") }
    catch { return "(cannot read: $($_.Exception.Message))" }
}
function Format-Size([double]$Bytes) {
    if ($Bytes -ge 1GB) { return ('{0:N1} GB' -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ('{0:N1} MB' -f ($Bytes / 1MB)) }
    if ($Bytes -ge 1KB) { return ('{0:N0} KB' -f ($Bytes / 1KB)) }
    return "$Bytes B"
}
function Invoke-Http([string]$Url) {
    # Returns @{ Code = <int or 0>; Body = <text>; Error = <text> } and never throws (5.1 throws on 4xx/5xx).
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
        return @{ Code = [int]$r.StatusCode; Body = [string]$r.Content; Error = '' }
    } catch {
        $resp = $null
        if ($_.Exception.PSObject.Properties['Response']) { $resp = $_.Exception.Response }
        if ($resp) {
            $body = ''
            try { $reader = New-Object IO.StreamReader($resp.GetResponseStream()); $body = $reader.ReadToEnd() } catch { $body = '' }
            return @{ Code = [int]$resp.StatusCode; Body = $body; Error = $_.Exception.Message }
        }
        return @{ Code = 0; Body = ''; Error = $_.Exception.Message }
    }
}
function Test-Health([string]$HostName, [int]$Port, [string]$Label) {
    $url = "http://${HostName}:$Port/api/v1/health"
    $r = Invoke-Http $url
    Add-Block "GET $url" ("HTTP $($r.Code) $($r.Error)`n$($r.Body)")
    $ok = $false
    if ($r.Code -eq 200) { try { $j = $r.Body | ConvertFrom-Json; $ok = ($j.service -eq 'victorflow-api' -and $j.status -eq 'ok') } catch { $ok = $false } }
    if ($ok) { Add-Check 'OK' "$Label answers: VictorFlow API healthy ($url)" }
    elseif ($r.Code -eq 503) { Add-Check 'FAIL' "$Label answers 503: the API runs but cannot reach its database ($url)" }
    elseif ($r.Code -gt 0) { Add-Check 'FAIL' "$Label answers HTTP $($r.Code) but not as a healthy VictorFlow API ($url)" }
    else { Add-Check 'FAIL' "$Label does not answer ($url): $($r.Error)" }
}

# ---- 1. Windows ----------------------------------------------------------------------------------------------------
Add-Section '1. Windows, Smart App Control, network'
try {
    $os = Get-CimInstance Win32_OperatingSystem
    $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
    $displayVersion = ''
    if ($cv.PSObject.Properties['DisplayVersion']) { $displayVersion = $cv.DisplayVersion }
    Add-Line ("Windows        : {0} {1} (build {2}.{3}), {4}" -f $os.Caption, $displayVersion, $cv.CurrentBuild, $cv.UBR, $os.OSArchitecture)
    Add-Line ("Computer       : {0} (domain/workgroup: {1})" -f $env:COMPUTERNAME, (Get-CimInstance Win32_ComputerSystem).Domain)
    Add-Line ("Free on C:     : {0}" -f (Format-Size (Get-PSDrive C).Free))
} catch { Add-Line "Windows details unavailable: $($_.Exception.Message)" }

$sac = $null
try { $mp = Get-MpComputerStatus -ErrorAction Stop; if ($mp.PSObject.Properties['SmartAppControlState']) { $sac = [string]$mp.SmartAppControlState } } catch { $sac = $null }
if (-not $sac) {
    try {
        $v = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -ErrorAction Stop).VerifiedAndReputablePolicyState
        $sac = @{ 0 = 'Off'; 1 = 'On'; 2 = 'Evaluation' }[[int]$v]
    } catch { $sac = 'unknown (not reported by this Windows)' }
}
Add-Line "Smart App Control: $sac"
if ($sac -eq 'On' -or $sac -eq 'Evaluation') { Add-Check 'WARN' "Smart App Control is ${sac}: it can block the unsigned VictorFlow programs (look for 'Application Control policy' errors in the logs below)" }
else { Add-Check 'OK' "Smart App Control: $sac" }

try {
    $profiles = @(Get-NetConnectionProfile -ErrorAction Stop)
    foreach ($p in $profiles) { Add-Line ("Network        : '{0}' on {1}: {2}, IPv4 {3}" -f $p.Name, $p.InterfaceAlias, $p.NetworkCategory, $p.IPv4Connectivity) }
    $public = @($profiles | Where-Object { "$($_.NetworkCategory)" -eq 'Public' })
    if ($public.Count -gt 0) { Add-Check 'WARN' "Network '$($public[0].Name)' is Public: Windows Firewall blocks the other PCs. Set it to Private (Settings > Network & internet > your network)" }
    elseif ($profiles.Count -gt 0) { Add-Check 'OK' "Network profile: $(($profiles | ForEach-Object { "$($_.NetworkCategory)" }) -join ', ')" }
    else { Add-Check 'WARN' 'No active network connection' }
} catch { Add-Check 'WARN' "Network profile unavailable: $($_.Exception.Message)" }

$LanIps = @()
try {
    $addrs = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' })
    foreach ($a in $addrs) { Add-Line ("IPv4           : {0}/{1} on {2} ({3})" -f $a.IPAddress, $a.PrefixLength, $a.InterfaceAlias, $a.PrefixOrigin) }
    $LanIps = @($addrs | Where-Object { $_.InterfaceAlias -notmatch 'vEthernet|VirtualBox|VMware|WSL|Docker|Loopback|Bluetooth|Tailscale|ZeroTier' } | ForEach-Object { $_.IPAddress })
    if (@($addrs | Where-Object { "$($_.PrefixOrigin)" -eq 'Dhcp' }).Count -gt 0) { Add-Check 'INFO' 'The address comes from DHCP: reserve it in the router (or give the PCs the computer name) so it does not change' }
} catch { Add-Line "IPv4 addresses unavailable: $($_.Exception.Message)" }

try {
    $q = (powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE) -join "`n"
    $m = [regex]::Match($q, 'AC Power Setting Index:\s*0x([0-9a-fA-F]+)')
    if ($m.Success) {
        $minutes = [Convert]::ToInt32($m.Groups[1].Value, 16) / 60
        if ($minutes -gt 0) { Add-Check 'WARN' "The PC goes to sleep after $minutes min on mains power: set Sleep to Never for a server" }
        else { Add-Check 'OK' 'The PC never sleeps on mains power' }
    }
} catch { Add-Line 'Sleep setting unavailable' }

# ---- 2. Installation ------------------------------------------------------------------------------------------------
Add-Section '2. Installation'
$uninstallKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{$AppGuid}_is1"
$installed = $null
try { $installed = Get-ItemProperty $uninstallKey -ErrorAction Stop } catch { $installed = $null }
if ($installed) {
    Add-Line "Installed      : $($installed.DisplayName) $($installed.DisplayVersion)"
    if (-not $InstallDir) { $InstallDir = ([string]$installed.InstallLocation).TrimEnd('\') }
    if (-not $DataDir -and $installed.PSObject.Properties['Inno Setup CodeFile: DataDir']) { $DataDir = [string]$installed.'Inno Setup CodeFile: DataDir' }
    Add-Check 'OK' "VictorFlow Server $($installed.DisplayVersion) is installed"
} else {
    Add-Check 'FAIL' 'VictorFlow Server is not in the installed programs list'
}
if (-not $InstallDir) { $InstallDir = Join-Path $env:ProgramFiles 'VictorFlow Server' }
if (-not $DataDir) {
    $info = Join-Path $InstallDir 'install.json'
    if (Test-Path -LiteralPath $info) { try { $DataDir = (Get-Content -LiteralPath $info -Raw | ConvertFrom-Json).dataDir } catch { $DataDir = $null } }
}
if (-not $DataDir) { $DataDir = Join-Path $env:ProgramData 'VictorFlow' }
Add-Line "Program folder : $InstallDir"
Add-Line "Data folder    : $DataDir"
if (Test-Path -LiteralPath (Join-Path $InstallDir 'VERSION')) { Add-Line "VERSION file   : $((Get-Content -LiteralPath (Join-Path $InstallDir 'VERSION') -Raw).Trim())" }

# Secret values, only so they can be masked if they ever appear in a log. Never written out.
try {
    $sj = Get-Content -LiteralPath (Join-Path $DataDir 'secrets.json') -Raw -ErrorAction Stop | ConvertFrom-Json
    foreach ($prop in $sj.PSObject.Properties) { if ($prop.Value -is [string] -and $prop.Value.Length -ge 6) { $Secrets.Add($prop.Value) } }
} catch { $null = $_ }

# Ports from config.json (no secrets in it), else the defaults.
$Ports = @{ api = 3000; tracker = 3001; display = 3002; pg = 55432 }
$configText = $null
try {
    $configText = Get-Content -LiteralPath (Join-Path $DataDir 'config.json') -Raw -ErrorAction Stop
    $cfg = $configText | ConvertFrom-Json
    if ($cfg.PSObject.Properties['apiPort']) { $Ports.api = [int]$cfg.apiPort }
    if ($cfg.PSObject.Properties['trackerPort']) { $Ports.tracker = [int]$cfg.trackerPort }
    if ($cfg.PSObject.Properties['displayPort']) { $Ports.display = [int]$cfg.displayPort }
    if ($cfg.PSObject.Properties['pgPort']) { $Ports.pg = [int]$cfg.pgPort }
} catch { Add-Line "config.json    : not readable ($($_.Exception.Message)); using the default ports" }

# ---- 3. Services ----------------------------------------------------------------------------------------------------
Add-Section '3. Windows services'
foreach ($id in $ServiceIds) {
    $svc = Get-CimInstance Win32_Service -Filter "Name='$id'" -ErrorAction SilentlyContinue
    if (-not $svc) { Add-Check 'FAIL' "$id is not installed"; continue }
    Add-Line ("{0,-20} state={1,-8} start={2,-7} account={3} pid={4}" -f $id, $svc.State, $svc.StartMode, $svc.StartName, $svc.ProcessId)
    $problems = @()
    if ($svc.State -ne 'Running') { $problems += "is $($svc.State)" }
    if ($svc.StartMode -ne 'Auto') { $problems += "starts $($svc.StartMode)" }
    if ($svc.StartName -notmatch 'NetworkService') { $problems += "runs as $($svc.StartName)" }
    if ($problems.Count -eq 0) { Add-Check 'OK' "$id running, automatic, NetworkService" } else { Add-Check 'FAIL' "$id $($problems -join ', ')" }
}

Add-Section '4. vf-server status'
$vf = Join-Path $InstallDir 'vf-server.cmd'
if (Test-Path -LiteralPath $vf) {
    $out = (& $vf status --data-dir $DataDir 2>&1 | Out-String)
    $code = $LASTEXITCODE
    Add-Block "vf-server status (exit $code)" $out
    if ($code -eq 0) { Add-Check 'OK' 'vf-server status: everything answers' } else { Add-Check 'FAIL' "vf-server status exit code $code (3 = something is not answering)" }
} else {
    Add-Check 'FAIL' "vf-server.cmd not found in $InstallDir"
}

# ---- 5. HTTP ---------------------------------------------------------------------------------------------------------
Add-Section '5. API health, tracker and displays'
Test-Health '127.0.0.1' $Ports.api 'API on this PC'
foreach ($ip in $LanIps) { Test-Health $ip $Ports.api "API on the LAN address $ip" }
if ($LanIps.Count -gt 0) { Add-Line 'Note: a call from this PC to its own LAN address does not pass through Windows Firewall; check-client.ps1 on the other PC proves the network path.' }
foreach ($web in @(@{ Name = 'Tracking website'; Port = $Ports.tracker }, @{ Name = 'TV displays'; Port = $Ports.display })) {
    $url = "http://127.0.0.1:$($web.Port)/"
    $r = Invoke-Http $url
    Add-Line "GET $url -> HTTP $($r.Code) $($r.Error)"
    if ($r.Code -eq 200) { Add-Check 'OK' "$($web.Name) answers on port $($web.Port)" } else { Add-Check 'FAIL' "$($web.Name) on port $($web.Port): HTTP $($r.Code) $($r.Error)" }
}

# ---- 6. Ports -------------------------------------------------------------------------------------------------------
Add-Section '6. Listening ports'
foreach ($pair in @(@('API', $Ports.api, $true), @('Tracker', $Ports.tracker, $true), @('Displays', $Ports.display, $true), @('PostgreSQL', $Ports.pg, $false))) {
    $label = $pair[0]; $port = [int]$pair[1]; $lan = [bool]$pair[2]
    $conns = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    if ($conns.Count -eq 0) { Add-Check 'FAIL' "$label port $port is not listening"; continue }
    $where = @()
    foreach ($c in $conns) {
        $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        $pname = '?'
        if ($proc) { $pname = $proc.ProcessName }
        $where += "$($c.LocalAddress) ($pname, pid $($c.OwningProcess))"
    }
    Add-Line ("{0,-10} {1,5}: {2}" -f $label, $port, ($where -join '; '))
    $addresses = @($conns | ForEach-Object { $_.LocalAddress })
    $everywhere = @($addresses | Where-Object { $_ -eq '0.0.0.0' -or $_ -eq '::' }).Count -gt 0
    if ($lan -and $everywhere) { Add-Check 'OK' "$label listens on port $port for the LAN" }
    elseif ($lan) { Add-Check 'FAIL' "$label listens on port $port only on $($addresses -join ', ') (not reachable from other PCs)" }
    elseif ($everywhere) { Add-Check 'WARN' "PostgreSQL listens on all addresses on port $port; it should be 127.0.0.1 only" }
    else { Add-Check 'OK' "PostgreSQL listens on $($addresses -join ', '):$port only" }
}

# ---- 7. Firewall ----------------------------------------------------------------------------------------------------
Add-Section '7. Windows Firewall'
try {
    foreach ($fp in Get-NetFirewallProfile -ErrorAction Stop) { Add-Line ("Profile {0,-8}: firewall enabled={1}, inbound default {2}" -f $fp.Name, "$($fp.Enabled)", $fp.DefaultInboundAction) }
    $rules = @(Get-NetFirewallRule -DisplayName 'VictorFlow * (TCP *)' -ErrorAction SilentlyContinue)
    foreach ($rule in $rules) {
        $pf = $rule | Get-NetFirewallPortFilter
        $af = $rule | Get-NetFirewallApplicationFilter
        Add-Line ("Rule '{0}': enabled={1} {2} {3} profiles={4} port={5} program={6}" -f $rule.DisplayName, $rule.Enabled, $rule.Direction, $rule.Action, $rule.Profile, $pf.LocalPort, $af.Program)
    }
    foreach ($port in @($Ports.api, $Ports.tracker, $Ports.display)) {
        $match = @($rules | Where-Object { "$($_.Enabled)" -eq 'True' -and "$($_.Direction)" -eq 'Inbound' -and "$($_.Action)" -eq 'Allow' -and "$(($_ | Get-NetFirewallPortFilter).LocalPort)" -eq "$port" })
        if ($match.Count -gt 0) { Add-Check 'OK' "Firewall allows inbound TCP $port ($($match[0].Profile))" } else { Add-Check 'FAIL' "No enabled VictorFlow firewall rule for inbound TCP $port" }
    }
} catch { Add-Check 'WARN' "Firewall unavailable: $($_.Exception.Message)" }

# ---- 8. Data folder ------------------------------------------------------------------------------------------------
Add-Section "8. Data folder ($DataDir)"
$NoContent = @('secrets.json', 'first-login.txt')
if (-not (Test-Path -LiteralPath $DataDir)) {
    Add-Check 'FAIL' "The data folder $DataDir does not exist"
} else {
    try {
        foreach ($item in Get-ChildItem -LiteralPath $DataDir -Force -ErrorAction Stop) {
            if ($item.PSIsContainer) {
                $files = @(Get-ChildItem -LiteralPath $item.FullName -Recurse -File -Force -ErrorAction SilentlyContinue)
                $bytes = 0
                foreach ($f in $files) { $bytes += $f.Length }
                Add-Line ("  {0,-22} folder, {1} files, {2}" -f "$($item.Name)\", $files.Count, (Format-Size $bytes))
            } else {
                $note = ''
                if ($NoContent -contains $item.Name) { $note = '  (content not shown)' }
                Add-Line ("  {0,-22} {1}{2}" -f $item.Name, (Format-Size $item.Length), $note)
            }
        }
        foreach ($must in @('config.json', 'secrets.json', 'addresses.ini', 'first-login.txt', 'postgres\PG_VERSION', 'storage', 'logs\setup.log')) {
            if (-not (Test-Path -LiteralPath (Join-Path $DataDir $must))) { Add-Check 'FAIL' "Missing in the data folder: $must" }
        }
        if (Test-Path -LiteralPath (Join-Path $DataDir 'postgres\PG_VERSION')) { Add-Check 'OK' 'The data folder holds the database, config, secrets, storage and logs' }
    } catch { Add-Check 'FAIL' "Cannot list the data folder: $($_.Exception.Message)" }

    if ($configText) { Add-Block 'config.json (no secrets in it)' $configText }
    $ini = Join-Path $DataDir 'addresses.ini'
    if (Test-Path -LiteralPath $ini) { Add-Block 'addresses.ini (no secrets in it)' (Get-Tail $ini 40) }

    Add-Line ''
    Add-Line 'Permissions:'
    $broad = @{ 'S-1-1-0' = 'Everyone'; 'S-1-5-11' = 'Authenticated Users'; 'S-1-5-32-545' = 'Users' }
    foreach ($rel in @('.', 'secrets.json', 'first-login.txt', 'config.json', 'addresses.ini', 'postgres', 'logs')) {
        $target = (Join-Path $DataDir $rel)
        if (-not (Test-Path -LiteralPath $target)) { continue }
        try {
            $acl = Get-Acl -LiteralPath $target -ErrorAction Stop
            $protectedNote = ''
            if ($acl.AreAccessRulesProtected) { $protectedNote = ' (inheritance from the parent removed)' }
            Add-Line "  $rel$protectedNote"
            $readers = @()
            foreach ($rule in $acl.Access) {
                $sid = $null
                try { $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { $sid = "$($rule.IdentityReference)" }
                $how = 'explicit'
                if ($rule.IsInherited) { $how = 'inherited' }
                Add-Line ("      {0,-34} {1,-6} {2} ({3})" -f $rule.IdentityReference, $rule.AccessControlType, $rule.FileSystemRights, $how)
                if ($broad.ContainsKey($sid) -and "$($rule.AccessControlType)" -eq 'Allow') { $readers += $broad[$sid] }
            }
            if ($rel -eq 'secrets.json' -or $rel -eq 'first-login.txt') {
                if ($readers.Count -gt 0) { Add-Check 'FAIL' "$rel is readable by $($readers -join ', ')" } else { Add-Check 'OK' "$rel is readable only by administrators, SYSTEM and the services" }
            }
            if ($rel -eq '.') {
                $ns = @($acl.Access | Where-Object { try { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq 'S-1-5-20' } catch { $false } })
                if ($ns.Count -gt 0) { Add-Check 'OK' 'The services account (NETWORK SERVICE) has access to the data folder' } else { Add-Check 'FAIL' 'NETWORK SERVICE has no access to the data folder' }
            }
        } catch { Add-Line "  $rel : cannot read permissions ($($_.Exception.Message))" }
    }

    # ---- 9. Logs -----------------------------------------------------------------------------------------------------
    Add-Section '9. Logs (last 50 lines each, secrets masked)'
    $logs = Join-Path $DataDir 'logs'
    if (Test-Path -LiteralPath (Join-Path $logs 'setup.log')) { Add-Block 'logs\setup.log' (Get-Tail (Join-Path $logs 'setup.log')) }
    else { Add-Line 'logs\setup.log: not found' }
    foreach ($f in @(Get-ChildItem -LiteralPath $logs -Filter '*.log' -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'setup.log' } | Sort-Object Name)) {
        Add-Block "logs\$($f.Name) ($(Format-Size $f.Length), $($f.LastWriteTime.ToString('yyyy-MM-dd HH:mm')))" (Get-Tail $f.FullName)
    }
    $pgLog = Get-ChildItem -LiteralPath (Join-Path $DataDir 'postgres\log') -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($pgLog) { Add-Block "postgres\log\$($pgLog.Name)" (Get-Tail $pgLog.FullName) }
}

# The installer's own log (Inno Setup writes "Setup Log <date> #NNN.txt" to %TEMP%).
# Only a log of the VictorFlow Server installer (other programs' Inno Setup installers write the same file names).
$setupLog = Get-ChildItem -LiteralPath $env:TEMP -Filter 'Setup Log *.txt' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Where-Object { Select-String -LiteralPath $_.FullName -SimpleMatch 'VictorFlow' -List -Quiet } | Select-Object -First 1
if ($setupLog) {
    Add-Section "10. Installer log ($($setupLog.Name), last 60 lines)"
    Add-Block $setupLog.FullName (Get-Tail $setupLog.FullName 60)
}

# ---- write --------------------------------------------------------------------------------------------------------
$fails = @($Summary | Where-Object { $_ -like '`[FAIL*' }).Count
$warns = @($Summary | Where-Object { $_ -like '`[WARN*' }).Count
$header = @(
    'VictorFlow trial install -- SERVER report',
    "Written $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') on $env:COMPUTERNAME by check-server.ps1 ($ScriptVersion); administrator: $(Test-Admin)",
    "Result: $fails failed, $warns warnings",
    '',
    'SUMMARY'
) + $Summary
$report = Protect-Text ((($header + $Details) -join "`r`n") + "`r`n")

$targets = @()
if ($ReportPath) { $targets += $ReportPath }
$targets += (Join-Path $PSScriptRoot 'report-server.txt')
$targets += (Join-Path ([Environment]::GetFolderPath('Desktop')) 'report-server.txt')
$written = $null
foreach ($t in $targets) {
    try { [IO.File]::WriteAllText($t, $report, (New-Object Text.UTF8Encoding $true)); $written = $t; break } catch { $null = $_ }
}
Write-Host ''
Write-Host "Result: $fails failed, $warns warnings"
if ($written) { Write-Host "Report written to $written -- bring this file back." } else { Write-Host 'Could not write the report anywhere:'; Write-Host $report }
if ($Pause) { $null = Read-Host 'Press Enter to close this window' }
