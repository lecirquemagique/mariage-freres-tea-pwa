@echo off
chcp 65001 >nul
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Disable-ScheduledTask -TaskName 'MF New Tea Discovery' -ErrorAction SilentlyContinue | Out-Null; Write-Host 'MF New Tea Discovery disabled.'"
pause
