// 🎨 디자인 인텔리전스 — UI/UX·아트 회의를 검증된 디자인 DB(ui-ux-pro-max, 109k★, MIT)에 접지한다.
//
// 왜: uiux·visual 에이전트가 LLM 단독으로 화면/아트를 뽑으면 팔레트·타이포·레이아웃이
// 매번 "AI 티" 나는 일반론으로 흐른다(오너가 발표자료에서 지적한 바로 그 문제). 이 DB는
// 게임 장르별 검증된 스타일·팔레트·폰트페어·UX 규칙·안티패턴을 담고 있어, 회의 지시문과
// 프로젝트 장르에서 뽑은 영어 키워드로 쿼리해 그 근거를 프롬프트에 주입한다.
//
// 안전장치(nomic 교훈): DB는 영어 키워드 매칭이고 VE 프로젝트는 한국어다. 장르가 매칭되지
// 않으면 서버가 "General" 기본값(Glassmorphism)을 돌려주는데 — 냥빙고에 Glassmorphism 같은
// 엉뚱한 방향을 주입하느니 아예 주입하지 않는다(matched=false → 빈 문자열).

const API = "/api/design/search";

/** 게임/앱 장르·무드·세팅·플랫폼 → 영어 디자인 키워드. DB가 영어로만 매칭돼서 필요하다. */
const KO_EN_GENRE: Record<string, string> = {
  // 장르
  빙고: "bingo", 퍼즐: "puzzle", 매치3: "match3", "3매치": "match3", 매칭: "match3",
  방치: "idle", 클리커: "clicker", 수집: "collection", 카드: "card", 보드: "board",
  역할: "rpg", 알피지: "rpg", 액션: "action", 어드벤처: "adventure", 모험: "adventure",
  시뮬: "simulation", 시뮬레이션: "simulation", 경영: "tycoon", 타이쿤: "tycoon business",
  디펜스: "tower defense", 로그라이크: "roguelike", 슈팅: "shooter", 슈터: "shooter",
  리듬: "rhythm", 레이싱: "racing", 스포츠: "sports", 격투: "fighting", 전략: "strategy",
  퀴즈: "quiz trivia", 낚시: "fishing", 농사: "farming", 농장: "farming", 요리: "cooking",
  건설: "building", 방탈출: "escape puzzle", 타워: "tower defense",
  // 세부 세팅·소재
  생존: "survival", 서바이벌: "survival", 좀비: "zombie", 던전: "dungeon", 미로: "maze",
  겨울: "winter", 눈: "snow", 고양이: "cat", 냥: "cat", 동물: "animal cute", 우주: "space",
  바다: "ocean", 숲: "forest", 마법: "fantasy magic", 판타지: "fantasy",
  // 무드·톤
  귀여운: "cute", 귀여움: "cute", 아기자기: "cozy cute", 아늑: "cozy", 힐링: "relaxing cozy",
  다크: "dark", 레트로: "retro pixel", 픽셀: "pixel", 미니멀: "minimal", 화려: "vibrant",
  네온: "neon", 감성: "aesthetic", 몽환: "dreamy", 미래: "futuristic", 사이버펑크: "cyberpunk",
  캐주얼: "casual", 하이퍼캐주얼: "hypercasual", 인디: "indie",
  // 플랫폼
  모바일: "mobile", 세로: "portrait mobile", 태블릿: "tablet",
};

/** 한국어 텍스트 뭉치에서 장르 키워드를 뽑아 영어 쿼리로 변환. ASCII 토큰(RPG 등)은 그대로 통과. */
export function buildDesignQuery(...sources: string[]): string {
  const text = sources.filter(Boolean).join(" ");
  const hits = new Set<string>();
  for (const [ko, en] of Object.entries(KO_EN_GENRE)) {
    if (text.includes(ko)) en.split(/\s+/).forEach((w) => hits.add(w));
  }
  // 원문에 이미 영어로 쓴 장르 힌트(RPG, match3, roguelike ...)도 살린다
  for (const tok of text.match(/[A-Za-z][A-Za-z0-9-]{2,}/g) ?? []) {
    const t = tok.toLowerCase();
    if (t.length <= 14) hits.add(t);
  }
  return [...hits].slice(0, 12).join(" ").trim();
}

export interface DesignSystem {
  category?: string;
  style?: { name?: string; keywords?: string; best_for?: string };
  colors?: Record<string, string>;
  typography?: { heading?: string; body?: string; mood?: string };
  key_effects?: string;
  anti_patterns?: string;
  pattern?: { name?: string };
}

export async function fetchDesignSystem(query: string): Promise<DesignSystem | null> {
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const j = await r.json();
    if (!j?.ok || !j.designSystem) return null;
    return j.designSystem as DesignSystem;
  } catch {
    return null;
  }
}

/**
 * 회의 주입용 블록. 지시문 + 프로젝트명 + GDD 개요에서 장르 쿼리를 만들어 검증 디자인을 받아온다.
 * 장르가 매칭되지 않으면(category "General") 빈 문자열 — 엉뚱한 기본값을 주입하지 않는다.
 */
export async function designRecallBlock(
  projectName: string,
  request: string,
  overview: string
): Promise<{ text: string; category: string; matched: boolean }> {
  const query = buildDesignQuery(projectName, request, overview);
  if (!query) return { text: "", category: "", matched: false };
  const ds = await fetchDesignSystem(query);
  const category = ds?.category ?? "";
  // "General"은 장르 미매칭 기본값(Glassmorphism) — 주입하지 않는다.
  if (!ds || !category || category === "General") return { text: "", category, matched: false };

  const c = ds.colors ?? {};
  const st = ds.style ?? {};
  const ty = ds.typography ?? {};
  const lines: string[] = [
    `[🎨 디자인 인텔리전스 — "${category}" (ui-ux-pro-max 109k★ 검증 DB에서 이 게임 장르로 조회)]`,
    `아래는 이 장르에 검증된 디자인 방향이다. 화면·아트·발표를 설계할 때 일반론·AI 티 나는 선택 대신 이것을 근거로 삼아라.`,
    st.name ? `- 스타일: ${st.name}${st.keywords ? ` — ${st.keywords}` : ""}` : "",
    c.primary
      ? `- 팔레트: Primary ${c.primary} · Accent ${c.accent ?? c.cta ?? "-"} · 배경 ${c.background ?? "-"} · 전경 ${c.foreground ?? c.text ?? "-"}${c.notes ? ` (근거: ${c.notes})` : ""}`
      : "",
    ty.heading || ty.body ? `- 타이포: 제목 ${ty.heading ?? "-"} · 본문 ${ty.body ?? "-"}${ty.mood ? ` (무드: ${ty.mood})` : ""}` : "",
    ds.key_effects ? `- 핵심 이펙트: ${String(ds.key_effects).slice(0, 160)}` : "",
    ds.anti_patterns ? `- 반드시 피할 것: ${String(ds.anti_patterns).slice(0, 120)}` : "",
    `- 필수 UX(우선순위): 명암비 4.5:1 · 터치 타깃 44×44px · 모션 150~300ms · 아이콘은 SVG(이모지 금지) · 모바일 우선 반응형`,
  ].filter(Boolean);

  return { text: lines.join("\n"), category, matched: true };
}
