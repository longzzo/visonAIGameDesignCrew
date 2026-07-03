// 개발 인턴 — 선임 개발자(td)가 확정한 기능별 HTML 페이퍼 프로토타입 입출력

export interface ProtoDoc {
  ts: number;
  feature: string;
}

export async function listPrototypes(project: string): Promise<ProtoDoc[]> {
  try {
    const r = await fetch(`/api/proto?project=${encodeURIComponent(project)}`);
    if (!r.ok) return [];
    return (await r.json()).items ?? [];
  } catch {
    return [];
  }
}

export async function savePrototype(project: string, feature: string, html: string): Promise<number> {
  const r = await fetch(`/api/proto?project=${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feature, html }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "프로토타입 저장 실패");
  return j.ts as number;
}

export async function deletePrototype(project: string, ts: number): Promise<void> {
  await fetch(`/api/proto?project=${encodeURIComponent(project)}&ts=${ts}`, { method: "DELETE" });
}

export function prototypeFileUrl(project: string, ts: number): string {
  return `/api/proto/file?project=${encodeURIComponent(project)}&ts=${ts}`;
}
