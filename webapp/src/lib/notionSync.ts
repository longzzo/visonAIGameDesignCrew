// 노션 발행 클라이언트 — 서버(/api/notion)가 GDD·보고서를 오너의 노션에
// 레퍼런스 디자인(허브+개요표+섹션 자식 페이지)으로 발행한다.

export interface NotionStatus {
  configured: boolean;
  auto: boolean;
  last: Record<string, { url: string; ts: number } | null>;
}

export async function getNotionStatus(): Promise<NotionStatus> {
  const r = await fetch("/api/notion");
  const j = await r.json();
  return { configured: !!j.configured, auto: j.auto !== false, last: j.last ?? {} };
}

export async function setupNotion(token: string, parentUrl: string): Promise<string> {
  const r = await fetch("/api/notion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, parentUrl }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new Error(j?.error || `연동 실패 (HTTP ${r.status})`);
  return String(j.pageTitle ?? "");
}

export async function setNotionAuto(auto: boolean): Promise<void> {
  const r = await fetch("/api/notion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auto }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new Error(j?.error || "설정 실패");
}

export async function publishNotion(project: string): Promise<string> {
  const r = await fetch("/api/notion/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new Error(j?.error || `발행 실패 (HTTP ${r.status})`);
  return String(j.url ?? "");
}
