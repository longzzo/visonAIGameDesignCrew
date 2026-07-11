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

/* ── 노션 편집실 — 링크를 주면 읽고, 아키비스트가 고치고, 승인하면 반영 ── */

export interface NotionPageRead {
  pageId: string;
  title: string;
  md: string;
  blockCount: number;
  complexCount: number;
  notes: string[];
  url: string;
}

export async function readNotionPage(url: string): Promise<NotionPageRead> {
  const r = await fetch("/api/notion/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new Error(j?.error || `페이지 읽기 실패 (HTTP ${r.status})`);
  return j as NotionPageRead;
}

/** 기존 기획을 노션으로 시작 — 허브 페이지를 하위 기획서까지 따라 읽어 한 문서로 */
export interface NotionPageImport {
  pageId: string;
  title: string;
  md: string;
  pages: number;
  notes: string[];
  url: string;
}

export async function importNotionPage(url: string): Promise<NotionPageImport> {
  const r = await fetch("/api/notion/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new Error(j?.error || `노션 가져오기 실패 (HTTP ${r.status})`);
  return j as NotionPageImport;
}

/** 가져오기 진행률 폴링 — 딥 리드가 도는 동안 "3/21" 진행을 보여주기 위해 */
export interface NotionImportProgress {
  done: number;
  total: number;
  title?: string;
}

export async function getImportProgress(url: string): Promise<NotionImportProgress | null> {
  try {
    const r = await fetch(`/api/notion/import-progress?url=${encodeURIComponent(url)}`);
    const j = await r.json();
    return j?.progress ?? null;
  } catch {
    return null;
  }
}

export async function editNotionPage(
  url: string,
  markdown: string,
  mode: "replace" | "append"
): Promise<{ url: string; preserved: number; backup: string }> {
  const r = await fetch("/api/notion/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, markdown, mode }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new Error(j?.error || `반영 실패 (HTTP ${r.status})`);
  return { url: String(j.url ?? url), preserved: Number(j.preserved) || 0, backup: String(j.backup ?? "") };
}
