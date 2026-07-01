# ARCHITECTURE.md — Vision Engine 시스템 아키텍처

## 1. 개요

Vision Engine은 **하나의 오케스트레이터 + 다수의 전문 서브에이전트** 구조다. 원래 제안서(Vision Engine PDF)의 "Main Brain + API 전문가 + 로컬 백업" 개념을 실제 구현 가능한 형태로 재설계했다.

원안과 달라진 점 (보완 사항):
- **메인 브레인을 실존 도구로 교체**: "Codex Pro"라는 가상 제품 대신, Claude Code(하네스) + Claude Fable 5(모델)를 오케스트레이터로 사용한다. Fable 5는 계획 수립, 서브에이전트 위임, 자체 검증에 특화되어 있어 원안의 "Main Brain" 역할에 그대로 부합한다.
- **11명 → 7개 역할로 압축**: 개인 운영 현실을 고려해 핵심 역할만 남기고, 필요 시 확장하는 구조로 바꿨다.
- **GDD를 물리적 파일로 고정**: 원안의 "Logic Control(GDD 대조)" 개념을 `templates/MASTER_GDD.md` 단일 파일로 구현해, 모든 에이전트가 참조하는 진실의 원천으로 삼는다.
- **폴백 체인 명시**: 무료 API 티어의 rate limit과 Fable 5 안전장치를 대비해 모델·API 폴백 순서를 설계에 포함했다.

## 2. 계층 구조

```
[오너 (사람)]
     │  자연어 요청
     ▼
[인터페이스 계층]  — Claude Code CLI / OpenClaw WebChat
     │
     ▼
[오케스트레이션 계층]  — PM 에이전트 (Claude Fable 5)
     │  TASK_BRIEF 양식으로 위임
     ├─────────────┬─────────────┬─────────────┐
     ▼             ▼             ▼             ▼
[실행 계층 — 서브에이전트들]
  Creative        Systemic       Balance        Business
  (시나리오        (메커니즘        (밸런싱)        (BM)
   게임플레이       규칙
   UI/UX)          전투)
     │             │             │             │
     └─────────────┴──────┬──────┴─────────────┘
                          ▼
[지식 계층]  — MASTER_GDD.md (모든 결과물의 대조 기준)
                          │
                          ▼
[모델·리소스 계층]
  주력: Claude Fable 5
  폴백: Claude Opus 4.8
  보조(선택): Gemini Flash / GitHub Models / NVIDIA API / 로컬 Ollama
```

## 3. 역할 매핑 (원안 → 구현)

| 원안 그룹 | 원안 에이전트 | 구현 역할 폴더 | 주 담당 |
|---|---|---|---|
| Management | PM (Orchestration) | `agents/pm` | 요청 분해, 위임, 취합, GDD 대조 |
| Creative | Scenario | `agents/scenario` | 로어, 세계관, 분기 서사 |
| Creative | Gameplay | `agents/gameplay` | 상호작용 로직, 플레이어 주도성 |
| Creative | UI/UX | `agents/uiux` | 사용자 여정, 화면 위계 |
| Systemic | Mechanics/Rules/Combat | `agents/systems` | 메커니즘, 규칙, 전투 설계 |
| Balance | Char Balancing/Tech Designer | `agents/balance` | 수치 밸런싱, 기술 설계 검증 |
| Business | BM Lead + BM Intern | `agents/bm` | 수익 모델 아이디어 + 검증 |

> 원안의 BM Lead(검증)와 BM Intern(발상)은 하나의 `bm` 에이전트 안에서 "발상 → 자기검증" 2단계 절차로 통합했다. 개인 운영에서 굳이 두 에이전트로 나눌 실익이 적기 때문이다. 규모가 커지면 분리할 수 있다.

## 4. 데이터·제어 흐름

### 제어 흐름 (요청이 처리되는 순서)
1. 오너 → PM: 자연어 요청
2. PM: 요청을 하위 작업으로 분해, 각 서브에이전트에 `TASK_BRIEF` 발행
3. 서브에이전트: 담당 파트 수행, GDD 참조
4. PM: 결과 취합 → GDD 대조 → 모순 점검
5. PM → 오너: 통합 결과물 + (필요 시) GDD 변경 제안

### 지식 흐름
- **읽기**: 모든 에이전트는 `MASTER_GDD.md`를 읽을 수 있다.
- **쓰기**: GDD 직접 수정은 PM(또는 오너 승인)만 한다. 서브에이전트는 "변경 제안"만 낸다. 이렇게 해야 여러 에이전트가 동시에 GDD를 건드려 충돌하는 일을 막는다.

## 5. 모델 전략 (Fable 5 실험 중심)

- **주력 모델**: `claude-fable-5` — 이 프로젝트의 목적은 신모델 성능 확인이므로 실행 작업 전부를 Fable가 맡는다.
- **자동 폴백**: Fable 5는 사이버보안·생물·화학 관련 요청을 안전장치로 차단하고 Opus 4.8로 넘긴다. 게임 기획 용도에서는 거의 발생하지 않지만, 설계상 폴백 경로를 열어둔다.
- **비용 인지**: Fable 5는 토큰당 단가가 높고 긴 작업에서 토큰을 많이 쓴다. 장기·복잡 작업에 집중하고, 단순 확인은 저렴한 모델로 돌리는 판단을 오너가 내릴 수 있다.
- **보조 무료 API (선택)**: 원안대로 Gemini Flash(시나리오 대량 생성), GitHub Models(코드 초안), NVIDIA API(자산 최적화)를 서브에이전트 보조 도구로 붙일 수 있으나, 무료 티어는 rate limit(분당 10~15회 수준)이 빡빡하므로 "메인은 Fable, 대량 반복 작업만 무료 티어" 원칙으로 사용한다.

## 6. 실행 환경 옵션

| 방식 | 인터페이스 | 적합한 경우 |
|---|---|---|
| **Claude Code 단독** | 터미널/데스크톱 | 코드·문서 산출이 중심일 때. 가장 단순 |
| **OpenClaw + WebChat** | 브라우저(localhost:18789) | 메신저 연동·상시 대기 에이전트가 필요할 때 |
| **OpenClaw 멀티에이전트** | WebChat + 게이트웨이 | 역할별로 완전히 격리된 워크스페이스가 필요할 때 |

개인 테스트 단계에서는 **Claude Code 단독**으로 시작해 각 역할을 서브에이전트로 다루고, 상시 운영이 필요해지면 OpenClaw로 이관하는 순서를 권장한다.

## 7. 보안·격리 고려사항 (OpenClaw 사용 시)

- BM 등 파일을 실행/삭제할 필요 없는 에이전트는 `tools.deny`로 `exec`·`write`를 막는다.
- 메인 PC와 분리된 워크스페이스에서 시작하고, 민감 디렉터리 접근은 단계적으로 연다.
- 각 에이전트는 독립된 `workspace`와 `agentDir`를 가진다(공유 시 세션·인증 충돌).
- 무료 API로 나가는 프롬프트에 독점 IP·개인정보를 넣지 않는다.

## 8. 확장 로드맵

1. **1단계 (지금)**: PM + Scenario 2개 에이전트로 최소 파이프라인 검증
2. **2단계**: Systems·Balance 추가 → 전투/밸런싱 루프 확인
3. **3단계**: UI/UX·BM 추가 → 전체 7역할 가동
4. **4단계**: 커스텀 웹 프론트엔드(PinchChat 등)로 각 에이전트 응답을 카드로 시각화
5. **5단계**: 보조 무료 API·로컬 Ollama 연결로 대량 반복 작업 오프로드
