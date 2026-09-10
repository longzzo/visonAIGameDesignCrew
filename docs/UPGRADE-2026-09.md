# Vision Engine 3.6 업그레이드 안내

기준일: 2026-09-10

## 적용된 업데이트

- Ollama 0.33.3 및 RTX 4060 Laptop 8GB용 `qwen3.5:4b`
- OpenClaw 2026.9.3, 공식 Windows Gateway 서비스 재등록
- OpenClaw 최신 `agents.entries` 설정과 구형 `agents.list` 동시 호환
- 준비 화면에서 Ollama/OpenClaw 버전, 에이전트 수, 설치 모델을 한 번에 진단
- 추천 모델 다운로드 및 Gateway 시작 버튼
- 구버전 Claude 가상화 경로와 표준 npm 전역 경로를 모두 찾는 CLI 탐색

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

1. OpenClaw 평문 토큰을 SecretRef로 이전
2. Codex App Server를 내장해 로그인·승인·진행 이벤트·작업 이력을 앱 안에서 표시
3. MCP 2026-07-28 Tasks 기반 장기 작업 재개 및 취소 UI
4. 4,900줄 규모 `vite.config.ts`를 API 모듈별로 분리
5. 로컬/클라우드 모델 평가 세트와 회귀 테스트 추가

참고: [Ollama releases](https://github.com/ollama/ollama/releases), [OpenClaw releases](https://github.com/openclaw/openclaw/releases), [OpenAI Codex SDK](https://developers.openai.com/codex/sdk/)
