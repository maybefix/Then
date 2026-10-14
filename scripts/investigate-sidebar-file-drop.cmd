@echo off
setlocal
cd /d "%~dp0.."
if not exist "test-artifacts\sidebar-file-drop" mkdir "test-artifacts\sidebar-file-drop"
node scripts\investigate-sidebar-file-drop.mjs > "test-artifacts\sidebar-file-drop\run.log" 2>&1
exit /b %errorlevel%
