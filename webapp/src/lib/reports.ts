// 프로젝트별 보고서(정식 명세서) 저장소 — /api/reports 입출력

/** 보고서 분류 — spec(명세서·규칙), minutes(회의록), report(그 외 일반 보고) */
export type ReportKind = "spec" | "minutes" | "report";

export interface ReportInfo {
  ts: number;
  agent: string;
  title: string;
  size: number;
  kind?: ReportKind;
}

export interface ReportDoc extends Omit<ReportInfo, "size"> {
  markdown: string;
}

/** kind 필드가 없는 옛 보고서는 제목으로 분류 — 노션 발행 측(notion-publish.mjs kindOf)과 규칙을 항상 동일하게 유지할 것 */
export function reportKind(r: { kind?: string; title: string }): ReportKind {
  if (r.kind === "spec" || r.kind === "minutes" || r.kind === "report") return r.kind;
  if (r.title.startsWith("회의록")) return "minutes";
  if (/명세서|규칙|스펙|사양/.test(r.title)) return "spec";
  return "report";
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

export async function saveReport(project: string, agent: string, title: string, markdown: string, kind?: ReportKind): Promise<number> {
  const r = await fetch(`/api/reports?project=${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent, title, markdown, kind }),
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
