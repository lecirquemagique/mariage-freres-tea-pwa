param(
  [string]$TaskName = "MF Image Collector CDP",
  [string]$Root = "",
  [string]$CdpEndpoint = "http://127.0.0.1:9222"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = Resolve-Path (Join-Path $PSScriptRoot "..")
}

$Script = Join-Path $Root "collector\run-cdp-once.ps1"
$Argument = "-NoProfile -ExecutionPolicy Bypass -File `"$Script`" -Root `"$Root`" -CdpEndpoint `"$CdpEndpoint`""

$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $Argument -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours 1)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel LeastPrivilege
$Settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 45)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName"
Write-Host "Root: $Root"
Write-Host "CDP endpoint: $CdpEndpoint"
Write-Host "The task runs once per hour and each run processes at most maxPerRun products."
