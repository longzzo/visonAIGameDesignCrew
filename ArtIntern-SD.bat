@echo off
rem 아트 인턴용 로컬 Stable Diffusion(Forge) 실행 — 웹앱보다 먼저/나중 아무 때나 켜도 됨
rem 설치 위치: D:\AI\forge (--api 활성, 포트 7860)
if not exist "D:\AI\forge\start-forge-api.bat" (
  echo [!] D:\AI\forge 에 Forge가 없습니다. 웹앱 아트 스튜디오의 설치 안내를 참고하세요.
  pause
  exit /b 1
)
start "Forge SD (Art Intern)" /min cmd /c "call D:\AI\forge\start-forge-api.bat"
echo 아트 인턴(Stable Diffusion) 기동 중 — 1~2분 뒤 웹앱 아트 스튜디오에서 "연결됨"으로 표시됩니다.
timeout /t 5 >nul
