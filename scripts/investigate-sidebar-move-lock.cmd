@echo off
setlocal
cd /d "%~dp0.."
if not exist "test-artifacts\sidebar-move-lock" mkdir "test-artifacts\sidebar-move-lock"
node scripts\investigate-sidebar-move-lock.mjs > "test-artifacts\sidebar-move-lock\run.log" 2>&1
exit /b %errorlevel%
