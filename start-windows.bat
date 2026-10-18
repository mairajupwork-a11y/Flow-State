@echo off
title Flowstate
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then run this file again.
  echo.
  pause
  exit /b 1
)
echo.
echo   Installing Flowstate (first run takes a minute)...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo   Installation failed. Copy the messages above and send them over for help.
  pause
  exit /b 1
)
if not exist ".env" (
  findstr /r /c:"^DATABASE_URL=..*" ".env.example" >nul 2>nul && (
    copy /y ".env.example" ".env" >nul
    echo.
    echo   Found your database settings in .env.example and copied them to .env.
  )
)
echo.
echo   Starting Flowstate. Your browser will open at http://127.0.0.1:5173
echo   Keep this window open while you use the app. Close it to stop Flowstate.
echo.
start "" cmd /c "timeout /t 8 /nobreak >nul & start http://127.0.0.1:5173"
call npm run dev
pause
