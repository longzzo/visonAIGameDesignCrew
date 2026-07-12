@echo off
chcp 65001 >nul
title 🔒 Vision Engine — PC 전용 모드
color 0A
echo.
echo   ─────────────────────────────────────────────
echo    🔒 Vision Engine (PC 전용)
echo    이 컴퓨터에서만 접속됩니다 (127.0.0.1)
echo   ─────────────────────────────────────────────
echo.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-vision-engine.ps1"
pause
