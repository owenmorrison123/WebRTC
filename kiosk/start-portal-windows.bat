@echo off
rem ===================================================================
rem  Campus Portal kiosk launcher (Windows)
rem  - Opens the portal full screen in its own Chrome window
rem  - Reopens it within a minute if Chrome closes or crashes
rem  - Restarts Chrome once a day at 3:30 AM for a fresh start
rem  Setup: put this kiosk's portal link in portal-url.txt (same folder),
rem  then press Win+R, type shell:startup, and put a shortcut to this file there.
rem ===================================================================
setlocal
cd /d "%~dp0"
set /p PORTAL_URL=<portal-url.txt
set "PROFILE=%LOCALAPPDATA%\CampusPortalChrome"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" ( echo Google Chrome was not found. Install Chrome, then run this again. & pause & exit /b 1 )

rem Give the network a moment after the computer starts.
timeout /t 20 /nobreak >nul

:start
start "" "%CHROME%" --kiosk "%PORTAL_URL%" --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream --disable-session-crashed-bubble --noerrdialogs --disable-infobars --disable-features=Translate --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows

:watch
timeout /t 60 /nobreak >nul
set "NOW=%time: =0%"
if "%NOW:~0,5%"=="03:30" (
  taskkill /im chrome.exe /f >nul 2>&1
  timeout /t 15 /nobreak >nul
  goto start
)
tasklist /fi "imagename eq chrome.exe" | find /i "chrome.exe" >nul || goto start
goto watch
