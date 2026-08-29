param(
  [string]$TaskName = "MF Image Collector CDP",
  [string]$CdpEndpoint = "http://127.0.0.1:9222",
  [string]$NodeExe = "D:\Program Files\nodejs\node.exe"
)

$ErrorActionPreference = "Continue"

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
}

function Read-JsonFileUtf8($Path) {
  if (-not (Test-Path $Path)) {
    return $null
  }
  $Text = [System.IO.File]::ReadAllText((Resolve-Path $Path), [System.Text.Encoding]::UTF8)
  if ([string]::IsNullOrWhiteSpace($Text)) {
    return $null
  }
  return $Text | ConvertFrom-Json -ErrorAction Stop
}

function Normalize-ProductUrlStatus($Value) {
  $Status = ([string]$Value).Trim().ToLowerInvariant()
  if ($Status -eq "not_available") {
    return "not_found"
  }
  if (@("available", "not_found", "pending", "error") -contains $Status) {
    return $Status
  }
  return ""
}

function Show-MasterSummary($Root, $NodeExe) {
  if (-not (Test-Path $NodeExe)) {
    Write-Host "Master status: Node not found at $NodeExe"
    return
  }

  try {
    $Output = & $NodeExe "collector\collector.js" "--status-json" 2>&1
    $JsonLine = @($Output | Where-Object { ([string]$_).Trim().StartsWith("{") } | Select-Object -Last 1)
    if ($JsonLine.Count -eq 0) {
      Write-Host "Master status: collector did not return JSON"
      return
    }
    $Summary = ([string]$JsonLine[-1]) | ConvertFrom-Json -ErrorAction Stop
    Write-Host ("Master rows: {0}" -f $Summary.master_rows)
    Write-Host ("Master status: complete={0} pending={1} not_found={2} retry={3} error={4} partial={5}" -f $Summary.counts.complete, $Summary.counts.pending, $Summary.counts.not_found, $Summary.counts.retry, $Summary.counts.error, $Summary.counts.partial)
    Write-Host "Next candidates:"
    $Candidates = @($Summary.next_candidates)
    if ($Candidates.Count -eq 0) {
      Write-Host "  none"
      return
    }
    $Candidates | Select-Object -First 5 | ForEach-Object {
      Write-Host ("  {0}: {1} master={2} state={3} url={4}" -f $_.reference, $_.name, $_.master_status, $_.state_status, $_.url_discovery_status)
    }
  } catch {
    Write-Host "Master status: collector status failed - $($_.Exception.Message)"
  }
}

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
$State = $null
if (Test-Path $StateFile) {
  try {
    $State = Read-JsonFileUtf8 $StateFile
    $Products = @($State.products.PSObject.Properties)
    $Complete = @($Products | Where-Object { $_.Value.status -eq "complete" }).Count
    $Partial = @($Products | Where-Object { $_.Value.status -eq "partial" }).Count
    $Retry = @($Products | Where-Object { $_.Value.status -eq "retry" }).Count
    $ErrorCount = @($Products | Where-Object { $_.Value.status -eq "error" }).Count
    $NotFound = @($Products | Where-Object { $null -ne $_.Value.urlDiscovery -and (Normalize-ProductUrlStatus $_.Value.urlDiscovery.status) -eq "not_found" }).Count
    Write-Host "Local state products: $($Products.Count) complete=$Complete partial=$Partial retry=$Retry error=$ErrorCount not_found=$NotFound"
    Write-Host "Recent local state:"
    $Products |
      Sort-Object { $_.Value.updated_at } -Descending |
      Select-Object -First 8 |
      ForEach-Object {
        $UrlStatus = ""
        if ($null -ne $_.Value.urlDiscovery) {
          $UrlStatus = Normalize-ProductUrlStatus $_.Value.urlDiscovery.status
        }
        Write-Host ("  {0}: {1} url={2} updated={3}" -f $_.Name, $_.Value.status, $UrlStatus, $_.Value.updated_at)
      }
  } catch {
    Write-Host "Local state: invalid JSON - $($_.Exception.Message)"
  }
} else {
  Write-Host "Local state: not found"
}

Show-MasterSummary $Root $NodeExe
