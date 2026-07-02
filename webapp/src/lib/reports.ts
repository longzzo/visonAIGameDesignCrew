// 프로젝트별 보고서(정식 명세서) 저장소 — /api/reports 입출력

export interface ReportInfo {
  ts: number;
  agent: string;
  title: string;
  size: number;
}

export interface ReportDoc extends Omit<ReportInfo, "size"> {
  markdown: string;
}

export async function listReports(project: string): Promise<ReportInfo[]> {
  try {
    const r = await fetch(`/api/reports?project=${encodeURIComponent(project)}`);
    if (!r.ok) return [];
    return (await r.json()).reports ?? [];
  } catch {
    return [];
  }
}

export async function fetchReport(project: string, ts: number): Promise<ReportDoc> {
  const r = await fetch(`/api/reports?project=${encodeURIComponent(project)}&ts=${ts}`);
  if (!r.ok) throw new Error("보고서 조회 실패");
  return (await r.json()) as ReportDoc;
}

export async function saveReport(project: string, agent: string, title: string, markdown: string): Promise<number> {
  const r = await fetch(`/api/reports?project=${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent, title, markdown }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "보고서 저장 실패");
  return j.ts as number;
}

export async function deleteReport(project: string, ts: number): Promise<void> {
  const r = await fetch(`/api/reports?project=${encodeURIComponent(project)}&ts=${ts}`, { method: "DELETE" });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "보고서 삭제 실패");
}

/** 브라우저에서 .md 파일로 다운로드 */
export function downloadReport(doc: ReportDoc): void {
  const blob = new Blob([doc.markdown], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${doc.title.replace(/[\\/:*?"<>|]/g, "_")}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}
