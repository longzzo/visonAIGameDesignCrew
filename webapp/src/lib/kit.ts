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

/* ── 승인 대기 큐 (오너 에스컬레이션) ── */

export interface ApprovalItem {
  id: string;
  ts: number;
  title: string;
  detail?: string;
  source?: string;
  status: "pending" | "approved" | "rejected";
  decidedTs?: number;
  note?: string;
  /** 이 안건으로 실행 회의를 착수한 시각 — 중복 실행 방지의 근거 (자동 실행·수동 실행 공통) */
  ranTs?: number;
  /** 실행 횟수 — 오너가 의도적으로 재실행한 경우 누적 */
  ranCount?: number;
}

export async function listApprovals(project: string): Promise<ApprovalItem[]> {
  try {
    const r = await fetch(`/api/approvals?project=${encodeURIComponent(project)}`);
    if (!r.ok) return [];
    return (await r.json()).items ?? [];
  } catch {
    return [];
  }
}

export async function addApprovalApi(project: string, title: string, detail = "", source = ""): Promise<boolean> {
  const r = await fetch(`/api/approvals?project=${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ add: { title, detail, source } }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "안건 등록 실패");
  return j.added > 0;
}

export async function decideApprovalApi(project: string, id: string, status: "approved" | "rejected", note = ""): Promise<ApprovalItem> {
  const r = await fetch(`/api/approvals?project=${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decide: { id, status, note } }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "결재 실패");
  return j.item as ApprovalItem;
}

/**
 * 실행권 선점(claim) — 서버가 ranTs를 원자적으로 찍어 중복 실행을 막는다.
 * 이미 실행된 안건이면 `already: true`를 돌려주고 ranTs는 그대로 둔다(force일 때만 재실행 허용).
 * 클라 상태만으로 막으면 더블클릭·창 2개에서 같은 지시가 두 번 나간다 — 판정은 반드시 서버에서.
 */
export async function claimApprovalRunApi(
  project: string,
  id: string,
  force = false
): Promise<{ already: boolean; item: ApprovalItem }> {
  const r = await fetch(`/api/approvals?project=${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claimRun: { id, force } }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "실행 기록 실패");
  return { already: !!j.already, item: j.item as ApprovalItem };
}

/** 최근 결정사항을 프롬프트 주입용 불릿 텍스트로 (최신 우선 최대 n개) */
export function decisionsBlock(items: DecisionItem[], n = 12): string {
  return items
    .slice(-n)
    .map((d) => `- ${d.text}`)
    .join("\n");
}
