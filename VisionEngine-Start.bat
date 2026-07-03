@echo off
rem Vision Engine one-click launcher
rem Default = Tailscale(tailnet) binding, so every device (this PC / laptop / phone)
rem opens the same URL. Falls back to PC-local mode automatically if Tailscale is absent.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-vision-engine.ps1" -Mobile
pause
