# P0–P2 안정화 결과 (2026-08)

## 완료 범위

- P0: 기본 21명 manifest 단일화, 종료 모델 차단, 게이트웨이 토큰 서버 전용화, 독립 실행 서버와 설치본 데이터 경로 분리
- 1단계: Vitest 회귀 테스트, Windows CI, 런타임 smoke, 프로덕션 의존성 감사
- 2단계: 게이트웨이·사용량·작업 저장소 서버 모듈 분리, 일/주/전체 사용량 영속화, 중단 회의 감지와 동일 요청 재시작
- 3단계: OpenAI 호환 제공자 어댑터, 공식 Codex SDK 코딩 엔진, 모바일 인력 탭 연결, 3D 스튜디오 지연 로딩

## 운영 경계

- Claude Code는 저장소 총괄·승인자이고 앱 내부 PM은 OpenClaw를 유지한다.
- 코딩 패널 기본 엔진은 Codex SDK다. `workspace-write`, 네트워크 차단, 승인 없는 권한 확대 금지로 실행한다.
- Codex 인증이나 실행 환경이 준비되지 않은 PC에서는 코딩 패널의 실행 엔진을 `MCP 제공자`로 바꾼다.
- 게이트웨이 토큰은 브라우저 번들·환경 변수에 넣지 않는다. 서버 릴레이가 `operator.read` 범위로 필요한 이벤트만 전달한다.

## 확인 명령

```powershell
cd webapp
npm run check
npm audit --omit=dev
node scripts/prepare-desktop-runtime.mjs
```

## 남은 제한

- 설치본은 취약한 Chromium/`extract-zip` 경로를 없애기 위해 Marp CLI를 포함하지 않는다. HTML 덱은 Marp Core로 만들 수 있지만 PDF/PPTX 덱 렌더는 현재 개발 환경에서만 가능하다.
- 중단 회의는 마지막 완료 지점부터 이어 쓰는 방식이 아니라 동일 요청을 새 작업으로 다시 시작한다. 외부 모델 호출의 부작용을 정확히 재생하기 어려워 의도적으로 보수적인 복구를 택했다.
- Electron NSIS 설치 파일과 `win-unpacked` 실행 리소스를 실제 생성했고, 그 리소스 안의 서버/API smoke를 통과시켰다. 코드 서명 인증서는 아직 없으므로 설치 파일은 미서명이다.
- 3D 스튜디오 청크는 지연 로딩으로 초기 번들에서 분리됐지만 약 1.1MB다. 이후 Three.js 장면·에셋 단위 분할이 가능하다.
