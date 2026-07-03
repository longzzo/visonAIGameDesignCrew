// 지식 라이브러리 — 오너가 제출한 기획 이론을 PM이 검증한 뒤 학습(저장)하고,
// 관련 에이전트의 프롬프트에 주입한다. 스튜디오 공용(프로젝트 무관).

export interface KnowledgeItem {
  ts: number;
  title: string;
  /** PM이 실무용으로 압축한 요약 — 프롬프트에는 이것만 주입된다 */
  summary: string;
  /** 원문 (열람용) */
  content: string;
  /** 적용 대상 에이전트 id 목록, ["all"]이면 전원 */
  agents: string[];
  /** 출처 (예: "obsidian:<볼트 상대경로>") — 같은 출처 재학습 시 이전 버전을 대체 */
  source?: string;
  /** 출처 노트의 mtime — 볼트 노트 갱신 감지용 */
  srcMtime?: number;
}

export async function listKnowledge(): Promise<KnowledgeItem[]> {
  try {
    const r = await fetch("/api/knowledge");
    if (!r.ok) return [];
    return (await r.json()).items ?? [];
  } catch {
    return [];
  }
}

export async function saveKnowledge(
  title: string,
  summary: string,
  content: string,
  agents: string[],
  source?: string,
  srcMtime?: number
): Promise<number> {
  const r = await fetch("/api/knowledge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, summary, content, agents, source, srcMtime }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "지식 저장 실패");
  return j.ts as number;
}

export async function deleteKnowledge(ts: number): Promise<void> {
  await fetch(`/api/knowledge?ts=${ts}`, { method: "DELETE" });
}

/**
 * 특정 에이전트에게 주입할 지식 선정 (최대 3건).
 * context(지시문·보고서 주제)가 있으면 제목·요약 토큰이 겹치는 지식을 우선하고,
 * 동점이면 최신순 — 지식이 쌓여도 "관련 있는 것"이 주입되게 한다.
 */
export function knowledgePickFor(agentId: string, items: KnowledgeItem[], context = ""): KnowledgeItem[] {
  const pool = items.filter((k) => k.agents.includes("all") || k.agents.includes(agentId));
  if (pool.length === 0) return [];
  const ctx = context.toLowerCase();
  const score = (k: KnowledgeItem): number => {
    if (!ctx) return 0;
    let s = 0;
    const tokens = new Set(
      `${k.title} ${k.summary}`
        .toLowerCase()
        .split(/[^0-9a-z가-힣]+/)
        .filter((t) => t.length >= 2)
    );
    for (const t of tokens) if (ctx.includes(t)) s++;
    return s;
  };
  return pool
    .map((k) => ({ k, s: score(k) }))
    .sort((x, y) => y.s - x.s || y.k.ts - x.k.ts)
    .slice(0, 3)
    .map(({ k }) => k);
}

/** 특정 에이전트에게 주입할 지식 블록 (요약만) */
export function knowledgeBlockFor(agentId: string, items: KnowledgeItem[], context = ""): string {
  return knowledgePickFor(agentId, items, context)
    .map((k) => `◆ ${k.title}\n${k.summary}`)
    .join("\n\n");
}
