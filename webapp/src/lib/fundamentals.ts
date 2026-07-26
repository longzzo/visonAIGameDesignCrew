// 🩺 게임 기초 구성요소 — "없는 것"을 찾기 위한 정본 체크리스트.
//
// 왜 필요한가(실사고, 냥빙고 GDD가 스스로 증언):
//  · v31(7/23) "HP 회복 부재(사망 리스폰이 유일) 확인" — 서바이벌 게임에 회복 수단이 없었다
//  · 8-7 사운드 헤더 "팀 내 사운드 담당 0" — 아무의 일도 아니라 7/15에야 아트 하위로 편입
//  · 9-0 해상도 정본 "정본에 없던 값이었다" — 아트가 질문해서 7/16 발견
//  · 접근성 — 오늘까지 0회
// 공통점: 전부 **오너가 눈치챌 때까지** 아무도 안 짚었다. 11개 절 담당자는 각자 자기 절을 잘 쓰고,
// QA는 "쓴 것"의 품질을 채점한다. "없는 것"은 눈에 안 띄어서 아무도 안 본다 — 그 구멍을 메운다.
//
// 3층 구조: 성립층(없으면 게임이 아님) → 체험층(없으면 재미가 전달 안 됨) → 완성층(없으면 미완성)

export type FundLayer = "성립" | "체험" | "완성";

export interface FundItem {
  id: string;
  /** 점검 항목 이름 */
  label: string;
  layer: FundLayer;
  /** 이게 없으면 무슨 일이 벌어지는가 — 프롬프트에 그대로 실려 판단 기준이 된다 */
  why: string;
  /** 담당 에이전트 id — 결손 시 "누구에게 지시할지"를 바로 안내한다 */
  owner: string;
  /** 사전 스캔용 동의어 (LLM 판단 전 힌트로만 쓴다 — 이것만으로 판정하지 않는다) */
  kw: string[];
}

export const FUNDAMENTALS: FundItem[] = [
  // ── 성립층 — 하나라도 없으면 "게임"이 성립하지 않는다 ──
  { id: "loop", label: "핵심 루프(동사)", layer: "성립", owner: "gameplay",
    why: "플레이어가 반복해서 하는 행동이 무엇인지. 콘텐츠 목록이 아니라 '동사'가 없으면 게임이 아니다.",
    kw: ["코어 루프", "핵심 루프", "루프", "반복"] },
  { id: "winlose", label: "승리·패배 조건", layer: "성립", owner: "gameplay",
    why: "무엇을 하면 이기고 무엇을 하면 지는가. 목표가 없으면 플레이가 방향을 잃는다.",
    kw: ["승리", "패배", "엔딩", "클리어", "게임오버", "최종 목표"] },
  { id: "fail", label: "실패 처리·회복", layer: "성립", owner: "systems",
    why: "죽거나 실패했을 때 무엇이 일어나고 어떻게 복귀하는가. **회복 수단(HP·자원)이 존재하는지 반드시 확인** — 냥빙고는 'HP 회복 부재'를 개발 중반에야 발견했다.",
    kw: ["사망", "죽음", "리스폰", "패배", "회복", "치료", "부활"] },
  { id: "save", label: "진행 저장·이어하기", layer: "성립", owner: "td",
    why: "세션을 끊고 다시 왔을 때 진행이 남아 있는가. 없으면 장기 플레이가 불가능하다.",
    kw: ["세이브", "저장", "이어하기", "오토세이브", "진행 저장"] },
  { id: "input", label: "조작·입력 정의", layer: "성립", owner: "uiux",
    why: "어떤 키/터치로 무엇을 하는가가 표로 확정돼 있는가. 구현자가 추측하면 조작이 게임마다 달라진다.",
    kw: ["조작", "입력", "키 바인딩", "키맵", "컨트롤러", "터치"] },

  // ── 체험층 — 있어도 '재미가 전달되지 않는' 구멍 ──
  { id: "fun", label: "재미의 정체(어디에 있나)", layer: "체험", owner: "gameplay",
    why: "이 게임의 재미가 무엇이며 어느 순간에 발생하는지 명시됐는가. 30초(손맛)·30분(세션 목표)·30시간(메타 성장) 3계층이 각각 설명돼야 한다.",
    kw: ["재미", "손맛", "쾌감", "몰입", "동기"] },
  { id: "juice", label: "게임필·피드백(주스)", layer: "체험", owner: "gameplay",
    why: "때리고 줍고 부술 때 화면이 어떻게 반응하는가(히트스톱·흔들림·파티클). 같은 메커닉도 이게 없으면 밋밋하다.",
    kw: ["주스", "타격감", "조작감", "히트스톱", "화면 흔들", "이펙트", "피드백"] },
  { id: "audio", label: "사운드(BGM·SFX)", layer: "체험", owner: "sound",
    why: "BGM·효과음·앰비언트가 설계됐는가. 무텍스트 게임에서는 오디오가 곧 HUD다. **담당자가 없으면 통째로 빠진다.**",
    kw: ["사운드", "BGM", "SFX", "효과음", "오디오", "앰비언트", "음악"] },
  { id: "onboard", label: "첫 5분·온보딩", layer: "체험", owner: "uiux",
    why: "처음 켠 플레이어가 무엇을 배우고 언제 '아 이거구나'를 느끼는가. 심사·시연에서 첫인상을 좌우한다.",
    kw: ["튜토리얼", "온보딩", "첫 플레이", "첫 5분", "학습", "가이드"] },
  { id: "curve", label: "난이도 곡선·페이싱", layer: "체험", owner: "balance",
    why: "쉬움→어려움이 어떤 리듬으로 오르는가. 곡선이 없으면 초반 이탈이나 후반 지루함이 생긴다.",
    kw: ["난이도", "곡선", "페이싱", "완급"] },
  { id: "reward", label: "보상 리듬", layer: "체험", owner: "systems",
    why: "얼마나 자주 무엇을 얻는가. 보상 간격이 설계되지 않으면 성장이 체감되지 않는다.",
    kw: ["보상", "드랍", "해금", "성취", "획득"] },

  // ── 완성층 — 없으면 "미완성 빌드"로 보인다 ──
  { id: "settings", label: "설정·옵션 메뉴", layer: "완성", owner: "uiux",
    why: "볼륨·화면·조작을 플레이어가 바꿀 수 있는가. 심사자가 가장 먼저 여는 화면 중 하나다.",
    kw: ["설정", "옵션", "볼륨", "전체화면", "환경설정"] },
  { id: "a11y", label: "접근성", layer: "완성", owner: "uiux",
    why: "색맹 대응·텍스트 크기·깜빡임 저감·조작 대안이 있는가. 색으로만 정보를 전달하면 일부 플레이어는 플레이 자체가 불가능하다.",
    kw: ["접근성", "색맹", "색약", "자막", "텍스트 크기", "깜빡임", "reduced motion"] },
  { id: "perf", label: "성능 예산", layer: "완성", owner: "td",
    why: "목표 프레임·해상도에서 돌아가는가, 예산이 숫자로 정해졌는가. 시연 중 버벅이면 그것으로 평가가 끝난다.",
    kw: ["성능", "프레임", "FPS", "최적화", "드로우콜", "예산"] },
  { id: "platform", label: "플랫폼·해상도 정본", layer: "완성", owner: "td",
    why: "어느 플랫폼, 어떤 해상도·화면비로 만드는가가 한 곳에 확정돼 있는가. 냥빙고는 이 값이 '정본에 없던 값'이었다.",
    kw: ["플랫폼", "해상도", "화면비", "빌드", "캔버스"] },
  { id: "build", label: "빌드·시연 경로", layer: "완성", owner: "scheduler",
    why: "실제로 실행 가능한 빌드를 언제 어떻게 뽑고 시연하는가. 문서만 완벽하고 빌드가 없으면 제출물이 없다.",
    kw: ["빌드", "시연", "데모", "제출", "패키징"] },
];

export const LAYER_ORDER: FundLayer[] = ["성립", "체험", "완성"];

/** LLM 판단 전 사전 스캔 — 힌트로만 쓴다(키워드만으로 판정하면 오판한다: 함정 56·61의 교훈) */
export function prescan(gdd: string): Record<string, number> {
  const low = gdd.toLowerCase();
  const out: Record<string, number> = {};
  for (const it of FUNDAMENTALS) {
    out[it.id] = it.kw.reduce((n, k) => n + (low.split(k.toLowerCase()).length - 1), 0);
  }
  return out;
}

export interface FundFinding {
  id: string;
  verdict: "없음" | "약함" | "있음";
  evidence: string;
  action: string;
}

/** 기초 점검관 프롬프트 — GDD 전문을 읽고 체크리스트별로 판정한다. */
export function fundamentalsPrompt(projectName: string, gdd: string, hints: Record<string, number>): string {
  const list = LAYER_ORDER.map((layer) => {
    const items = FUNDAMENTALS.filter((f) => f.layer === layer)
      .map((f) => `  - [${f.id}] ${f.label} — ${f.why} (참고: 관련어 ${hints[f.id] ?? 0}회 등장)`)
      .join("\n");
    return `[${layer}층]\n${items}`;
  }).join("\n\n");

  return `너는 게임 스튜디오의 **기초 점검관**이다. 네 임무는 기획서에 **쓰여 있는 것을 평가하는 게 아니라, 없는 것을 찾는 것**이다.

이 스튜디오는 담당자마다 자기 절을 잘 쓰지만, "아무의 일도 아닌 기초"가 통째로 빠지는 사고를 반복했다.
실제 사례: 서바이벌 게임인데 HP 회복 수단이 없었다(개발 중반 발견) · 사운드 담당이 0명이라 사운드가 없었다 · 해상도 정본이 없었다 · 접근성은 지금도 없다.

## 점검 대상 기획서: ${projectName}
${gdd.slice(0, 24000)}

## 체크리스트 (이 항목만 판정한다)
${list}

## 판정 규칙
- **없음**: 기획서에 그 내용이 실질적으로 존재하지 않는다. 단어만 스쳐 지나가는 것은 "없음"이다.
- **약함**: 언급은 있으나 구현자가 그것만 보고 만들 수 없다(구체 수치·표·규칙이 없다).
- **있음**: 담당자가 읽고 바로 작업할 수 있을 만큼 구체적이다.
- 관련어 등장 횟수는 **힌트일 뿐**이다. 0회여도 다른 표현으로 설명돼 있으면 "있음"이고, 50회여도 흩어진 언급뿐이면 "약함"이다. 반드시 본문을 근거로 판단하라.
- 근거(evidence)는 기획서에서 **실제로 인용**하라. 없으면 "본문에 해당 내용 없음"이라고 써라. 지어내지 마라.

## 출력 형식 (이 형식만, 다른 말 금지)
각 항목을 한 줄로:
[항목id] | 없음|약함|있음 | 근거(기획서 인용 또는 "본문에 해당 내용 없음") | 다음 행동(한 문장, 무엇을 정해야 하는지)

예시:
[audio] | 없음 | 본문에 해당 내용 없음 | BGM 트랙 수와 필수 SFX 목록을 우선순위와 함께 확정해야 한다.
[loop] | 있음 | "3-1. 코어 루프: 낮 채집 → 밤 방어 → 다음 날 확장" | 추가 조치 불필요.

${"출력은 반드시 한국어로 써라."}`;
}

/** 점검관 출력 파싱 — 형식이 흔들려도 최대한 건진다 */
export function parseFundamentals(text: string): FundFinding[] {
  const ids = new Set(FUNDAMENTALS.map((f) => f.id));
  const out: FundFinding[] = [];
  const seen = new Set<string>();
  for (const raw of text.split("\n")) {
    const m = raw.match(/\[([a-z0-9_]+)\]\s*\|\s*(없음|약함|있음)\s*\|([^|]*)\|?(.*)$/i);
    if (!m) continue;
    const id = m[1].toLowerCase();
    if (!ids.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      verdict: m[2] as FundFinding["verdict"],
      evidence: m[3].trim().slice(0, 300),
      action: (m[4] ?? "").trim().slice(0, 200),
    });
  }
  return out;
}
