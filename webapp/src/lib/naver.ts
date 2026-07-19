// 네이버 검색 API — 한국 시장 조사용. 키는 서버(config/naver.json)에만 있고 여기로 내려오지 않는다.
//
// 무료 티어 한도에 닿으면 서버가 { exhausted: true }를 돌려주고, 호출부는 웹 검색으로 폴백한다
// (오너 요청 2026-07-19: "무료티어 다 쓰면 Brave로 자동 전환").

export type NaverService = "blog" | "news" | "cafearticle" | "kin" | "image" | "encyc" | "doc" | "webkr";

export const NAVER_SERVICE_LABEL: Record<NaverService, string> = {
  blog: "블로그",
  news: "뉴스",
  cafearticle: "카페",
  kin: "지식iN",
  image: "이미지",
  encyc: "백과사전",
  doc: "웹문서",
  webkr: "웹",
};

export interface NaverItem {
  title: string;
  link: string;
  description?: string;
  bloggername?: string;
  postdate?: string;
  pubDate?: string;
  thumbnail?: string;
  sizewidth?: string;
  sizeheight?: string;
}

export interface NaverStatus {
  configured: boolean;
  usage: { day: string; month: string; daily: number; monthly: number; trendMonthly: number };
  caps: { daily: number; monthly: number; trendMonthly: number };
  exhausted: string;
}

export interface NaverSearchResult {
  ok: boolean;
  items: NaverItem[];
  total: number;
  /** 한도 소진·인증 실패 — 호출부가 웹 검색으로 폴백해야 한다는 신호 */
  exhausted?: boolean;
  needKey?: boolean;
  error?: string;
}

export async function getNaverStatus(): Promise<NaverStatus | null> {
  try {
    const r = await fetch("/api/naver/status");
    const j = await r.json();
    return j?.ok ? j : null;
  } catch {
    return null;
  }
}

/** 키 등록 — 오너가 앱에서 직접 입력한다 */
export async function saveNaverKey(clientId: string, clientSecret: string): Promise<void> {
  const r = await fetch("/api/naver/key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "키 등록 실패");
}

export async function saveNaverCaps(caps: Partial<NaverStatus["caps"]>): Promise<void> {
  const r = await fetch("/api/naver/caps", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(caps),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "한도 설정 실패");
}

export async function naverSearch(
  type: NaverService,
  query: string,
  opts: { display?: number; sort?: "sim" | "date"; start?: number; filter?: string } = {}
): Promise<NaverSearchResult> {
  try {
    const r = await fetch("/api/naver/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, query, ...opts }),
    });
    const j = await r.json();
    return {
      ok: !!j.ok,
      items: j.items ?? [],
      total: j.total ?? 0,
      exhausted: !!j.exhausted,
      needKey: !!j.needKey,
      error: j.error,
    };
  } catch (e: any) {
    return { ok: false, items: [], total: 0, error: String(e?.message ?? e) };
  }
}

export interface TrendGroup {
  title: string;
  data: { period: string; ratio: number }[];
}

export async function naverTrend(params: {
  startDate: string;
  endDate: string;
  timeUnit?: "date" | "week" | "month";
  keywordGroups: { groupName: string; keywords: string[] }[];
}): Promise<{ ok: boolean; results: TrendGroup[]; exhausted?: boolean; error?: string }> {
  try {
    const r = await fetch("/api/naver/trend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const j = await r.json();
    return { ok: !!j.ok, results: j.results ?? [], exhausted: !!j.exhausted, error: j.error };
  } catch (e: any) {
    return { ok: false, results: [], error: String(e?.message ?? e) };
  }
}

/** 네이버 응답의 <b> 태그·HTML 엔티티 제거 — 제목/설명에 마크업이 섞여 온다 */
export function stripNaverHtml(s: string): string {
  return (s ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/**
 * 회의용 리서치 블록 — 네이버에서 근거를 모아 프롬프트에 주입할 텍스트로 만든다.
 * 한도 소진이면 빈 문자열 + exhausted를 돌려줘 호출부가 웹 검색으로 폴백하게 한다.
 */
export async function naverResearchBlock(
  query: string,
  types: NaverService[] = ["blog", "news", "cafearticle"],
  perType = 4
): Promise<{ text: string; exhausted: boolean; used: number }> {
  const chunks: string[] = [];
  let exhausted = false;
  let used = 0;
  for (const t of types) {
    const r = await naverSearch(t, query, { display: perType, sort: "sim" });
    if (r.exhausted) {
      exhausted = true;
      break;
    }
    if (!r.ok || r.items.length === 0) continue;
    used++;
    const lines = r.items.slice(0, perType).map((it) => {
      const title = stripNaverHtml(it.title);
      const desc = stripNaverHtml(it.description ?? "").slice(0, 160);
      return `- ${title}${desc ? ` — ${desc}` : ""} (${it.link})`;
    });
    chunks.push(`[네이버 ${NAVER_SERVICE_LABEL[t]}]\n${lines.join("\n")}`);
  }
  if (chunks.length === 0) return { text: "", exhausted, used };
  return {
    text:
      `[국내 검색 근거 — 네이버 "${query}"]\n` +
      `아래는 실제 검색 결과다. 인용할 때는 링크를 함께 남기고, 없는 사실을 지어내지 마라.\n\n` +
      chunks.join("\n\n"),
    exhausted,
    used,
  };
}
