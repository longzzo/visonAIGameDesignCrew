# Vision Engine 4.2.4 업그레이드 안내

기준일: 2026-09-28

## 적용된 업데이트

- Ollama 0.34.4 및 RTX 4060 Laptop 8GB용 `qwen3.5:4b`
- OpenClaw 2026.9.6, 상태 DB·31개 에이전트 DB·검색 플러그인 마이그레이션과 Windows Gateway 서비스 재등록
- OpenClaw 최신 `agents.entries` 설정과 구형 `agents.list` 동시 호환
- 준비 화면에서 Ollama/OpenClaw 버전, 에이전트 수, 설치 모델을 한 번에 진단
- 추천 모델 다운로드 및 Gateway 시작 버튼
- 구버전 Claude 가상화 경로와 표준 npm 전역 경로를 모두 찾는 CLI 탐색
- Electron 44.3.0, renderer sandbox·context isolation·IPC 송신자 검증·탐색/권한 차단
- Host/Origin 검증, CSP와 브라우저 보안 헤더, 프로덕션 의존성 취약점 0건
- RunAsNode 제거와 Utility Process 기반 내장 서버, 전체 Electron Fuse 강제
- 진단 로그 회전, 민감값 제외 지원 보고서, 트레이 진단 메뉴
- GitHub Releases 기반 자동 업데이트 확인·동의 다운로드·재시작 설치 기반
- EULA·개인정보·보안 정책·594개 패키지 오픈소스 고지와 출시 사전검사
- 화면별 지연 로딩으로 초기 JS 약 581KB → 약 460KB
- GitHub Models·NVIDIA·Brave 신규 키 보호 저장소 등록과 기존 평문 키의 명시적 SecretRef 이전
- 메인 창과 분리된 전용 로딩 창, AI 준비와 무관한 Studio 우선 실행
- 느린 OpenClaw 초기화를 위한 120초 준비 유예와 자동 재시작 6회 상한
- Ollama 사용자 컨텍스트 `32768` 적용으로 7K 이상 시스템 프롬프트를 쓰는 전문 에이전트의 4K 초과 오류 해소
- 서버 런타임이 실제 import하는 의존성만 포함해 설치 파일 12.1% 축소, 격리 설치 시간 393.36초 → 158.73초 단축

## 새로 사용할 수 있는 기능

- 로컬 추론: 민감한 기획 내용을 외부 모델 없이 처리
- 구조화 출력: JSON 스키마 기반으로 밸런스 표·작업 지시·검수 결과를 안정적으로 생성
- 도구 호출: 로컬 모델을 OpenClaw 작업자와 자동화에 연결
- 이미지 입력: UI 시안·스크린샷을 로컬 모델에 전달하는 확장 기반
- 하이브리드 라우팅: Claude는 총괄, Codex는 구현, OpenClaw는 팀 조율, Ollama는 오프라인 보조 작업자로 분리

## 권장 운영 구조

1. Claude: 프로젝트 목표, 기획 의도, 최종 승인
2. Codex: 코드 변경, 테스트, 빌드, 리뷰
3. OpenClaw: 전문 에이전트 라우팅과 반복 작업
4. Ollama `qwen3.5:4b`: 무료 로컬 초안, 분류, JSON 변환, 개인정보가 있는 보조 작업

## 다음 개편 우선순위

1. Gateway 이벤트 릴레이가 SecretRef를 직접 해석하게 바꾸고 OpenClaw 평문 감사 0건 달성
2. Codex App Server를 내장해 로그인·승인·진행 이벤트·작업 이력을 앱 안에서 표시
3. MCP Tasks 기반 장기 작업 재개 및 취소 UI
4. 대형 `vite.config.ts`를 프로젝트·AI·내보내기 API 모듈로 분리
5. 로컬/클라우드 모델 평가 세트와 자동 회귀 테스트 추가

## 정식 판매 전에 오너가 제공해야 하는 값

1. 고객 지원 이메일(`config/product.json`의 `supportEmail`)
2. 신뢰 가능한 Windows 코드서명 인증서와 CI 비밀값
3. 결제·환불·세금·지원 SLA 정책
4. 서명된 설치본, `.blockmap`, `latest.yml`을 GitHub Release에 함께 게시하고 이전 버전에서 업데이트 왕복 테스트

참고: [Ollama releases](https://github.com/ollama/ollama/releases), [OpenClaw releases](https://github.com/openclaw/openclaw/releases), [OpenAI Codex SDK](https://developers.openai.com/codex/sdk/)
