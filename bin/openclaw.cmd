@echo off
setlocal
rem 표준 npm 전역 설치를 우선 사용하고, 예전 Claude 앱 가상화 설치도 호환한다.
set "VE_OPENCLAW_ENTRY=%APPDATA%\npm\node_modules\openclaw\dist\index.js"
if exist "%VE_OPENCLAW_ENTRY%" goto run
set "VE_OPENCLAW_ENTRY=%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\npm\node_modules\openclaw\dist\index.js"
if exist "%VE_OPENCLAW_ENTRY%" goto run
echo [Vision Engine] OpenClaw CLI를 찾지 못했습니다. npm install -g openclaw 를 실행하세요.
exit /b 1

:run
node "%VE_OPENCLAW_ENTRY%" %*
