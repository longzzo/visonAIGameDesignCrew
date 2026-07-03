@echo off
rem (Legacy alias) Same as VisionEngine-Start.bat - tailnet binding is now the default.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-vision-engine.ps1" -Mobile
pause
