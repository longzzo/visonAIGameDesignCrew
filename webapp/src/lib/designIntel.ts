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
  샌드박스: "sandbox", 횡스크롤: "platformer side-scroller", 플랫포머: "platformer",
  채굴: "mining", 크래프팅: "crafting", 제작: "crafting", 타일: "tile",
  도트: "pixel retro", 도트그래픽: "pixel retro", "16x16": "pixel",
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

/**
 * 원문에 영어로 쓴 장르 힌트만 통과시키는 화이트리스트.
 *
 * 예전엔 ASCII 토큰을 전부 쿼리에 넣어서 `v11 v12 d-100 v17` 같은 버전 문자열까지
 * 디자인 DB 검색어가 됐다(실측 2026-07-26 B-1). 검색 정확도를 갉아먹는 순수 잡음이다.
 */
const EN_GENRE_TOKENS = new Set([
  "rpg", "jrpg", "arpg", "fps", "tps", "moba", "rts", "mmo", "mmorpg", "roguelike", "roguelite",
  "match3", "platformer", "metroidvania", "sandbox", "survival", "horror", "puzzle", "shooter",
  "racing", "sports", "fighting", "strategy", "simulation", "idle", "clicker", "tycoon",
  "visualnovel", "soulslike", "deckbuilder", "sidescroller", "pixel", "retro", "arcade",
  "casual", "hypercasual", "indie", "roguevania", "tower", "defense", "crafting", "mining",
]);

/**
 * 한국어 텍스트에서 장르 키워드가 **단어로서** 등장했는지 본다.
 *
 * 왜 단순 includes로는 안 되는가 (오너 실측 2026-07-26 B-1 — 실제 오염 사고):
 *   · "냥빙고"  ⊃ "빙고" → bingo
 *   · "키보드"  ⊃ "보드" → board
 *   · "전략"           → strategy
 *   합쳐서 `card board strategy` → DB가 **"Card & Board Game"**으로 판정 →
 *   카드게임 팔레트·UX가 매 회의 전원에게 배포되고, 산출물에 "습격 승리 +15 / 패배 −25"
 *   같은 카드게임식 점수 메커니즘이 등장했다. 2D 생존·채굴 게임에 그런 단위는 없다.
 *
 * 규칙: 키워드 **앞**에 한글이 붙어 있으면 다른 단어의 일부로 본다(냥+빙고, 키+보드).
 * 뒤에 붙는 건 허용한다 — "퍼즐게임", "카드덱"처럼 한국어는 뒤로 합성되는 게 자연스럽다.
 */
function hasKoTerm(text: string, term: string): boolean {
  let i = text.indexOf(term);
  while (i !== -1) {
    const prev = i > 0 ? text[i - 1] : "";
    if (!/[가-힣]/.test(prev)) return true;
    i = text.indexOf(term, i + 1);
  }
  return false;
}

/**
 * GDD 1장의 정본 테이블에서 장르를 직접 읽는다.
 *
 * 진단서 처방: "장르는 KO맵을 우회해 GDD 1장 태그에서 직접 읽을 것."
 * 프로젝트명(냥빙고)이나 회의 지시문 전체를 훑으면 위 오염이 재발하므로,
 * 오너가 정본에 확정해 둔 `| 장르 | ... |` 행을 1순위 근거로 삼는다.
 */
export function genreFromGdd(overview: string): string {
  const rows = ["장르", "아트 방향", "아트방향", "플랫폼", "주제 해석"];
  const out: string[] = [];
  for (const label of rows) {
    const m = new RegExp(`^\\|\\s*\\*{0,2}${label}[^|]*\\|\\s*([^|]+)\\|`, "m").exec(overview);
    if (m) out.push(m[1].replace(/\*+/g, " ").trim());
  }
  return out.join(" · ");
}

/**
 * 장르 쿼리를 만든다.
 *
 * 근거 우선순위: ① GDD 1장 정본의 장르·아트 방향  ② 회의 지시문  ③ (프로젝트명은 쓰지 않는다)
 * 프로젝트명을 뺀 이유는 위 hasKoTerm 주석의 "냥빙고 → bingo" 사고 때문이다.
 */
export function buildDesignQuery(...sources: string[]): string {
  const text = sources.filter(Boolean).join(" ");
  const hits = new Set<string>();
  for (const [ko, en] of Object.entries(KO_EN_GENRE)) {
    if (hasKoTerm(text, ko)) en.split(/\s+/).forEach((w) => hits.add(w));
  }
  // 원문에 이미 영어로 쓴 장르 힌트(RPG, roguelike ...)만 살린다 — 버전 문자열·약어는 버린다
  for (const tok of text.match(/[A-Za-z][A-Za-z0-9-]{2,}/g) ?? []) {
    const t = tok.toLowerCase();
    if (EN_GENRE_TOKENS.has(t)) hits.add(t);
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
  _projectName: string,
  request: string,
  overview: string
): Promise<{ text: string; category: string; matched: boolean; query?: string }> {
  // 장르 근거는 GDD 1장 정본이 1순위. 프로젝트명은 쓰지 않는다("냥빙고 → bingo" 오염, B-1).
  const genreRow = genreFromGdd(overview);
  const query = buildDesignQuery(genreRow || overview, request);
  // 신뢰도 하한 — 장르 단서가 1개뿐이면 우연 매칭일 확률이 높다. 애매하면 주입하지 않는다.
  if (!query || query.split(/\s+/).length < 2) return { text: "", category: "", matched: false, query };
  const ds = await fetchDesignSystem(query);
  const category = ds?.category ?? "";
  // "General"은 장르 미매칭 기본값(Glassmorphism) — 주입하지 않는다.
  if (!ds || !category || category === "General") return { text: "", category, matched: false, query };
  // 게임 프로젝트인데 게임이 아닌 카테고리(Micro SaaS·LMS 등)가 돌아오면 **매칭 실패로 본다**.
  // DB에 sandbox/platformer 항목이 없어 엉뚱한 제품군으로 튀는 경우가 실제로 나온다.
  // 이걸 그대로 주입하면 B-1(카드게임 오염)과 같은 종류의 사고가 형태만 바꿔 재발한다.
  const looksGame = /게임|game|장르|플레이어|스테이지|레벨|보스|퀘스트/i.test(`${overview.slice(0, 1200)} ${request}`);
  if (looksGame && !/game|gaming|arcade|puzzle/i.test(category)) {
    return { text: "", category, matched: false, query };
  }

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

  return { text: lines.join("\n"), category, matched: true, query };
}
