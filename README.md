# 🎮 Vision Engine

> 게임 아이디어 한 줄을 넣으면, **AI 에이전트들이 3D 사무실에서 직급에 따라 협업**해 게임 기획서(GDD)를 쓰고, 서로 검토·채점하고, 개발 착수 킷까지 뽑아주는 **1인 게임 개발 스튜디오**.

기획팀이 회의해서 세계관·게임플레이·시스템·밸런스·UI·수익모델·아트를 설계하고, 팀장이 취합해 대표에게 올리면, 개발팀이 이어받아 **유니티 개발 문서 + 밸런스 CSV + 에셋 목록 + C# 스켈레톤 + 플레이 가능한 프로토타입**을 ZIP 하나로 만들어 냅니다. 전부 **로컬 모델 + 무료 클라우드 크레딧으로 무료** 구동 가능하며, API 키는 저장소에 없고 여러분 PC(`~/.openclaw`)에만 저장됩니다.

> **처음이라면 → [GETTING-STARTED.md](GETTING-STARTED.md)** 에 15분 설치 walkthrough가 있습니다. 아래는 기능 요약과 빠른 설치입니다.

---

## ✨ 주요 기능

### 🏢 3D 디지털 사무실 (메인 화면)
- 부서별 존(기획·개발·사업·아트·품질·회의실·**휴게실**)으로 나뉜 아이소메트릭 오피스
- 에이전트가 실제로 걸어다니며 **회의실에 모이고, 대표실에 보고하고, 휴게실에서 잡담**합니다 (연출은 LLM 호출 0 = 무료)
- 직원 클릭 → 정보 팝업 → 1:1 채팅, 낮/밤 테마, 카메라 팬·회전·존 포커스

### 🧑‍💼 직급 조직 & 계층 오케스트레이션
- **5직급**: 👑 대표 · 🎖️ 팀장 · 시니어 · 🌱 주니어 · 🐣 인턴
- 업무가 **직급에 따라 흐릅니다**: 대표(PM)가 본부에 하달 → 팀장이 팀원에게 배분 → 주니어·인턴이 기여 → 시니어가 완성 → **팀장이 취합·검수** → 대표가 **마지막에** 통합·결재
- **직원 채용/퇴사**: 팀장·시니어·주니어·인턴을 골라 뽑으면 페르소나(AGENTS.md)가 생성되고 즉시 조직에 합류 (입사 축하 폭죽 연출)
- **소통 범위** 설정(전체/부서 내/커스텀/피드 위탁), **인력 배치**(회의 투입 선택)

### 🌱 자가 성장
- 작업(산출물·검토·협업·보고서)으로 **경험치·레벨**을 쌓고, QA 반려를 **교훈**으로 적립
- 레벨업 순간 스스로 **회고해 "작업 요령(스킬)"을 증류** → 이후 모든 작업에 자동 적용 (성장의 LLM 비용은 레벨업 1회뿐)

### 📝 마스터 GDD & 산출물
- 모든 에이전트가 공유하는 단일 진실의 GDD, 버전 히스토리·되돌리기
- **정식 보고서·회의록·협업 결론** 자동 저장, **결정사항 원장**(조직의 기억)
- **개발 착수 킷**: 유니티 문서 + 밸런스 CSV + 에셋 매니페스트 + C# 스켈레톤 + 그레이박스 프로토타입 → ZIP

### 🎨 아트·개발 인턴
- **아트 인턴**: 로컬 Stable Diffusion / NVIDIA로 컨셉 아트·사무실 배경 생성 (규제 소지 콘텐츠는 로컬 자동 라우팅)
- **개발 인턴(시뮬레이터)**: 기능별로 **플레이 가능한 HTML 프로토타입** 생성

### 📚 노션 연동 & 기존 기획 가져오기
- GDD·보고서를 **노션에 자동 발행**(허브 페이지 + 개요 표 + 섹션별 자식 페이지), 전담 **노션 아키비스트**
- 기존 기획 **PDF 가져오기**(스캔 PDF는 로컬 OCR), 옵시디안 볼트 연동·지식 학습

### 💰 비용·보안 가드
- **비용 폭탄 방지**: 10분당 LLM 호출 상한(클라이언트+서버 이중), 무한 반복 시 자동 차단·중단
- **사용량·크레딧 창**: 호출 수·토큰·추정 비용(모델별 단가)
- **보안**: DNS 리바인딩/CSRF 차단, 개발 작업 PC 전용, 에이전트 산출 HTML 격리(CSP)

### 🖥 어디서나
- **원클릭 데스크톱 앱**(설치 시 바탕화면 바로가기 자동 생성)
- LAN / Tailscale로 **폰·노트북에서 접속**, 사무실 관리인이 대화가 길어지면 자동 compact

---

## 🚀 설치

### 방법 A — 데스크톱 설치본 (가장 쉬움)
[**Releases**](https://github.com/longzzo/visonAIGameDesignCrew/releases)에서 최신 `VisionEngine-Setup-x.y.z.exe`를 받아 실행하면 설치 + **바탕화면 바로가기**가 생깁니다.
> 단, AI가 실제로 응답하려면 로컬에 **OpenClaw 게이트웨이 + Ollama**가 켜져 있어야 합니다(아래 방법 B의 준비물 참고).

### 방법 B — 소스에서 원클릭 실행 (권장)

**준비물**

| 항목 | 필수 | 비고 |
|---|:---:|---|
| Windows 10/11, [Node.js](https://nodejs.org) 20+ | ✅ | |
| [Ollama](https://ollama.com) + `qwen3:8b` | ✅ | 무료 로컬 모델 (VRAM 8GB 권장) |
| [Git](https://git-scm.com) | ✅ | |
| NVIDIA NIM 키 ([build.nvidia.com](https://build.nvidia.com)) | 선택 | 회의 품질·속도 향상 (무료 크레딧) |
| Stable Diffusion (Forge), Tailscale, Obsidian | 선택 | 아트 생성 / 원격 접속 / 노트 학습 |

**실행**

```bat
git clone https://github.com/longzzo/visonAIGameDesignCrew.git vision-engine
cd vision-engine
ollama pull qwen3:8b
VisionEngine-Start.bat
```

런처가 OpenClaw 게이트웨이와 웹앱을 함께 띄우고 브라우저를 엽니다. 다른 런처:
- `VisionEngine-Local.bat` — 이 PC 전용(가장 안전)
- `VisionEngine-Mobile.bat` — Tailscale로 폰·노트북에서 접속
- `VisionEngine-Desktop.bat` — Electron 데스크톱 셸

**직접 실행**(런처 없이):
```bat
cd webapp
npm install
npm run dev        # http://127.0.0.1:5199
```

> 자세한 단계별 안내(모델 키 등록, SD 연결, 원격 접속, 문제 해결)는 **[GETTING-STARTED.md](GETTING-STARTED.md)** 를 참고하세요.

---

## 🧱 기술 스택 & 구조

- **웹앱**: React 18 + Zustand + Vite (서버 로직은 `webapp/vite.config.ts`의 미들웨어 플러그인), 3D는 react-three-fiber + drei
- **AI 게이트웨이**: [OpenClaw](README.openclaw.md) — 각 에이전트가 독립 세션에서 실행, 모델은 Ollama(로컬) / NVIDIA NIM / GitHub Models 전환
- **데스크톱**: Electron + NSIS 설치본 (`desktop/`)
- **에이전트 페르소나**: `agents/<id>/AGENTS.md` (직급·역할·산출물 형식·규칙)

```
vision-engine/
├── webapp/            ← 메인 웹앱 (React + Vite, 서버 미들웨어 포함)
│   ├── src/           ← 컴포넌트·스토어(store.ts)·lib(agents/zones/growth/…)
│   └── server/        ← 이미지·노션·MCP·개발작업 서버 모듈
├── desktop/           ← Electron 데스크톱 셸 + 설치본 빌드
├── agents/*/AGENTS.md ← 에이전트 페르소나(인격)
├── docs/              ← ARCHITECTURE·WORKFLOW·HANDOFF(개발 인수인계)·SETUP
├── config/            ← 로컬 설정(커밋 제외: 토큰·성장·채용 데이터)
└── VisionEngine-*.bat ← 원클릭 런처
```

- 개발자용 상세 지도(기능 맵·함정·로드맵): **[docs/HANDOFF.md](docs/HANDOFF.md)**
- 최초 설계(Claude Code 서브에이전트 경로) 기록: **[README.openclaw.md](README.openclaw.md)**

---

## 📄 참고

개인 프로젝트입니다. API 키·토큰은 저장소에 포함되지 않으며 각자의 PC에만 저장됩니다. 로드맵은 [ROADMAP.md](ROADMAP.md), 개발 인수인계 문서는 [docs/HANDOFF.md](docs/HANDOFF.md)를 참고하세요.
