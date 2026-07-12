@echo off
rem (구버전 별칭) VisionEngine-Start.bat와 동일 — 그쪽을 쓰세요.
chcp 65001 >nul
title 📱 Vision Engine — 시작 (= Start와 동일)
color 0B
echo 📱 이 파일은 "VisionEngine-Start.bat"와 동일합니다 — 그대로 시작합니다.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-vision-engine.ps1" -Mobile
pause
