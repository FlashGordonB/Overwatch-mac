@echo off
setlocal

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found in PATH.
  echo Install Node.js and reopen this script.
  pause
  exit /b 1
)

set "PORT=3010"
set "HOST=127.0.0.1"
set "PUBLIC_ORIGIN=https://spin.bownsfam.app"
set "DOMAIN=spin.bownsfam.app"
set "CADDY_EXE=C:\caddy\caddy.exe"
set "CADDYFILE=C:\caddy\Caddyfile.txt"
set "UPSTREAM=127.0.0.1:%PORT%"

echo Starting Party Character Spinner for domain hosting...
echo HOST=%HOST%
echo PORT=%PORT%
echo PUBLIC_ORIGIN=%PUBLIC_ORIGIN%
echo.

if not exist "%CADDY_EXE%" (
  echo Caddy was not found at %CADDY_EXE%.
  echo Copy caddy.exe to C:\caddy\ and rerun this script.
  pause
  exit /b 1
)

if not exist "C:\caddy" mkdir "C:\caddy"

(
  echo %DOMAIN% {
  echo     reverse_proxy %UPSTREAM%
  echo }
) > "%CADDYFILE%"

start "Party Spinner Server" cmd /k "cd /d %~dp0 && set HOST=%HOST% && set PORT=%PORT% && set PUBLIC_ORIGIN=%PUBLIC_ORIGIN% && npm.cmd start"
start "Caddy Reverse Proxy" "%CADDY_EXE%" run --config "%CADDYFILE%"

timeout /t 2 /nobreak >nul

echo Open:
echo %PUBLIC_ORIGIN%/host
echo %PUBLIC_ORIGIN%/view
echo.
echo Caddy config written to %CADDYFILE%.
echo Reverse proxy target: http://%UPSTREAM%
pause
