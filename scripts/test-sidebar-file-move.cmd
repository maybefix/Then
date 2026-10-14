@echo off
setlocal
cd /d "%~dp0.."
if not exist "test-artifacts\sidebar-move-lock" mkdir "test-artifacts\sidebar-move-lock"
node scripts\investigate-sidebar-move-lock.mjs --verify > "test-artifacts\sidebar-move-lock\regression.log" 2>&1
exit /b %errorlevel%
