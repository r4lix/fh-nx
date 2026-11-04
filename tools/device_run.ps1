# One self-driving device run through SwitchLink (-Dev lite for the Lite, default the OLED; -Nro picks the host build) (needs the SwitchLink app connected: sl.ps1 status).
#   powershell -ExecutionPolicy Bypass -File tools\lite_arm.ps1 -Boot build\boot_B.js -Probe build\dev_survey_B.js [-Tag B]
# Uploads boot.js + the probe (as www/js/dev_extra.js), launches fh-nx.nro, waits for it to quit (the probe calls nx.quit) and
# for the SwitchLink app to come back, then fetches log.txt to build\lite_log_<Tag>_<time>.txt and prints the probe's lines.
param([Parameter(Mandatory)][string]$Boot, [Parameter(Mandatory)][string]$Probe, [string]$Tag = "run", [int]$Timeout = 480,
      [string]$Dev = "", [string]$Nro = "/switch/fh-nx/fh-nx.nro",
      [string]$Grep = '\[maps\]|\[coarse\]|tick errors|EXCEPTION|MV ERROR|V8|\[host\]')
$ErrorActionPreference = "Stop"
if ($Dev) { $env:SL_DEV = $Dev } else { Remove-Item Env:SL_DEV -ErrorAction SilentlyContinue }
$sl = 'C:\Users\Admin\Downloads\switchlink\tools\sl.ps1'
$root = Split-Path $PSScriptRoot -Parent
function Lk { powershell -NoProfile -ExecutionPolicy Bypass -File $sl @args 2>&1 | Out-String }
function Put($local, $remote) { [void](Lk del $remote); $r = Lk put (Resolve-Path $local).Path $remote; if ($r -notmatch '"ok": true') { throw "upload $local -> $remote failed: $r" } }

$st = Lk status
if ($st -notmatch '"app": \{"connected": true') { throw "SwitchLink app not connected: $st" }
Put $Boot "/switch/fh-nx/js/boot.js"
Put $Probe "/switch/fh-nx/www/js/dev_extra.js"
[void](Lk del /switch/fh-nx/log.txt)
"launch: " + (Lk launch $Nro).Trim()
Start-Sleep 20
"wait:   " + (Lk waitapp $Timeout).Trim()
$out = Join-Path $root ("build\dev_log_{0}_{1}.txt" -f $Tag, (Get-Date -Format HHmmss))
[void](Lk get /switch/fh-nx/log.txt $out)
[void](Lk del "/switch/fh-nx/www/js/dev_extra.js")   # otherwise the next normal launch auto-plays
"log:    $out ($((Get-Item $out).Length) bytes)"
Select-String -Path $out -Pattern $Grep | Where-Object { $_.Line -notmatch 'require is not defined|Unexpected identifier' } | ForEach-Object { $_.Line.Substring(0, [Math]::Min(150, $_.Line.Length)) }
