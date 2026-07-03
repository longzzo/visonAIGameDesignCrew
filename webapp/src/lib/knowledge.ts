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

/** 특정 에이전트에게 주입할 지식 블록 (최신 2건, 요약만) */
export function knowledgeBlockFor(agentId: string, items: KnowledgeItem[]): string {
  return items
    .filter((k) => k.agents.includes("all") || k.agents.includes(agentId))
    .slice(0, 2)
    .map((k) => `◆ ${k.title}\n${k.summary}`)
    .join("\n\n");
}
