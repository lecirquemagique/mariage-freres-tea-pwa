param(
  [int]$Port = 9222,
  [string]$ProfileDir = "",
  [string]$Url = "https://www.mariagefreres.com/fr/yin-zhen-t2301-thes-au-poids.html"
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
if ([string]::IsNullOrWhiteSpace($ProfileDir)) {
  $ProfileDir = Join-Path $Root "chrome-cdp-profile"
}

$ChromeCandidates = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)

$Chrome = $ChromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $Chrome) {
  throw "Google Chrome was not found in Program Files. Install Chrome or pass a Chrome path manually."
}

New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null

Write-Host "Starting Chrome:"
Write-Host "  Chrome:     $Chrome"
Write-Host "  CDP:        http://127.0.0.1:$Port"
Write-Host "  ProfileDir: $ProfileDir"
Write-Host "  URL:        $Url"
Write-Host ""
Write-Host "Leave this Chrome window open after completing Cloudflare verification."

Start-Process -FilePath $Chrome -ArgumentList @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$ProfileDir",
  "--new-window",
  $Url
)
