param(
  [string]$TaskName = "MF Image Collector CDP",
  [string]$Root = "",
  [string]$CdpEndpoint = "http://127.0.0.1:9222",
  [string]$NodeExe = "node",
  [string]$MasterGasApiUrl = "",
  [switch]$WriteBack
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = Resolve-Path (Join-Path $PSScriptRoot "..")
}

$Script = Join-Path $Root "collector\run-cdp-once.ps1"
$Argument = "-NoProfile -ExecutionPolicy Bypass -File `"$Script`" -Root `"$Root`" -CdpEndpoint `"$CdpEndpoint`" -NodeExe `"$NodeExe`""
if (-not [string]::IsNullOrWhiteSpace($MasterGasApiUrl)) {
  $Argument += " -MasterGasApiUrl `"$MasterGasApiUrl`""
}
if ($WriteBack) {
  $Argument += " -WriteBack"
}

$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $Argument -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 45)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
$RegisteredTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
$RegisteredInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop

Write-Host "Registered scheduled task: $TaskName"
Write-Host "State: $($RegisteredTask.State)"
Write-Host "LastTaskResult: $($RegisteredInfo.LastTaskResult)"
Write-Host "NextRunTime: $($RegisteredInfo.NextRunTime)"
Write-Host "Root: $Root"
Write-Host "CDP endpoint: $CdpEndpoint"
Write-Host "Node: $NodeExe"
Write-Host "Master GAS API URL: $([bool](-not [string]::IsNullOrWhiteSpace($MasterGasApiUrl)))"
Write-Host "Writeback: $($WriteBack.IsPresent)"
Write-Host "The task runs once per hour and each run processes at most maxPerRun products."
