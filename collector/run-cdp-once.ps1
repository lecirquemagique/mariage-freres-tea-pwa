param(
  [string]$Root = "",
  [string]$CdpEndpoint = "http://127.0.0.1:9222",
  [string]$NodeExe = "node",
  [string]$MasterGasApiUrl = "",
  [switch]$Debug,
  [switch]$WriteBack
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Mutex = New-Object System.Threading.Mutex($false, "MFImageCollectorRun")
$LockTaken = $false
$RunExitCode = 0

try {
  $LockTaken = $Mutex.WaitOne(0)
  if (-not $LockTaken) {
    Write-Host "Another MF image collector run is already active. Skipping this run."
    exit 0
  }

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = Resolve-Path (Join-Path $PSScriptRoot "..")
}

Set-Location $Root
$LogDir = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$RunLog = Join-Path $LogDir ("scheduled-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
Add-Content -Path $RunLog -Encoding UTF8 -Value ("Started: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
Add-Content -Path $RunLog -Encoding UTF8 -Value ("Root: " + $Root)
Add-Content -Path $RunLog -Encoding UTF8 -Value ("CDP endpoint: " + $CdpEndpoint)
Add-Content -Path $RunLog -Encoding UTF8 -Value ("Node: " + $NodeExe)

if ($WriteBack -and [string]::IsNullOrWhiteSpace($env:MF_COLLECTOR_WRITE_SECRET)) {
  $UserSecret = [Environment]::GetEnvironmentVariable("MF_COLLECTOR_WRITE_SECRET", "User")
  if (-not [string]::IsNullOrWhiteSpace($UserSecret)) {
    $env:MF_COLLECTOR_WRITE_SECRET = $UserSecret
  }
}

if ($WriteBack -and [string]::IsNullOrWhiteSpace($env:MF_COLLECTOR_WRITE_SECRET)) {
  Add-Content -Path $RunLog -Encoding UTF8 -Value "ERROR: MF_COLLECTOR_WRITE_SECRET is not set."
  throw "MF_COLLECTOR_WRITE_SECRET is not set. Set the user environment variable before running write-back."
}

try {
  Invoke-RestMethod -Uri "$CdpEndpoint/json/version" -Method Get -TimeoutSec 3 | Out-Null
} catch {
  Add-Content -Path $RunLog -Encoding UTF8 -Value ("ERROR: Chrome CDP endpoint is not available at " + $CdpEndpoint)
  throw "Chrome CDP endpoint is not available at $CdpEndpoint. Start collector\start-chrome-cdp.ps1 first and leave Chrome open."
}

$args = @("collector\collector.js", "--connect-cdp", $CdpEndpoint)
if (-not [string]::IsNullOrWhiteSpace($MasterGasApiUrl)) {
  $env:MF_MASTER_GAS_API_URL = $MasterGasApiUrl
  $env:MF_MASTER_WRITE_GAS_API_URL = $MasterGasApiUrl
}
if ($Debug) {
  $args += "--debug"
}
if ($WriteBack) {
  $args += "--write-back"
}

$LASTEXITCODE = 0
Write-Host "Run log: $RunLog"
& $NodeExe @args 2>&1 | Tee-Object -FilePath $RunLog -Append
$RunExitCode = $LASTEXITCODE
Add-Content -Path $RunLog -Encoding UTF8 -Value ("Finished: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " exit=" + $RunExitCode)
} finally {
  if ($LockTaken) {
    $Mutex.ReleaseMutex()
  }
  $Mutex.Dispose()
}

exit $RunExitCode
