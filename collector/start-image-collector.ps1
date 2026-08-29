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

if ([string]::IsNullOrWhiteSpace($env:MF_COLLECTOR_WRITE_SECRET)) {
  $UserSecret = [Environment]::GetEnvironmentVariable("MF_COLLECTOR_WRITE_SECRET", "User")
  if (-not [string]::IsNullOrWhiteSpace($UserSecret)) {
    $env:MF_COLLECTOR_WRITE_SECRET = $UserSecret
  }
}

if ([string]::IsNullOrWhiteSpace($env:MF_COLLECTOR_WRITE_SECRET)) {
  throw "MF_COLLECTOR_WRITE_SECRET is not set. Set the user environment variable before starting image collection."
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
  $LogDir = Join-Path $Root "logs"
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  $InitialLog = Join-Path $LogDir ("start-initial-run-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
  $LASTEXITCODE = 0
  $InitialOutput = & (Join-Path $Root "collector\run-cdp-once.ps1") -Root $Root -CdpEndpoint $CdpEndpoint -NodeExe $NodeExe -WriteBack 2>&1 | Tee-Object -FilePath $InitialLog
  $InitialExitCode = $LASTEXITCODE
  $InitialText = $InitialOutput -join "`n"

  if ($InitialText -match "browser verification|Cloudflare|verify you are human|vérifiez que vous êtes humain") {
    Write-Host ""
    Write-Host "Cloudflare verification appears to be required again."
    Write-Host "Complete verification in the dedicated Chrome window, then run 画像回収_開始.bat again."
    Write-Host "The hourly task was not registered."
    Write-Host "Initial run log: $InitialLog"
    exit 1
  }

  if ($InitialExitCode -ne 0 -or $InitialText -match "MF_COLLECTOR_WRITE_SECRET is not set|Chrome CDP endpoint is not available|Master GAS API returned|No GAS API URL is configured|writeBack.enabled is true, but no GAS API URL") {
    Write-Host ""
    Write-Host "The initial collector run failed before normal product processing could continue."
    Write-Host "Initial run log: $InitialLog"
    exit 1
  }
}

Write-Host "Registering hourly collector task..."
& (Join-Path $Root "collector\register-hourly-cdp-task.ps1") -TaskName $TaskName -Root $Root -CdpEndpoint $CdpEndpoint -NodeExe $NodeExe -WriteBack

$RegisteredTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
$RegisteredInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop
Write-Host ""
Write-Host "Verified scheduled task: $TaskName"
Write-Host "State: $($RegisteredTask.State)"
Write-Host "NextRunTime: $($RegisteredInfo.NextRunTime)"

Write-Host ""
Write-Host "Image collector is started. It will process at most 5 products per run."
