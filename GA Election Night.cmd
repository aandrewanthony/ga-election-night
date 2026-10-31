@echo off
rem Double-click to open GA Election Night.
rem Uses the installed app if there is one, then a local Windows build, then builds and runs from source.
setlocal
cd /d "%~dp0"
set "INSTALLED=%LOCALAPPDATA%\Programs\GA Election Night\GA Election Night.exe"
set "BUILT=%~dp0release\win-unpacked\GA Election Night.exe"

if exist "%INSTALLED%" (
  start "" "%INSTALLED%"
  exit /b 0
)
if exist "%BUILT%" (
  start "" "%BUILT%"
  exit /b 0
)

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it from https://nodejs.org, or use the Windows zip in the release folder.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing packages...
  call npm install --no-audit --no-fund || (pause & exit /b 1)
)
echo Building and starting GA Election Night...
call npm run desktop
if errorlevel 1 pause
