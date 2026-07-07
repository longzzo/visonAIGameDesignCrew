// 스튜디오 존(부서) 정의 — 3D 사무실·보드·소통 범위(부서 내)가 공유한다.
// 컴포넌트가 아닌 lib에 둔 이유: store가 부서 판단(소통 범위)에 써야 해서 (컴포넌트 → store 순환 방지).

export interface ZoneDef {
  id: string;
  label: string;
  dot: string;
  rug: [number, number, number, number]; // cx, cz, w, d
  rugDay: string;
  rugNight: string;
}

export const ZONES: ZoneDef[] = [
  { id: "ceo", label: "대표실", dot: "#8b7cf6", rug: [-12.5, -8.5, 8, 6.4], rugDay: "#3a3f55", rugNight: "#3d4360" },
  { id: "plan", label: "기획 데스크", dot: "#60a5fa", rug: [-8.5, 0.5, 12.4, 7.2], rugDay: "#dbe7f8", rugNight: "#39485f" },
  { id: "dev", label: "개발 데스크", dot: "#34d399", rug: [7, 0.5, 13.4, 7.2], rugDay: "#d8f1e3", rugNight: "#345247" },
  { id: "biz", label: "사업 데스크", dot: "#fbbf24", rug: [-9.5, 8, 9.4, 4.8], rugDay: "#f8ecd2", rugNight: "#544a33" },
  { id: "art", label: "아트 스튜디오", dot: "#e879f9", rug: [-1.5, 8, 6, 4.8], rugDay: "#f7dcee", rugNight: "#523a52" },
  { id: "qa", label: "품질 검수", dot: "#f87171", rug: [11.75, 8, 8.6, 4.8], rugDay: "#f9dcdc", rugNight: "#573a3c" },
  { id: "meet", label: "회의실", dot: "#a78bfa", rug: [3.5, -8.5, 9.4, 6.4], rugDay: "#e7e2f6", rugNight: "#413a5c" },
  // 휴게실 — 소속 에이전트 없음. 대기 중인 직원들이 놀러 와 잡담하는 연출 공간.
  { id: "lounge", label: "휴게실", dot: "#fb923c", rug: [13.4, -8.5, 9, 6.4], rugDay: "#f5e6d3", rugNight: "#4d4234" },
];

export const zoneOf = (id: string): ZoneDef => ZONES.find((z) => z.id === id) ?? ZONES[1];

export const AGENT_ZONE: Record<string, string> = {
  pm: "ceo",
  scenario: "plan", gameplay: "plan", systems: "plan", uiux: "plan", balance: "plan",
  bm: "biz", scheduler: "biz", marketing: "biz",
  visual: "art",
  td: "dev", uarch: "dev", ugp: "dev", netcode: "dev", techart: "dev", edtool: "dev",
  qa: "qa", review: "qa", testeng: "qa",
};

export const zoneOfAgent = (id: string): ZoneDef => zoneOf(AGENT_ZONE[id] ?? "plan");

/** 같은 부서(존)인지 — 소통 범위 "부서 내" 판정에 사용 */
export const sameDept = (a: string, b: string): boolean => (AGENT_ZONE[a] ?? "?") === (AGENT_ZONE[b] ?? "!");

/* ── 소통 범위 (에이전트 간 협업·검토 허용 범위) ────────── */
/** feed = 피드 위탁: 회의·교차검토에 직접 참여하지 않고 결론을 피드로만 받아본다 (개인 작업·1:1 대화는 그대로) */
export type CommScopeMode = "all" | "dept" | "custom" | "feed";
export interface CommScope {
  mode: CommScopeMode;
  /** custom일 때 허용된 상대 에이전트 id 목록 */
  allow?: string[];
}

const SCOPE_KEY = "ve-comm-scope";

export function loadCommScopes(): Record<string, CommScope> {
  try {
    return JSON.parse(localStorage.getItem(SCOPE_KEY) ?? "{}");
  } catch {
    return {};
  }
}
export function saveCommScopes(s: Record<string, CommScope>) {
  try {
    localStorage.setItem(SCOPE_KEY, JSON.stringify(s));
  } catch {
    /* noop */
  }
}

/** a가 b와 소통(검토·협업)할 수 있는가 — PM·QA(게이트 역할)는 항상 허용 */
export function scopeAllows(scopes: Record<string, CommScope>, a: string, b: string): boolean {
  if (a === b) return true;
  if (a === "pm" || b === "pm" || a === "qa" || b === "qa") return true;
  const s = scopes[a];
  if (!s || s.mode === "all") return true;
  if (s.mode === "feed") return false;
  if (s.mode === "dept") return sameDept(a, b);
  return (s.allow ?? []).includes(b);
}

/** 양방향 소통 가능 여부 */
export function scopeMutual(scopes: Record<string, CommScope>, a: string, b: string): boolean {
  return scopeAllows(scopes, a, b) && scopeAllows(scopes, b, a);
}
