# Vision Engine

> **🚀 처음 오셨나요? → [GETTING-STARTED.md](GETTING-STARTED.md)** — 웹앱(픽셀아트 사무실 + 에이전트 12명 + 개발 착수 킷) 설치·사용 가이드. 현재 이 프로젝트의 주력은 그 웹앱이며, 아래 내용은 초기 설계(Claude Code 서브에이전트 경로)의 기록입니다.

Claude Code 세션 하나로 **실제 병렬 서브에이전트**를 지휘해 어떤 장르의 게임이든 기획·설계할 수 있는 범용 멀티에이전트 스튜디오. 원래 제안서(Vision Engine PDF)의 구조를 **Claude Code의 실제 서브에이전트 기능**으로 구현했고, 주력 모델을 오늘 공개된 **Claude Fable 5**로 잡았다.

> **중요**: 이 저장소의 핵심 실행 파일은 `.claude/agents/*.md`다. Claude Code가 세션 시작 시 자동으로 읽어서 진짜로 병렬 실행되는 서브에이전트로 등록한다. `agents/*/AGENTS.md`(확장자 없는 `agents/` 폴더)는 그 설계 원본(장문판)이며 실행에는 관여하지 않는다 — 헷갈리지 않도록 아래 폴더 구조를 참고할 것.

## 무엇이 바뀌었나 (원안 대비 보완)

- **가상의 "Codex Pro" → 실존 도구로 교체**: Claude Code(하네스) + Claude Fable 5(모델)가 메인 세션(PM) 역할.
- **"AI 역할극"이 아니라 진짜 서브에이전트**: 처음 버전은 하나의 세션이 여러 역할을 순서대로 "연기"하는 지침 문서였다. 지금 버전은 `.claude/agents/*.md`로 Claude Code의 실제 서브에이전트 기능을 사용해, 각자 독립된 컨텍스트에서 병렬로 실행되고 결과만 메인 세션에 돌아온다.
- **쓰기 권한이 실제로 강제됨**: "서브에이전트는 GDD를 못 고친다"는 규칙이 말뿐이 아니라, `.claude/agents/*.md`의 `tools: Read, Grep, Glob` 설정으로 실제 도구 권한 수준에서 막혀 있다.
- **11명 → 8개 역할로 압축**: 개인 운영 현실에 맞게 핵심만.
- **GDD를 단일 파일로 고정**: 모든 서브에이전트가 참조하는 진실의 원천(`templates/MASTER_GDD.md`).
- **장르 무관 부트스트랩**: 게임 아이디어가 없어도 PM(메인 세션)이 `templates/PROJECT_INTAKE.md`로 단계별 질문을 던져 GDD를 채운다.
- **Visual 서브에이전트 신설**: 모티브 영상처럼 "여러 에이전트가 각자 파트를 맡아 하나의 결과물을 완성"하는 구조를 게임 기획에 맞게 반영.

## 폴더 구조

```
vision-engine/
├── README.md                  ← 이 파일
├── CLAUDE.md                  ← 메인 세션(PM) 역할 정의, 세션 시작 시 자동 로드
├── .claude/
│   └── agents/                ← ★ 실제 실행되는 서브에이전트 (Claude Code 자동 인식)
│       ├── scenario.md
│       ├── gameplay.md
│       ├── uiux.md
│       ├── systems.md
│       ├── balance.md
│       ├── bm.md
│       └── visual.md
├── docs/
│   ├── ARCHITECTURE.md        ← 시스템 아키텍처
│   ├── architecture.mmd       ← 아키텍처 다이어그램 (Mermaid)
│   ├── WORKFLOW.md            ← 요청 처리 흐름·시나리오
│   ├── SETUP.md              ← 설치·초기 설정 (경로 A: 실제 구현 / 경로 B: OpenClaw 별도 확장)
│   └── KICKOFF_PROMPT.md      ← Claude Code에 붙여넣어 바로 시작하는 프롬프트
├── agents/                    ← (참고용 원본 설계 문서 — 실제 실행 안 함)
│   └── */AGENTS.md
├── templates/
│   ├── PROJECT_INTAKE.md      ← 장르 무관 프로젝트 부트스트랩 질문지
│   ├── MASTER_GDD.md          ← 마스터 게임 디자인 문서 (진실의 원천)
│   └── TASK_BRIEF.md          ← 작업 지시 표준 양식
└── config/
    ├── openclaw.json          ← (선택, 별도 확장 경로) OpenClaw 상시운영 웹앱용 설계 초안
    └── .env.example
```

## 빠른 시작

1. `docs/SETUP.md`의 **경로 A**로 시작한다 (Claude Code 네이티브 서브에이전트 — 지금 실제로 작동하는 구현).
2. Claude Code 세션 모델을 `claude-fable-5`로 지정한다.
3. `docs/KICKOFF_PROMPT.md`의 "1) 최초 실행" 프롬프트를 붙여넣는다.
4. GDD가 비어 있으므로 자동으로 `templates/PROJECT_INTAKE.md` 질문이 시작된다. 답하면서 GDD가 채워진다.
5. 인테이크가 끝나면 메인 세션(PM)이 실제로 `Task` 도구를 통해 `.claude/agents/`의 서브에이전트를 병렬 호출한다.

## 핵심 원칙

- GDD가 최우선. 모든 산출물은 GDD와 대조·검증한다.
- 서브에이전트는 `Read/Grep/Glob`만 가지고 있어 GDD를 실제로 못 고친다 — 쓰기는 메인 세션(PM)만.
- 추측보다 확인. 모호하면 오너에게 되묻는다.
- 이 프로젝트의 목적은 Fable 5 성능 실험 — 서브에이전트들은 모델을 지정하지 않아 세션 모델을 그대로 상속받는다. 세션을 Fable 5로 실행하면 전부 Fable 5로 작동한다.

## 참고

- Fable 5는 2026-07-01부터 Claude Platform·Claude.ai·Claude Code·Claude Cowork에서 전 세계 사용 가능.
- 가격: 입력 $10 / 출력 $50 (백만 토큰당). Pro/Max는 7/7까지 주간 한도 50%까지 무료 포함, 이후 크레딧.
- 사이버·생물·화학 요청은 안전장치로 Opus 4.8에 폴백(게임 기획에선 거의 없음).
- `.claude/agents/*.md`는 세션 시작 시에만 로드된다. 수정 후에는 세션 재시작이 필요하다.
