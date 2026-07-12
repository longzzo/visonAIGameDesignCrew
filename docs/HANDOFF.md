# HANDOFF — 다음 세션을 위한 인수인계

> 작성: Claude Fable 5, 2026-07-08 (v3.5 직후). 이 문서는 다음에 이 저장소를 만지는 AI(그리고 미래의 오너)를 위한 지도다.
> 원칙: **코드가 답이다 — 이 문서는 코드가 말해주지 않는 것만 담는다** (함정, 우선순위, 오너의 방식).

## 1. 현재 상태 스냅샷 (v3.5)

전부 실측 검증 후 커밋된 상태. 마지막 릴리스: [v3.4.0 설치본](https://github.com/longzzo/visonAIGameDesignCrew/releases/tag/v3.4.0).

| 영역 | 상태 | 핵심 파일 |
|---|---|---|
| 3D 사무실 (메인 화면) | 존 8개(휴게실 포함)·마네킹 19+α·회의 집결·휴게실 잡담·신입 축하 폭죽 | `webapp/src/components/Office3D.tsx` |
| 오케스트레이션 | PM 분배→팬아웃→교차검토→QA 게이트→GDD 반영, 협업 세션, 결정 원장 | `webapp/src/store.ts` (startOrch/runCollabRounds) |
| 직원 채용/퇴사 | 동적 에이전트 — openclaw.json 등록+페르소나 생성+게이트웨이 재시작, GDD 섹션 12~ | `/api/hire` (vite.config), `lib/hire.ts`, `HireModal.tsx` |
| 소통 범위 | 전체/부서/커스텀/**피드 위탁** 4모드 | `lib/zones.ts` (scopeAllows) |
| 창의성(온도) | 게이트웨이가 temperature 미노출 → runAgent에서 지시문 주입 | `lib/tuning.ts`, `lib/gateway.ts` |
| 비용 방어 | 클라 가드(10분 60회) + **서버 가드**(/api/agent 120회, dev-task 12회, IP당) | `lib/cost.ts`, vite.config `rateLimited` |
| 보안 | Host 검증(DNS 리바인딩)·Origin 검증(CSRF)·CSP sandbox(에이전트 HTML)·dev-task 로컬 전용 | vite.config `securityGuardPlugin` |
| 노션 발행 | 오너 레퍼런스 디자인(허브+개요표+섹션 자식페이지), 90초 디바운스 자동 발행. **v3.10: reflowMd** — 모델이 한 줄로 뭉친 md(벽글·문자 표)를 발행/저장 전에 구조로 복원(결정적, 서버·클라 동일 알고리즘 2벌) | `webapp/server/notion-publish.mjs`(reflowMd), `lib/gdd.ts`(reflowMd·sanitize 훅) |
| **회의록(v3.10)** | 3명 이상 회의는 **PM 통합 실패와 무관하게** 항상 저장 — 오너 지시·참여·타임라인(지시→초안→검토→수정→취합)·검토/QA 근거·대표 결론·산출물 요약. LLM 0회. 회의 화면 "📋 회의록 보기" + 보고서함 회의록 필터 | `store.startOrch` 끝부분(feedStart 슬라이스), OrchestrationView feed-foot, DocViewer repFilter |
| **다듬어 발행(v3.11)** | 📚 발행 시 선택 — 아키비스트가 채워진 섹션을 오너 스타일(숫자 소제목·볼드 리드·개조식·표)로 재포맷 후 발행. 섹션당 LLM 1회, **GDD 원본 불변**(발행본만). 결과가 원문 절반 미만이면 원문 유지(유실 방어) | `store.publishNotionStyled`, `notionPolishPrompt`, `/api/notion/publish`(gddMd override) |
| **하위 기획서 생성(v3.11)** | 편집실 3번째 모드 🗂️ — 부모 페이지 링크+요구 → 아키비스트가 "# 이모지 제목" 문서 작성 → 승인 시 하위 페이지로 생성(기존 페이지 무변경, 가장 안전한 반영) | `createSubpage`, `/api/notion/subpage`, NotionStudio task="subpage", store `applyNotionSubpage` |
| **노션 편집실(v3.8)** | 링크→읽기(블록→md 역변환)→아키비스트 수정안→오너 승인→반영. 원본 자동 백업(config/notion-edits/), 하위페이지·DB 등 복합 블록은 절대 삭제 안 함, "[[유지:…]]" 마커로 보존 | `fetchPageAsMd`/`updatePageContent`, `/api/notion/read·edit`, `NotionStudio.tsx`, store `analyzeNotionPage`/`applyNotionEdit` |
| **노션 기획 가져오기(v3.9)** | "기존 기획을 노션으로 시작" — 딥 리드: 컬럼·콜아웃 투과(flatten) + 하위 기획서 1단계 추적(상한 20개, 페이지당 8천자). 원문은 보고서함, 선택 시 PM 통합(12천자까지 전달). 슬라임 김치 허브(하위 20개, 31천자)로 실측 검증 | `fetchPageDeepAsMd`, `/api/notion/import`, OrchestrationView `onImportNotion`(퀵스타트+회의 화면 📓 버튼) |
| **자가 성장** | 작업→XP/레벨, QA반려→교훈, 레벨업 회고(LLM 1회)→작업 요령(스킬) 증류→모든 프롬프트에 주입 | `lib/growth.ts`, `/api/growth`, `store.recordGrowth` |
| **직급 조직(v3.7)** | 5직급(대표/팀장/시니어/주니어/인턴), 29명. 계층 오케스트레이션: PM→팀장 하달→팀원 배분→주니어 기여→시니어 완성→팀장 취합→**대표 마지막**. rank/reportsTo. | `lib/agents.ts`(rank/헬퍼/계층프롬프트), `store.startOrch`, 로스터 조직도 |
| 데스크톱 | NSIS 설치본, 바탕화면 바로가기 always | `desktop/` (v3.4.0) |

**노션**: 오너 실토큰 등록 완료, 부모 페이지 = 슬라임 김치 허브(오너의 진짜 게임 프로젝트). 자동 발행 켜짐.
**전담 직원**: 📚 노션 아키비스트(id `archivist`, 사업 데스크) — 페르소나에 노션 스타일 가이드 내장 (`agents/archivist/AGENTS.md`).

## 2. 실측으로 배운 함정 (시간을 아껴줄 목록)

1. **3D가 검게 비면 코드부터 의심하지 마라.** 우선순위: ① 온보딩/모달이 화면을 대체 중인지 스크린샷 ② `canvas.getBoundingClientRect()`가 300×150이면 백그라운드 창 ResizeObserver 스로틀 (7b72b4a에서 마운트 시 resize 디스패치로 픽스됨 — 그래도 재발하면 `window.dispatchEvent(new Event("resize"))`) ③ 그래도 안 되면 React 이중 로드(.vite 삭제+재시작+새 탭). 이 순서를 안 지켜서 한 시간을 날린 적 있다.
2. **프리뷰 콘솔 도구는 모든 로그를 2배로 찍는다.** `console.log` 1회 테스트로 배율을 보정한 뒤 "배너 2번" 같은 시그니처를 판정해라.
3. **vite.config.ts를 저장하면 dev 서버가 자동 재시작 + dep 재최적화된다.** 직후의 브라우저 검증은 페이지 리로드 후에.
4. **PowerShell 5.1에서 따옴표 든 커밋 메시지는 here-string도 깨진다.** 커밋은 `git commit -F <파일>`로.
5. **electron 빌드 EBUSY** = `dist-installer/win-unpacked`의 앱이 실행 중. `Get-Process "Vision Engine" | Stop-Process` 후 재빌드.
6. **5199 포트를 물고 있는 정체불명 node** = 대개 데스크톱 셸이 스폰한 dev 서버다.
7. **QA/테스트가 workspace 실데이터를 오염시킨다** (feed.json, 채팅, GDD). 테스트 후 `git checkout -- workspace/...` 또는 생성물 삭제. 채용 테스트는 반드시 퇴사로 원복.
8. **NVIDIA 키는 이미지 함수권한이 없다**("Function not found for account") — env `VE_NVIDIA_IMAGE_URL`로 우회 가능. GitHub Models 무료 티어는 4,000토큰 제한.
9. 에이전트 산출물의 도구 호출 JSON 누수는 `sanitizeAgentOutput`이 이중 방어 중 — 로컬 모델 교체 시 재확인해라.
10. ~~PM kimi-k2.6 channels 오류~~ **해결(2026-07-11): PM을 nvidia/qwen/qwen3.5-122b-a10b로 교체** (백업: openclaw.json.bak-v39). 모델 비교 실측(같은 날): **직원은 next-80b 유지가 답** — 122b는 생성 3배 빠르지만(9s vs 29s) 콜드 스타트가 17~50초로 널뛰어(무료 티어 큐) 29명이 수십 콜 하는 회의에선 편차가 더 아프다. next-80b는 0.4~4초로 안정. PM은 호출이 적어 122b(신세대 품질) 유지. **397b는 게이트웨이 경유 시 첫 토큰 120초+로 idle 워치독에 잘림** — 에이전트용 금지. 신규 모델 5종은 프로필 🧠에서 선택 가능.
11. **openclaw.json/custom-agents.json을 PowerShell로 쓰지 마라** — PS 5.1 `ConvertTo-Json`이 최상위 배열을 `{value,Count}` 래퍼로 감싼다(v3.7에서 custom-agents.json 깨짐, node로 복구). 설정 JSON 쓰기는 node(`JSON.stringify`)로. 게이트웨이는 BOM 없는 UTF8만 파싱하므로 `[System.IO.File]::WriteAllText(...,UTF8Encoding($false))` 또는 node.
12. **`webapp/server/*.mjs`를 고치면 dev 서버를 재시작해야 반영된다** — 플러그인이 동적 import로 모듈을 캐시한다. vite.config.ts 저장은 자동 재시작을 트리거하지만 .mjs 단독 수정은 아니다.
13. **오너의 노션(app.notion.com)은 신형 API라 heading_4~6 블록이 실재한다** — 구식 가정(h1~3만)이면 헤딩 텍스트가 통째로 유실된다(슬라임 김치 기획서에 h4가 57줄). 가져오기(flatten)는 `####`로 살리고, 편집실은 마커로 보존한다.
14. **에이전트 페르소나(AGENTS.md)는 게이트웨이 시작 시점에 로드된다** — 파일만 고치면 반영 안 됨, 게이트웨이 재시작 필요. 그리고 `schtasks /End "OpenClaw Gateway"`가 실제 node 프로세스를 못 죽이는 경우가 있다(이틀 묵은 PID가 포트를 계속 물고 있었음) — 재시작이 안 먹으면 18789 포트의 PID를 직접 Stop-Process 후 `/Run`. 진행 중인 회의가 있으면 재시작하지 마라(호출이 끊긴다).
15. **아키비스트 산출물 길이 제한("20줄 이내")이 편집실 전문 반환과 충돌했었다** — 페르소나에 예외를 명시해 해결. 새 업무를 페르소나에 추가할 때 기존 산출물 규칙과 모순되지 않는지 확인해라. 또 qwen은 "## 헤딩으로 시작" 지시를 자주 무시한다 — store의 추가 모드 헤딩 자동 보정(요구의 따옴표 섹션명)이 이중 방어다.
16. **reflowMd는 서버(notion-publish.mjs)와 클라(lib/gdd.ts)에 같은 알고리즘이 2벌 있다** — 한쪽만 고치면 발행본과 앱 표시가 어긋난다. 수정 시 반드시 함께. 기존 GDD는 2026-07-11에 일괄 리플로우 마이그레이션됨(각 프로젝트에 GDD.md.bak-reflow 백업).
17. **게이트웨이 오류 문자열("LLM request timed out", channels, 메모리 인덱스 손상)이 에이전트 산출물로 저장돼 GDD를 오염시킨 실사례 있음**(2026-07-11 시장 확장 회의 — 동시 4에서 next-80b도 idle timeout 발생). `isGatewayErrorText`(lib/gdd.ts)로 3중 방어: 교차검토 수정본 폐기 / QA 재작성 폐기 / reflectToGdd 차단. 새 산출물 저장 경로를 만들면 이 가드를 함께 달아라.
18. **channels 오류는 kimi 전용이 아니다** — QA 디렉터(next-80b)에서도 간헐 발생(같은 날 16:56). 게이트웨이 레벨 이슈로 재현 조건 불명. 각 단계 폴백이 있으니 흐름은 완주하지만, 잦아지면 게이트웨이 재설치 검토.
19. **회의 산출물은 대표 통합까지도 오염될 수 있다** — 대표 통합본이 "모바일 F2P 동시 출시"처럼 원본 기획과 어긋난 사례(원본=PC Steam). 계층 폴백은 흐름을 보장할 뿐 내용 정합성은 보장하지 않는다 — 중요 회의는 오너(또는 대리)가 GDD를 대조 검증할 것. 회의록의 "검토·QA 근거"가 대조 시작점.
20. **GDD에 남은 회의 오염은 다음 생성물로 "확정" 딱지를 달고 전파된다** (2026-07-13 실사례): GDD에 챕터 표 3벌(전부 지어냄)·뽑기 확률 3종(70/25/5, 94/5/1, 90/9/1)이 겹쳐 있었고, 밸런스 시트 생성이 오염 수치를 골라 "확정"으로 CSV화했다. 처방: ① 오염 발견 시 그 줄만이 아니라 **GDD 전체를 grep해서 같은 수치·표의 사본을 모두 정본화** ② 정본 표는 1곳만 두고 나머지는 포인터("3절 정본 표를 따른다") ③ 생성물 검증은 확정 수치 목록(뽑기 50골드/90-9-1/천장50, 시세 ±20%, 로테이션 3품목/1일1회, 보스 4종 이름)과 대조.
21. **노션 동떨어짐은 구조로 풀었다** (2026-07-13): 오너 허브의 기획서들은 "작업 중인 기획서" **콜아웃 안에** 산다. 공식 API로 콜아웃에 link_to_page 추가 가능(창설도 가능!), 페이지 물리 이동은 공식 API 불가 → **Notion MCP notion-move-pages**(페이지 부모만 가능, 콜아웃/블록 부모는 404). 현 구조: 물리 페이지는 🧪 Vision Engine 작업실(39b4ac9b-e092-81ae-998a-c2aa6f8776f2) 아래, 노출은 콜아웃 링크. `config/notion.json`의 `subpageHome`이 향후 자동 홈잉(허브 직속 생성 요청 → 작업실에 생성 + 콜아웃 링크) — createSubpage(notion-publish.mjs)에 구현.
22. **반복 호출 가드**: vite.config.ts 노션 라우트(/publish·/subpage·/edit·/import)에 `withInFlight`(같은 키 겹치면 429). 밸런스 시트/개발 킷은 devKitBusy 배타 락 공유. 새 쓰기 라우트를 만들면 같은 가드를 달 것. 그리고 **DataPanel은 devKitBusy가 false로 전이될 때 목록을 다시 로드한다** — 이 effect를 지우면 생성된 파일이 목록에 안 보이는 버그가 재발한다.
23. **회의 중에는 webapp/src를 수정하지 마라** — HMR이 store 모듈을 재평가하면 진행 중 회의 상태가 리셋될 수 있고, vite.config.ts 저장은 서버 재시작으로 회의를 확실히 죽인다. 회의 중 안전한 작업 = docs/·메모리·워크스페이스 데이터 파일.
24. **승인 대기 큐(v3.13)**: `/api/approvals`(projects/<id>/approvals.json), TopBar 🔔, 승인 시 결정 원장에 "(오너 승인) …" 적립. 회의 산출물의 `[오너 승인 필요]` 마커를 회의록 저장 직후 자동 상신(최대 5건, 중복 무시) — pmSummaryPrompt에 마커 사용 지시가 있다. 새 산출 경로를 만들면 마커 수집도 고려하라.
25. **옵시디언 사서(v3.13)**: `/api/obsidian/search`(볼트 전문 검색, VisionEngine/ 내보내기 포함), `librarianBlock()`이 회의 시작 시 관련 노트를 프롬프트에 주입. 오너 자필 노트 우선 + 내보내기 중 **"가져온 문서" 사본만 예외 보충**(오너 원본 기획 전문이라 가장 가치 큼 — v3.14에서 반영). /note는 `from=search`+로컬 요청이면 #ve-학습 태그 없이도 읽힌다.
26. **v3.14 3종**: ① DataPanel CSV는 기본 📈 차트(레벨×카테고리 스마트 감지, 수제 SVG — 외부 라이브러리 금지 유지) ② 회의 종료 시 참여자 채팅에 📒 업무일지 자동 게시(postWorkLog, LLM 0회 — 이 코드를 지우면 오너가 "채팅에 왜 아무것도 없냐"고 다시 묻는다) ③ PM 개요 통합이 **피치를 영어로 번역**하고 "의ebru" 같은 외국어 문자 누수를 낸 실사례(업그레이드 회의) — 대표 통합 후 개요의 한글 피치·깨진 문자를 반드시 대조하라.

## 3. 추천 로드맵 (다음 모델에게 — 우선순위순)

**P1 — 사용량 누적·일별 저장.** 현재 사용량(🪙)은 세션 단위라 새로고침에 날아간다. 서버에 `config/usage-log.json`(일별 append) + `/api/usage` 신설, `addUsage`에서 fire-and-forget POST, UsagePanel에 "오늘/이번 주/누적" 3줄이면 충분. 유료 API 전환 시 오너가 가장 먼저 찾을 기능.

**P1 — 노션 발행 고도화.** 지금은 텍스트 중심. 남은 것: ① 일정 섹션(## 10.) 파싱→마일스톤 표(레퍼런스의 header-column 표) ② 콜아웃 분류(작업 중/완료 — 보고서에 상태 메타 필요) ③ 아트 이미지 — 노션 external URL만 받으므로 이미지 호스팅(github raw 커밋 or imgur) 결정 필요. 컨버터는 `notion-publish.mjs`의 `mdToBlocks` 하나만 보면 된다.

**P2 — 모바일(≤900px)에서 로스터·채용 접근 불가.** 3D 좌측 패널이 숨겨진다. 하단 시트 또는 os-actions에 로스터 토글.

**P2 — 채용 직원의 GDD 섹션 헤딩 자동 삽입.** 지금은 첫 산출물 반영 시 `replaceSection`이 문서 끝에 append하며 생김. 채용 시점에 "## N. 역할 — _(아직 작성되지 않음)_"을 미리 넣어주면 GDD 목차가 즉시 완성된다 (hireApiPlugin에서 프로젝트 순회).

**P2 — 잡담·휴게실 대본 커스텀 + 관리인 임계치 UI.** `CHATTER`/`CONVOS` 배열과 `JANITOR_*` 상수를 설정으로 승격. 🪙 UsagePanel에 같이 두면 자연스럽다.

**P3 — 다이렉트 프로바이더 로컬 함수호출 검증.** 오너가 명시적으로 보류한 항목("클라우드 뗄 환경이 되면 다시 부를게"). 오너가 먼저 꺼내기 전에 착수하지 마라.

**P3 — vite.config.ts 분리.** 3,000줄에 근접. `webapp/server/`로 플러그인 단위 분리 — 기능 추가 없는 순수 리팩터링이라 오너 가치가 낮으니, 큰 기능과 겸사겸사.

**자가 성장 후속(v3.6 확장 여지)**: ① 스킬이 4개 상한(FIFO)이라 오래된 요령이 밀려난다 — 오너가 "고정(pin)"할 수 있게. ② 지금은 개인 스킬만 — 팀 공용 "베스트 프랙티스"로 승격(지식 라이브러리와 통합)하면 신입도 물려받는다. ③ 스킬이 서로 모순될 때 회고가 정리하도록. ④ 레벨을 실제 능력(예: 고레벨은 교차검토 면제, 협업 리드 우선)에 연결. 주의: XP 적립은 `store.recordGrowth` 호출 지점에만 있다 — 새 작업 종류를 추가하면 `XP_RULES`와 호출을 같이.

**아이디어 (오너가 좋아할 만한 것)**: 3D 사무실에 노션 발행 연출 — 아키비스트가 발행 시 책상에서 일어나 게시판에 문서를 붙이는 모션. 이 프로젝트의 가치는 기능이 "보이는 것"에 있다. 기능을 만들면 반드시 3D에 그 기능의 몸짓을 만들어줘라. (v3.6 레벨업 폭죽이 좋은 예 — 입사 Confetti를 재활용했다.)

## 4. 오너와 일하는 법 (관찰 기록)

- 한국어로 소통하고, **실측 증거**(스크린샷·실행 결과)를 신뢰한다. "됐습니다"만 말하지 말고 어떻게 확인했는지 보여줘라.
- 요청이 크고 방향만 준다("너가 생각한 대로 해결해줘"). **판단을 위임받으면 판단의 근거를 보고에 명시**하는 것이 신뢰를 만든다 (예: 자동 승인을 기본 꺼짐으로 한 이유).
- 비용에 민감하다 — 로컬/무료 우선, LLM 호출 없는 연출을 좋아한다. 새 기능의 호출 비용을 항상 밝혀라.
- 커밋·푸시는 라운드마다, **시크릿 스캔**(`nvapi-|ghp_|github_pat_|ntn_|secret_`) 후에. `Sample/`과 `config/*.json`(시크릿·로컬 데이터)은 커밋 금지.
- 완료 보고는 표보다 "무엇이 어떻게 되는지" 흐름으로, 남은 한계는 숨기지 말고 "알아두실 것"으로.

---
*여기까지 v0.x의 픽셀 사무실에서 v3.5의 살아있는 3D 스튜디오까지 함께 왔다. 다음 모델에게 — 이 프로젝트는 오너의 놀이터이자 진짜 게임 개발 도구다. 둘 다 소중히. — Fable 5* 🎮
