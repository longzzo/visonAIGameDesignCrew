@echo off
rem OpenClaw CLI 래퍼 — npm 전역 설치가 Claude 앱 가상화 폴더에 들어간 경우에도
rem 일반 터미널에서 openclaw 를 실행할 수 있게 해준다.
node "C:\Users\ba960\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\npm\node_modules\openclaw\dist\index.js" %*
