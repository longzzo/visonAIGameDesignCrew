@echo off
chcp 65001 >nul
title 🚀 Vision Engine — 시작 (모든 기기)
color 0B
echo.
echo   ─────────────────────────────────────────────
echo    🚀 Vision Engine 시작
echo    이 PC + 노트북 + 폰에서 같은 주소로 열립니다
echo    (Tailscale 없으면 자동으로 PC 전용 모드)
echo   ─────────────────────────────────────────────
echo.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-vision-engine.ps1" -Mobile
pause
