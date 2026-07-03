@echo off
rem Vision Engine launcher (PC-local only mode - binds 127.0.0.1, no remote access)
rem Use this only if you explicitly do NOT want other devices to reach the app.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-vision-engine.ps1"
pause
