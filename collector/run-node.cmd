@echo off
setlocal
set "NODE_EXE=D:\Program Files\nodejs\node.exe"

if not exist "%NODE_EXE%" (
  where.exe node >nul 2>nul
  if errorlevel 1 (
    echo Node.js was not found. Install Node.js or update collector\run-node.cmd.
    exit /b 1
  )
  set "NODE_EXE=node"
)

"%NODE_EXE%" %*
exit /b %ERRORLEVEL%
