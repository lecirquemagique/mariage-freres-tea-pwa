param(
  [string]$TaskName = "MF Image Collector CDP",
  [switch]$CloseChrome
)

$ErrorActionPreference = "Stop"

$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Task) {
  Disable-ScheduledTask -TaskName $TaskName | Out-Null
  Write-Host "Disabled scheduled task: $TaskName"
  $Info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($Info) {
    Write-Host "Last run time: $($Info.LastRunTime)"
    Write-Host "Last task result: $($Info.LastTaskResult)"
  }
} else {
  Write-Host "Scheduled task was not found: $TaskName"
}

Write-Host "Running collector processes are not forcibly killed by default."
Write-Host "If a run is active, it can finish the current product safely; future runs are disabled."

if ($CloseChrome) {
  $Root = Resolve-Path (Join-Path $PSScriptRoot "..")
  $ProfileDir = Join-Path $Root "chrome-cdp-profile"
  $ChromeProcesses = Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -eq "chrome.exe" -and
      $_.CommandLine -and
      $_.CommandLine.Contains("--remote-debugging-port=9222") -and
      $_.CommandLine.Contains($ProfileDir)
    }

  foreach ($Process in $ChromeProcesses) {
    Write-Host "Closing collector Chrome PID $($Process.ProcessId)"
    Stop-Process -Id $Process.ProcessId -Force
  }
  if (-not $ChromeProcesses) {
    Write-Host "Collector Chrome was not found."
  }
}
