@echo off
rem Vision Engine Desktop (v2.0b) - native window shell
cd /d "%~dp0desktop"
if not exist node_modules (
  echo [1/2] first run: installing desktop shell...
  call npm install
)
echo [2/2] starting Vision Engine Desktop...
call npm start
