param(
  [string]$Root = "",
  [string]$Action = "getReviewItems",
  [string]$Status = "要確認",
  [string]$Reference = "T11626",
  [string]$OfficialName = "MARGARET'S HOPE",
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
    diff_summary = "銘柄マスターに存在しないTリファレンス候補です。"
    evidence = "PowerShell UTF-8 validation payload."
    status = "要確認"
  }
} else {
  throw "Unsupported safe action for this helper: $Action"
}

$Json = $Payload | ConvertTo-Json -Depth 20 -Compress
$Body = [System.Text.Encoding]::UTF8.GetBytes($Json)
Invoke-RestMethod -Uri $Config.masterGasApiUrl -Method Post -ContentType "application/json; charset=utf-8" -Body $Body
