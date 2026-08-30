param(
  [string]$Root = "",
  [string]$Action = "getReviewItems",
  [string]$Status = "",
  [string]$Reference = "T11626",
  [string]$OfficialName = "MARGARET S HOPE",
  [string]$OfficialUrl = "https://www.mariagefreres.com/en/margaret-s-hope-t11626-tea-by-the-weight.html",
  [string]$SourceLanguage = "EN"
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = Resolve-Path (Join-Path $PSScriptRoot "..")
}

$ConfigPath = Join-Path $Root "config.json"
$Config = Get-Content -Raw $ConfigPath -Encoding UTF8 | ConvertFrom-Json
$Secret = [Environment]::GetEnvironmentVariable("MF_COLLECTOR_WRITE_SECRET", "User")
if ([string]::IsNullOrWhiteSpace($Secret)) {
  $Secret = $env:MF_COLLECTOR_WRITE_SECRET
}
if ([string]::IsNullOrWhiteSpace($Secret)) {
  throw "MF_COLLECTOR_WRITE_SECRET is not set."
}

function ConvertFrom-Utf8Hex($Hex) {
  $Clean = ($Hex -replace '\s+', '')
  $Bytes = for ($i = 0; $i -lt $Clean.Length; $i += 2) {
    [Convert]::ToByte($Clean.Substring($i, 2), 16)
  }
  [System.Text.Encoding]::UTF8.GetString([byte[]]$Bytes)
}

$PendingStatus = ConvertFrom-Utf8Hex "E8A681E7A2BAE8AA8D"
$JapaneseDiffSummary = ConvertFrom-Utf8Hex "E98A98E69F84E3839EE382B9E382BFE383BCE381ABE5AD98E59CA8E38197E381AAE3818454E383AAE38395E382A1E383ACE383B3E382B9E58099E8A39CE381A7E38199E38082"
$JapaneseEvidence = ConvertFrom-Utf8Hex "506F7765725368656C6C205554462D382076616C69646174696F6E207061796C6F61642E"

if ([string]::IsNullOrWhiteSpace($Status)) {
  $Status = $PendingStatus
}

$Payload = @{
  action = $Action
  secret = $Secret
}

if ($Action -eq "getReviewItems") {
  $Payload.status = $Status
} elseif ($Action -eq "validateReviewCandidate") {
  $Payload.candidate = @{
    reference = $Reference
    detection_type = "unregistered_reference"
    official_url = $OfficialUrl
    official_name = $OfficialName
    source_language = $SourceLanguage
    diff_summary = $JapaneseDiffSummary
    evidence = $JapaneseEvidence
    status = $PendingStatus
  }
} else {
  throw "Unsupported safe action for this helper: $Action"
}

$Json = $Payload | ConvertTo-Json -Depth 20 -Compress
$Body = [System.Text.Encoding]::UTF8.GetBytes($Json)
Invoke-RestMethod -Uri $Config.masterGasApiUrl -Method Post -ContentType "application/json; charset=utf-8" -Body $Body
