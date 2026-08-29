param(
  [string]$TaskName = "MF Image Collector CDP",
  [string]$CdpEndpoint = "http://127.0.0.1:9222"
)

$ErrorActionPreference = "Continue"

$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Task) {
  Write-Host "Task: $TaskName"
  Write-Host "State: $($Task.State)"
  $Info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($Info) {
    Write-Host "LastRunTime: $($Info.LastRunTime)"
    Write-Host "LastTaskResult: $($Info.LastTaskResult)"
    Write-Host "NextRunTime: $($Info.NextRunTime)"
  }
} else {
  Write-Host "Task: not registered"
}

try {
  $Version = Invoke-RestMethod -Uri "$CdpEndpoint/json/version" -Method Get -TimeoutSec 3
  Write-Host "CDP Chrome: available ($($Version.Browser))"
} catch {
  Write-Host "CDP Chrome: unavailable"
}

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$StateFile = Join-Path $Root "collector-state.json"
if (Test-Path $StateFile) {
  $State = Get-Content -Raw $StateFile | ConvertFrom-Json
  $Products = @($State.products.PSObject.Properties)
  $Complete = @($Products | Where-Object { $_.Value.status -eq "complete" }).Count
  $Partial = @($Products | Where-Object { $_.Value.status -eq "partial" }).Count
  $Retry = @($Products | Where-Object { $_.Value.status -eq "retry" }).Count
  $ErrorCount = @($Products | Where-Object { $_.Value.status -eq "error" }).Count
  Write-Host "Local state products: $($Products.Count) complete=$Complete partial=$Partial retry=$Retry error=$ErrorCount"
  Write-Host "Recent local state:"
  $Products |
    Sort-Object { $_.Value.updated_at } -Descending |
    Select-Object -First 8 |
    ForEach-Object {
      Write-Host ("  {0}: {1} updated={2}" -f $_.Name, $_.Value.status, $_.Value.updated_at)
    }
} else {
  Write-Host "Local state: not found"
}
