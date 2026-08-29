param(
  [string]$Root = "",
  [string]$CdpEndpoint = "http://127.0.0.1:9222",
  [switch]$Debug,
  [switch]$WriteBack
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = Resolve-Path (Join-Path $PSScriptRoot "..")
}

Set-Location $Root

try {
  Invoke-RestMethod -Uri "$CdpEndpoint/json/version" -Method Get -TimeoutSec 3 | Out-Null
} catch {
  throw "Chrome CDP endpoint is not available at $CdpEndpoint. Start collector\start-chrome-cdp.ps1 first and leave Chrome open."
}

$args = @("collector\collector.js", "--connect-cdp", $CdpEndpoint)
if ($Debug) {
  $args += "--debug"
}
if ($WriteBack) {
  $args += "--write-back"
}

node @args
