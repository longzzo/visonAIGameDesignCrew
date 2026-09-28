# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Vision Engine** — 게임 기획·개발 멀티에이전트 스튜디오. 두 가지 실행 모드가 공존한다:

1. **웹앱 (주력)** — `webapp/`의 React 앱. OpenClaw 게이트웨이에 붙은 21명 기본 에이전트(기획·지원 14 + 개발 7)가 픽셀아트/3D 사무실에서 GDD를 만들고 실제 코드를 다룬다. Electron 데스크톱 셸(`desktop/`)로도 포장됨.
2. **Claude Code 스튜디오 모드 (초기 설계, 여전히 동작)** — 이 저장소를 Claude Code로 열면 메인 세션이 PM이 되고 `.claude/agents/`의 7개 서브에이전트(scenario·gameplay·uiux·systems·balance·bm·visual)를 Task로 병렬 호출한다.

## 명령어

```bash
# 웹앱 개발 서버 (포트 5199; predev가 ~/.openclaw/openclaw.json에서 .env.local 자동 생성)
cd webapp && npm run dev
npm run dev:mobile        # LAN/Tailscale 노출 (0.0.0.0)
npm run build             # 프로덕션 빌드

# 타입체크 (테스트·린트 설정 없음 — 이것이 유일한 정적 검증)
cd webapp && npx tsc --noEmit -p tsconfig.json

# 데스크톱 셸
cd desktop && npm start                                    # Electron 실행
cd desktop && CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist  # NSIS 설치파일 → dist-installer/

# OpenClaw 게이트웨이 재시작 (에이전트 설정 변경 후)
curl -X POST http://127.0.0.1:5199/api/health -d '{"restart":"gateway"}'
```

원클릭 실행: 루트의 `VisionEngine-Start.bat`(서버) / `VisionEngine-Desktop.bat`(Electron).

## 웹앱 아키텍처 (큰 그림)

**별도 Python 백엔드는 없다.** `/api/*`는 `webapp/vite.config.ts`의 플러그인과 `webapp/server/` 모듈이 맡고, 개발 시 Vite·배포 시 `dist-server/runtime.mjs`가 같은 플러그인을 구동한다. 프로젝트/GDD/보고서/아트/킷은 `VE_DATA_ROOT/workspace/<프로젝트>/`에 저장한다(DB 없음). **주의: vite.config.ts를 수정하면 dev 서버가 재시작돼 진행 중인 에이전트 실행이 끊긴다** — 오케스트레이션 도중엔 편집 금지.

**상태는 zustand 단일 스토어** `webapp/src/store.ts`(~2400줄) — 연결·채팅·오케스트레이션 파이프라인(지시 분배→초안→교차검토→QA 게이트→GDD 반영)·회의 연출 상태(`agentStatus`/`livePeek`/`feed`/`meetingMembers`)가 모두 여기 있다. 2D(`OfficeView`)와 3D(`Office3D`) 사무실은 같은 스토어 상태를 다르게 그린 것. DEV 빌드에서만 `window.__VE = useVE`가 노출되어 브라우저에서 상태 주입 테스트가 가능하다.

**에이전트 정의는 두 곳이 짝을 이룬다:**
- `webapp/src/lib/agents.ts` — 로스터(AgentDef: GDD 섹션 소유권, `phase: plan|dev`, `staff`)와 **모든 프롬프트 빌더**. 개발팀 7명은 `staff:true, phase:"dev"`로 기획 팬아웃에서 제외된다.
- `~/.openclaw/openclaw.json` — 실제 게이트웨이(포트 18789) 에이전트. 기본 로스터 21명의 정본은 `config/agents.manifest.json`이며 채용 직원이 추가될 수 있다. **전원 write/edit/exec 도구가 deny**되어 있다 — 프롬프트의 "도구 호출 금지" 문구는 불충분하고 이 deny 목록이 진짜 강제 장치다. 배포용 키리스 템플릿은 `config/openclaw.json`(`{{API_KEY}}` 플레이스홀더).

**LLM 라우팅(오너 방침, docs/DESKTOP-PLAN.md):** 기본은 공식 CLI 구독 실행이다. Claude Code가 총괄·기획·검토를 맡고 Codex가 `workspace-write` 샌드박스에서 구현한다. Claude 미로그인/한도 시 Codex를 읽기 전용 총괄로 폴백한다. 구독 모드는 API 키·커스텀 엔드포인트·Bedrock/Vertex/Foundry 환경을 상속하지 않는다. OpenClaw+Ollama와 OpenAI 호환 제공자+MCP는 사용자가 선택하는 고급/로컬 경로로 유지한다. 총괄·코딩 경계의 정본은 `config/execution-policy.json`이다.

**MCP:** `webapp/server/mcp-hub.mjs`가 클라이언트 허브. `config/mcp.json`에 서버 목록 + **에이전트별 도구 배정**(assignments; 예: td→unity-ankle, 구현팀→unity-coplay, QA→unity-hunt). 유니티 프로젝트는 `config/unity.local.json`(gitignored)에 경로만 등록하면 `unity-project` 파일시스템 서버가 자동 합성돼 개발팀 8명에게 배정된다. 가이드: `docs/UNITY-REVIEW.md`.

**아트:** `webapp/server/image-provider.mjs` — 로컬 SD(webui `--api`)가 최우선, NVIDIA genai(`ai.api.nvidia.com/v1/genai/*` — LLM과 다른 엔드포인트)는 GPU 없는 과도기용. 규제 소지 키워드(유혈·무기 등 게임 아트 단골)는 자동으로 로컬로 라우팅하고, NVIDIA 정책 거부 시 로컬 폴백.

**데스크톱(`desktop/main.cjs`, Electron 33):** 개발 모드에선 설정된 원격 서버 → 로컬 재사용 → Vite 스폰 순으로 접속하고, 설치본은 번들된 `dist-server/runtime.mjs`를 자체 실행한다. 코드/기본 자산과 사용자 데이터(`app.getPath("userData")/vision-engine-data`)를 분리한다. 트레이 상주(닫기=숨김), `Ctrl+Shift+V`, 단일 인스턴스. 설치파일은 electron-builder NSIS다.

## 함정 (이 저장소에서 실제로 겪은 것)

- `.mjs` 서버 모듈을 vite.config.ts에서 import하려면 타입 심을 **`.d.mts`**로 만들어야 tsc가 찾는다.
- drei `<Html>` 래퍼가 자식 폭을 붕괴시킨다 — 3D 말풍선은 `max-width`가 아니라 **고정 width + `word-break: keep-all`**.
- three 생태계 버전 고정: React 18이므로 `three@0.169 / @react-three/fiber@8 / @react-three/drei@9`. 올리지 말 것.
- 백그라운드 탭에선 rAF가 멈춘다 — 프리뷰 검증 시 카메라 애니메이션·fps는 스크린샷으로 판정 불가, 상태는 DOM/eval로 확인.
- Windows에서 python으로 openclaw.json을 고칠 땐 경로에 **raw string(r'')** 필수(`\v`,`\a` 손상).
- 커밋 전 시크릿 스캔 습관: `git diff | grep -Ei 'nvapi-|ghp_'` — NVIDIA 키는 `~/.openclaw/openclaw.json`에만 있고 저장소엔 절대 없다.
- UI·주석·커밋 메시지는 한국어가 기본.

## Claude Code 스튜디오 모드 (이 저장소를 직접 열었을 때)

- 메인 세션 = PM. 서브에이전트는 `.claude/agents/*.md` 7개이며 **`Read/Grep/Glob`만 가진다** — GDD 쓰기는 항상 메인 세션 몫(도구 권한으로 강제됨).
- 진실의 원천은 오너가 `templates/MASTER_GDD.md`를 복사해 만드는 GDD 파일. 산출물이 GDD와 모순되면 임의 진행하지 말고 보고.
- GDD 핵심 항목이 비어 있으면 장르를 가정하지 말고 `templates/PROJECT_INTAKE.md` 절차로 2~3개씩 질문해 채운다.
- `.claude/agents/*.md`는 세션 시작 시에만 로드된다 — 수정하면 세션 재시작 필요.
- `agents/*/AGENTS.md`는 사람이 읽는 장문 설계 원본으로 실행에 관여하지 않는다 (OpenClaw 웹앱 페르소나의 원본이기도 함).

## 더 읽을 문서

- `docs/GETTING-STARTED.md` — 처음 쓰는 사람용 설치·사용 가이드 (키 없는 배포 절차 포함)
- `docs/DESKTOP-PLAN.md` — 아키텍처 결정 기록 + **오너 방침**(OpenClaw 유지, 로컬 최우선, 클라우드 과도기·스왑 가능)
- `ROADMAP.md` — 버전별 진행 현황 / `docs/UNITY-REVIEW.md` — 기존 유니티 프로젝트 리뷰 셋업
