param(
  [string]$TaskName = "MF Image Collector CDP",
  [string]$Root = "",
  [string]$CdpEndpoint = "http://127.0.0.1:9222",
  [string]$NodeExe = "D:\Program Files\nodejs\node.exe",
  [switch]$SkipInitialRun
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = Resolve-Path (Join-Path $PSScriptRoot "..")
}

Set-Location $Root

if (-not (Test-Path $NodeExe)) {
  throw "Node.js was not found at $NodeExe"
}

$ExistingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($ExistingTask -and $ExistingTask.State -ne "Disabled") {
  Write-Host "Collector task is already registered: $TaskName ($($ExistingTask.State))"
  Write-Host "No second scheduler was started."
  exit 0
}

$CdpReady = $false
try {
  Invoke-RestMethod -Uri "$CdpEndpoint/json/version" -Method Get -TimeoutSec 3 | Out-Null
  $CdpReady = $true
} catch {
  $CdpReady = $false
}

if (-not $CdpReady) {
  Write-Host "Starting collector Chrome for CDP..."
  & (Join-Path $Root "collector\start-chrome-cdp.ps1")
  Write-Host ""
  Write-Host "Complete Cloudflare verification in the opened Chrome window if it appears."
  Read-Host "Press Enter here after the MARIAGE FRERES page is usable"
}

if (-not $SkipInitialRun) {
  Write-Host "Running one collector pass now..."
  & (Join-Path $Root "collector\run-cdp-once.ps1") -Root $Root -CdpEndpoint $CdpEndpoint -NodeExe $NodeExe -WriteBack
}

Write-Host "Registering hourly collector task..."
& (Join-Path $Root "collector\register-hourly-cdp-task.ps1") -TaskName $TaskName -Root $Root -CdpEndpoint $CdpEndpoint -NodeExe $NodeExe -WriteBack

Write-Host ""
Write-Host "Image collector is started. It will process at most 5 products per run."
