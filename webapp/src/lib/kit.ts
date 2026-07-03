// 개발 착수 킷 + 결정사항 원장 — 서버 입출력

export interface KitFile {
  path: string;
  size: number;
}

export interface DecisionItem {
  ts: number;
  text: string;
  source?: string;
}

export async function listKitFiles(project: string): Promise<KitFile[]> {
  try {
    const r = await fetch(`/api/kit?project=${encodeURIComponent(project)}`);
    if (!r.ok) return [];
    return (await r.json()).files ?? [];
  } catch {
    return [];
  }
}

export async function saveKitFiles(project: string, files: { path: string; content: string }[]): Promise<number> {
  const r = await fetch(`/api/kit/files?project=${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "킷 파일 저장 실패");
  return j.saved as number;
}

export function kitFileUrl(project: string, filePath: string): string {
  return `/api/kit/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(filePath)}`;
}

export function kitZipUrl(project: string): string {
  return `/api/kit/zip?project=${encodeURIComponent(project)}`;
}

export async function listDecisions(project: string): Promise<DecisionItem[]> {
  try {
    const r = await fetch(`/api/decisions?project=${encodeURIComponent(project)}`);
    if (!r.ok) return [];
    return (await r.json()).items ?? [];
  } catch {
    return [];
  }
}

export async function appendDecisions(project: string, items: string[], source: string): Promise<void> {
  await fetch(`/api/decisions?project=${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, source }),
  });
}

/** 최근 결정사항을 프롬프트 주입용 불릿 텍스트로 (최신 우선 최대 n개) */
export function decisionsBlock(items: DecisionItem[], n = 12): string {
  return items
    .slice(-n)
    .map((d) => `- ${d.text}`)
    .join("\n");
}
