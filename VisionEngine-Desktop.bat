@echo off
chcp 65001 >nul
title 🖥️ Vision Engine — 데스크톱 앱
color 0D
echo.
echo   ─────────────────────────────────────────────
echo    🖥️ Vision Engine 데스크톱 (전용 창)
echo   ─────────────────────────────────────────────
echo.
cd /d "%~dp0desktop"
if not exist node_modules (
  echo [1/2] 첫 실행: 데스크톱 셸 설치 중...
  call npm install
)
echo [2/2] Vision Engine 데스크톱 시작...
call npm start
