// 🧠 의미 기억 — 회의 지시문과 의미가 가까운 과거 결정·보고·GDD 절을 찾아 프롬프트에 주입한다.
//
// 왜: 결정 원장은 최신 12건만 주입돼서(decisionsBlock), 원장이 100건을 넘으면
// "석빙고 온도" 회의에 정작 예전 온도 확정 결정이 빠지는 구조였다. 의미 검색이
// 오래됐지만 관련 있는 기록을 되살린다. (ruflo 분석에서 유일하게 진짜였던 부분의 차용)
//
// 실패는 조용히: 임베딩 서버(Ollama·bge-m3)가 없으면 빈 문자열 — 회의는 최신순으로 계속.

export interface MemoryHit {
  ns: "decision" | "report" | "gdd" | string;
  ref: string;
  text: string;
  score: number;
}

const NS_LABEL: Record<string, string> = { decision: "결정", report: "보고서", gdd: "GDD" };

export async function semanticSearch(project: string, query: string, k = 6): Promise<MemoryHit[]> {
  try {
    const r = await fetch("/api/memory/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, query, k }),
    });
    const j = await r.json();
    if (!j?.ok || !Array.isArray(j.results)) return [];
    return j.results as MemoryHit[];
  } catch {
    return [];
  }
}

/**
 * 회의 주입용 블록. excludeTexts(이미 최신순으로 주입된 결정들)와 겹치는 항목은 뺀다.
 * 상위 6건·각 180자 제한 — ruflo 감사의 "토큰 폭식" 반면교사.
 */
export async function semanticRecallBlock(
  project: string,
  query: string,
  excludeTexts: string[] = []
): Promise<{ text: string; count: number }> {
  const hits = await semanticSearch(project, query, 8);
  const seen = new Set(excludeTexts.map((t) => t.replace(/\s+/g, " ").trim().slice(0, 80)));
  const picked: MemoryHit[] = [];
  for (const h of hits) {
    const key = h.text.replace(/\s+/g, " ").trim().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(h);
    if (picked.length >= 6) break;
  }
  if (!picked.length) return { text: "", count: 0 };
  const lines = picked.map((h) => {
    const label = NS_LABEL[h.ns] ?? h.ns;
    const ref = h.ns === "decision" ? "" : h.ref ? `: ${h.ref.slice(0, 40)}` : "";
    return `- (${label}${ref}) ${h.text.slice(0, 180)}`;
  });
  return {
    text:
      `[관련 과거 기록 — 이번 지시와 의미가 가까운 것들 (의미 검색)]\n` +
      `아래는 이 프로젝트의 확정 기록이다. 이번 작업이 이것과 어긋나면 확인 없이 뒤집지 마라.\n` +
      lines.join("\n"),
    count: picked.length,
  };
}
