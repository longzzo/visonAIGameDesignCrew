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

/**
 * 작업 종류별 경험치 — 잘하면 오르고 **못하면 깎인다**.
 *
 * 오너 지적(2026-07-16): "에이전트들이 실수에 대한 책임이 너무 없다". 실제로 예전 규칙은
 * `qaFail: 5`였다 — QA에 반려당해도 경험치를 벌었고, 서버도 `addXp > 0`만 반영해 감점이 아예 불가능했다.
 * 이제 QA·상사 검증 결과가 성적표처럼 작동한다: 완벽하면 크게 주고, 반려·재지시는 깎는다.
 */
export const XP_RULES: Record<string, number> = {
  draft: 20, // 오케스트레이션 산출물 확정
  review: 10, // 동료 초안 검토 수행
  qaPerfect: 15, // QA 만점권(평균 9+) — "완벽하게 수행"에 대한 보상
  qaPass: 6, // QA 통과 (평균 7~9)
  qaFail: -12, // QA 반려 — 감점. 교훈은 그대로 적립해 다음 회의에 쓰게 한다
  bossRedo: -8, // 상사가 [재지시]로 되돌려보냄 = 검증 실패
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
): Promise<{ agent: AgentGrowth; leveledUp: boolean; demoted: boolean } | null> {
  try {
    const r = await fetch("/api/growth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, ...patch }),
    });
    const j = await r.json();
    return j?.ok ? { agent: j.agent, leveledUp: !!j.leveledUp, demoted: !!j.demoted } : null;
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
