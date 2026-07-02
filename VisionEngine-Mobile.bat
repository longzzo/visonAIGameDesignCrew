@echo off
rem Vision Engine one-click launcher (Mobile mode - Tailscale binding)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-vision-engine.ps1" -Mobile
pause
