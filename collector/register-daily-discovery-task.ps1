param(
  [string]$TaskName = "MF New Tea Discovery",
  [string]$Root = "",
  [string]$CdpEndpoint = "http://127.0.0.1:9222",
  [string]$NodeExe = "D:\Program Files\nodejs\node.exe",
  [string]$MasterGasApiUrl = "",
  [string]$At = "09:15",
  [switch]$WriteBack
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = Resolve-Path (Join-Path $PSScriptRoot "..")
}

$Script = Join-Path $Root "collector\run-discovery-once.ps1"
$Argument = "-NoProfile -ExecutionPolicy Bypass -File `"$Script`" -Root `"$Root`" -CdpEndpoint `"$CdpEndpoint`" -NodeExe `"$NodeExe`""
if (-not [string]::IsNullOrWhiteSpace($MasterGasApiUrl)) {
  $Argument += " -MasterGasApiUrl `"$MasterGasApiUrl`""
}
if ($WriteBack) {
  $Argument += " -WriteBack"
}

$RunAt = [DateTime]::ParseExact($At, "HH:mm", [Globalization.CultureInfo]::InvariantCulture)
$Trigger = New-ScheduledTaskTrigger -Daily -At $RunAt
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $Argument -WorkingDirectory $Root
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
Write-Host "The task runs once per day and records unregistered official T references for human review."
