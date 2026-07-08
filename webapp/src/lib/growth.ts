// 에이전트 자가 성장 — 작업 경험치(XP)·레벨·스스로 배운 작업 요령(스킬).
// 성장의 재료는 전부 공짜다(작업 완료 이벤트·QA 반려 지적). LLM은 레벨업 회고 1회에만 쓴다.
// 스킬은 gateway.runAgent가 모든 프롬프트 앞에 주입한다 — 어제 배운 요령을 오늘 작업에 쓴다.

export interface AgentSkill {
  ts: number;
  text: string;
}
export interface AgentGrowth {
  xp: number;
  level: number;
  skills: AgentSkill[];
  lessons: string[];
}
export type GrowthMap = Record<string, AgentGrowth>;

/** 작업 종류별 경험치 — 산출물이 클수록, 실패에서 배울수록 */
export const XP_RULES: Record<string, number> = {
  draft: 20, // 오케스트레이션 산출물 확정
  review: 10, // 동료 초안 검토 수행
  qaPass: 8, // QA 게이트 통과 보너스
  qaFail: 5, // 반려도 경험 — 교훈과 함께 적립
  talk: 6, // 협업 회의 발언
  conclusion: 12, // 협업 결론 작성 (리드)
  report: 25, // 정식 보고서
  chat: 2, // 1:1 응답
};

/** 누적 XP 임계 — Lv n 도달에 40·n·(n-1). 서버(levelOf)와 동일 곡선 */
export function xpForLevel(n: number): number {
  return 40 * n * (n - 1);
}

export async function fetchGrowth(): Promise<GrowthMap> {
  try {
    const r = await fetch("/api/growth");
    const j = await r.json();
    return j?.ok ? (j.growth ?? {}) : {};
  } catch {
    return {};
  }
}

export async function postGrowth(
  agentId: string,
  patch: { addXp?: number; lesson?: string; skill?: string; removeSkill?: number }
): Promise<{ agent: AgentGrowth; leveledUp: boolean } | null> {
  try {
    const r = await fetch("/api/growth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, ...patch }),
    });
    const j = await r.json();
    return j?.ok ? { agent: j.agent, leveledUp: !!j.leveledUp } : null;
  } catch {
    return null;
  }
}

/* ── 스킬 주입 캐시 — store가 갱신하고 gateway가 읽는다 (순환 의존 방지) ── */

let skillCache: GrowthMap = {};
export function setGrowthCache(g: GrowthMap) {
  skillCache = g;
}

/** 프롬프트 앞에 붙일 자가 학습 요령 블록 (최근 3개, 없으면 빈 문자열) */
export function skillDirective(agentId: string): string {
  const skills = (skillCache[agentId]?.skills ?? []).slice(-3);
  if (skills.length === 0) return "";
  return `[축적된 작업 요령 — 네가 지난 작업 경험에서 스스로 배운 것이다. 반드시 적용해라]\n${skills
    .map((s) => `- ${s.text}`)
    .join("\n")}\n\n`;
}
