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

where ngrok >nul 2>nul
if errorlevel 1 (
  echo ngrok was not found in PATH.
  echo Install ngrok and run: ngrok config add-authtoken YOUR_TOKEN
  pause
  exit /b 1
)

echo Starting Party Character Spinner server...
start "Party Spinner Server" cmd /k "cd /d %~dp0 && npm start"

timeout /t 4 /nobreak >nul

echo Starting ngrok tunnel on port 3010...
start "Party Spinner Ngrok" cmd /k "ngrok http 3010"

timeout /t 3 /nobreak >nul

echo Opening host page...
start "" "http://localhost:3010/host"

echo.
echo Viewer URL will be shown in the ngrok window.
echo Share the /view path from that ngrok URL with friends.
echo.
pause
