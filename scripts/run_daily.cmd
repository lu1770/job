@echo off
chcp 65001 >nul
rem ============================================================
rem  WorkBuddy job auto-apply - scheduled task entry (every 3h)
rem  Steps: probe CDP 9222 -> launch Chrome if down -> run daily
rem  NOTE: cmd parses this file with the active code page, so the
rem  header switches to UTF-8 (65001) to pass CJK keywords intact.
rem  Keep comments ASCII-only; CJK in comments can break parsing.
rem ============================================================
setlocal EnableExtensions

set "JOBDIR=C:\Users\rainb\WorkBuddy\automation-2026-10-09-22-45-06\job"
set "NODE=C:\Users\rainb\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "CDPDIR=C:\chrome-cdp"
set "LOGDIR=%JOBDIR%\data\logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "TS=%%t"
set "LOG=%LOGDIR%\cron-%TS%.log"

echo ============================================================>> "%LOG%"
echo START %TS%>> "%LOG%"
echo CMD: node src/cli.mjs daily --platform liepin,boss,zhaopin,job51>> "%LOG%"

rem ---------- 1. CDP health probe ----------
curl -s -m 5 http://127.0.0.1:9222/json/version 2>nul | findstr /C:webSocketDebuggerUrl >nul 2>&1
if not errorlevel 1 goto :RUN_JOB

rem ---------- 2. CDP down: launch Chrome with remote debugging ----------
echo CDP 9222 DOWN - launching Chrome with remote debugging...>> "%LOG%"
if exist "%CDPDIR%\SingletonLock" del /f /q "%CDPDIR%\SingletonLock" >nul 2>&1
if exist "%CDPDIR%\SingletonCookie" del /f /q "%CDPDIR%\SingletonCookie" >nul 2>&1
if exist "%CDPDIR%\SingletonSocket" del /f /q "%CDPDIR%\SingletonSocket" >nul 2>&1
start "" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%CDPDIR%" --profile-directory="Profile 1" --disable-blink-features=AutomationControlled --no-first-run --no-default-browser-check
for /l %%i in (1,1,30) do (
  ping -n 2 127.0.0.1 >nul 2>&1
  curl -s -m 3 http://127.0.0.1:9222/json/version 2>nul | findstr /C:webSocketDebuggerUrl >nul 2>&1 && goto :RUN_JOB
)
echo WARNING: CDP still unreachable after 60s - job will likely abort at login check.>> "%LOG%"

:RUN_JOB
cd /d "%JOBDIR%"
"%NODE%" src/cli.mjs daily --platform liepin,boss,zhaopin,job51 >> "%LOG%" 2>&1
if errorlevel 1 (set "RC=1") else (set "RC=0")
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do echo END %%t rc=%RC% >> "%LOG%"
exit /b %RC%