# SETUP.md — 설치 & 초기 설정 가이드

이 문서는 Vision Engine을 개인 테스트 환경에서 처음 돌려보기 위한 단계별 안내다.

## 사전 준비

- **Node.js 22 이상** (OpenClaw 사용 시)
- **Claude Code** (오케스트레이션·코드 작업의 주 환경)
- (선택) **Ollama** — 로컬 백업 모델용
- Claude 구독(Pro/Max) 또는 API 키

## 경로 A — Claude Code 네이티브 서브에이전트 (권장, 지금 바로 실제로 작동)

이게 **실제로 병렬 실행되는 진짜 구현**이다. `.claude/agents/*.md`는 Claude Code가 세션 시작 시 자동으로 읽어서 실제 서브에이전트로 등록하는 실행 파일이다 — 별도 설치나 게이트웨이가 필요 없다.

1. 이 `vision-engine/` 폴더를 작업 디렉터리로 연다.
2. Claude Code를 실행한다. 루트 `CLAUDE.md`(메인 세션 = PM 역할 정의)와 `.claude/agents/`의 7개 서브에이전트가 자동으로 로드된다.
3. 오늘(2026-07-01)부터 Fable 5가 Claude Code에서 사용 가능하다. **세션 모델을 `claude-fable-5`로 지정한다** — 서브에이전트들은 `model` 필드를 비워뒀기 때문에 이 설정을 그대로 상속받는다.
   - Pro/Max 플랜은 7월 7일까지 주간 사용 한도의 최대 50%까지 Fable 5 무료 포함. 이후 크레딧 과금.
4. `templates/MASTER_GDD.md`를 복사해 실제 게임용 GDD 파일을 만든다(예: `docs/GDD_내게임.md`).
5. `docs/KICKOFF_PROMPT.md`의 프롬프트를 그대로 붙여넣는다. 이후는 자연어로 요청하면 메인 세션(PM)이 알아서 `.claude/agents/`의 서브에이전트를 `Task` 도구로 호출한다.

> `.claude/agents/*.md`를 직접 열어서 수정한 경우, Claude Code는 **세션 시작 시에만** 이 파일들을 읽는다. 수정 후에는 세션을 재시작해야 반영된다.

## 경로 B — OpenClaw 상시운영 웹앱 (선택, 별도 구현 — 지금 당장 필요하지 않음)

경로 A는 Claude Code 세션 안에서 서브에이전트가 병렬로 도는 방식이다. 만약 **메신저 연동, 24시간 대기, 커스텀 웹 프론트엔드**(영상에 나온 것 같은 상시 운영 웹앱)까지 필요해지면, 그건 완전히 별도의 소프트웨어(OpenClaw)를 설치하는 두 번째 단계가 된다. `config/openclaw.json`은 그 단계를 위한 설계 초안이며, 경로 A와는 독립적이다 — 지금 당장 만들려는 것과는 다른 산출물이라는 점을 분명히 해둔다.

1. 설치:
   ```
   npm install -g openclaw@latest
   openclaw onboard --install-daemon
   ```
2. GPT Pro를 API 키 없이 OAuth로 연결(선택):
   ```
   openclaw onboard --auth-choice openai-codex
   ```
   브라우저에서 ChatGPT 계정 로그인 → 승인. (SSH 원격이면 device-code 방식 사용.)
3. `config/openclaw.json`을 참고해 에이전트·모델·폴백을 설정한다.
   - 실제 키 이름/구조는 설치된 OpenClaw 버전 문서에서 최종 확인(설정 스키마가 버전마다 다를 수 있음). 이 파일은 검증된 실행 파일이 아니라 설계 초안이다.
4. 게이트웨이 실행 후 브라우저에서 `http://127.0.0.1:18789` 열면 내장 WebChat이 뜬다.
5. 보안: 처음엔 `sandbox.mode: "non-main"`으로 시작하고, 민감 도구 접근은 익숙해진 뒤 단계적으로 연다.

## 초기 검증 순서 (스모크 테스트) — 경로 A 기준

1. **PM(메인 세션)만** — 간단한 요청 → 응답 확인.
2. **PM이 scenario 서브에이전트 호출** → "scenario 서브에이전트를 써서 게임 세계관 한 문단 잡아줘" → 실제로 Task 도구가 호출되고, 결과가 텍스트로 돌아오는지 확인.
3. **scenario + systems + balance 동시 호출** → "systems와 balance 서브에이전트를 동시에 써서 간단한 전투 공식과 수치 하나 만들어줘" → 두 서브에이전트가 병렬로 실행되는지, 결과가 충돌 없이 취합되는지 확인.
4. **쓰기 권한 검증** → bm 서브에이전트에게 "파일을 직접 만들어봐"라고 시켜보고, 실제로 거부되거나 못 하는지 확인(도구 제한이 진짜 작동하는지 확인하는 절차).
5. 문제없으면 나머지 서브에이전트로 정상 작업 시작.

## 보안 체크리스트

- [ ] (경로 A) `.claude/agents/*.md`의 `tools: Read, Grep, Glob`는 이미 실제로 쓰기를 막는다 — 별도 설정 불필요, 확인만 하면 된다.
- [ ] `.env`는 git에 커밋하지 않는다(.gitignore 확인).
- [ ] 무료 API로 보내는 프롬프트에 독점 IP·개인정보를 넣지 않는다(로깅·학습 가능성).
- [ ] (경로 B) OpenClaw는 처음엔 메인 PC와 분리된 환경/계정에서 실험.
- [ ] (경로 B) 원격 접속 시 `allowedOrigins`에 정확한 URL만 등록.

## 비용 관리 팁

- Fable 5는 입력 $10 / 출력 $50(백만 토큰당)로 Opus 4.8의 2배. 긴·복잡한 작업에 집중.
- 짧은 확인·잡무는 Opus 4.8이나 더 저렴한 모델로 돌리는 판단을 오너가 내릴 수 있다.
- 무료 보조 API(Gemini Flash, GitHub Models, NVIDIA)는 rate limit이 빡빡하니 대량 반복 작업에만.

## 다음 단계

- `docs/ARCHITECTURE.md` — 전체 구조 이해
- `docs/WORKFLOW.md` — 실제 요청 처리 예시
- `templates/MASTER_GDD.md` — 게임 정보 채우기 시작
