param(
  [string]$TaskName = "MF Image Collector CDP",
  [string]$CdpEndpoint = "http://127.0.0.1:9222",
  [string]$NodeExe = "D:\Program Files\nodejs\node.exe"
)

$ErrorActionPreference = "Continue"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProductUrlDiscoveryVersion = "official-search-fr-en-jp-v1"

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

function Test-DiscoveryNotFoundResult($Entry) {
  if ($null -eq $Entry -or $null -eq $Entry.urlDiscovery) {
    return $false
  }
  $UrlStatus = Normalize-ProductUrlStatus $Entry.urlDiscovery.status
  if ($UrlStatus -eq "not_found") {
    return $true
  }
  return $UrlStatus -eq "error" -and [string]$Entry.urlDiscovery.error_message -eq "No official product page with exact reference was verified."
}

function Test-CurrentDiscoveryNotFoundResult($Entry) {
  return (Test-DiscoveryNotFoundResult $Entry) -and [string]$Entry.urlDiscovery.discovery_version -eq $ProductUrlDiscoveryVersion
}

function Test-LegacyDiscoveryNotFoundResult($Entry) {
  return (Test-DiscoveryNotFoundResult $Entry) -and -not (Test-CurrentDiscoveryNotFoundResult $Entry)
}

function Get-EffectiveLocalStatus($Entry) {
  if ($null -eq $Entry) {
    return "pending"
  }
  if ([string]$Entry.status -eq "complete") {
    return "complete"
  }
  if (Test-CurrentDiscoveryNotFoundResult $Entry) {
    return "not_found"
  }
  if (Test-LegacyDiscoveryNotFoundResult $Entry) {
    return "legacy_not_found_recheck"
  }
  if ([string]$Entry.status -eq "partial") {
    return "partial"
  }
  if ([string]$Entry.status -eq "retry") {
    return "retry"
  }
  if ([string]$Entry.status -eq "error") {
    return "error"
  }
  return "pending"
}

function Show-MasterSummary($Root, $NodeExe) {
  if (-not (Test-Path $NodeExe)) {
    Write-Host "Master status: Node not found at $NodeExe"
    return
  }

  try {
    Push-Location $Root
    $Output = & $NodeExe "collector\collector.js" "--status-json" 2>&1
    Pop-Location
    $JsonLine = @($Output | Where-Object { ([string]$_).Trim().StartsWith("{") } | Select-Object -Last 1)
    if ($JsonLine.Count -eq 0) {
      Write-Host "Master status: collector did not return JSON"
      return
    }
    $Summary = ([string]$JsonLine[-1]) | ConvertFrom-Json -ErrorAction Stop
    Write-Host ("Master rows: {0}" -f $Summary.master_rows)
    Write-Host ("Master status: complete={0} pending={1} not_found={2} legacy_not_found_recheck={3} retry={4} error={5} partial={6}" -f $Summary.counts.complete, $Summary.counts.pending, $Summary.counts.not_found, $Summary.counts.legacy_not_found_recheck, $Summary.counts.retry, $Summary.counts.error, $Summary.counts.partial)
    if ($null -ne $Summary.opportunistic_cache) {
      Write-Host ("Opportunistic cache: images={0} unapplied={1}" -f $Summary.opportunistic_cache.image_count, $Summary.opportunistic_cache.unapplied_image_count)
      Write-Host ("Review cache: candidates={0} unposted={1}" -f $Summary.opportunistic_cache.review_candidate_count, $Summary.opportunistic_cache.unposted_review_candidate_count)
    }
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
    Pop-Location -ErrorAction SilentlyContinue
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
    $Complete = @($Products | Where-Object { (Get-EffectiveLocalStatus $_.Value) -eq "complete" }).Count
    $Partial = @($Products | Where-Object { (Get-EffectiveLocalStatus $_.Value) -eq "partial" }).Count
    $Retry = @($Products | Where-Object { (Get-EffectiveLocalStatus $_.Value) -eq "retry" }).Count
    $ErrorCount = @($Products | Where-Object { (Get-EffectiveLocalStatus $_.Value) -eq "error" }).Count
    $NotFound = @($Products | Where-Object { (Get-EffectiveLocalStatus $_.Value) -eq "not_found" }).Count
    $LegacyNotFound = @($Products | Where-Object { (Get-EffectiveLocalStatus $_.Value) -eq "legacy_not_found_recheck" }).Count
    Write-Host "Local state products: $($Products.Count) complete=$Complete partial=$Partial retry=$Retry error=$ErrorCount not_found=$NotFound legacy_not_found_recheck=$LegacyNotFound"
    Write-Host "Recent local state:"
    $Products |
      Sort-Object { $_.Value.updated_at } -Descending |
      Select-Object -First 8 |
      ForEach-Object {
        $EffectiveStatus = Get-EffectiveLocalStatus $_.Value
        $UrlStatus = ""
        if ($null -ne $_.Value.urlDiscovery) {
          $UrlStatus = if (Test-CurrentDiscoveryNotFoundResult $_.Value) { "not_found" } elseif (Test-LegacyDiscoveryNotFoundResult $_.Value) { "legacy_not_found_recheck" } else { Normalize-ProductUrlStatus $_.Value.urlDiscovery.status }
        }
        Write-Host ("  {0}: {1} url={2} raw={3} updated={4}" -f $_.Name, $EffectiveStatus, $UrlStatus, $_.Value.status, $_.Value.updated_at)
      }
  } catch {
    Write-Host "Local state: invalid JSON - $($_.Exception.Message)"
  }
} else {
  Write-Host "Local state: not found"
}

Show-MasterSummary $Root $NodeExe
