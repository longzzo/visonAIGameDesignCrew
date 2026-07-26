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

/** 원장에서 한 항목을 뺀다 — 원장은 매 회의에 주입되므로 틀린 항목은 즉시 지워야 한다 */
export async function removeDecisionApi(project: string, text: string): Promise<void> {
  await fetch(`/api/decisions?project=${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remove: text }),
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

/** 🗂️ 오류함 — 재시도까지 실패한 게이트웨이 호출 (오너가 나중에 물어볼 수 있게 디스크에 보관) */
export interface FailureItem {
  id: string;
  ts: number;
  agentId: string;
  agentName: string;
  tag: string;
  phase?: string;
  attempts: number;
  error: string;
  prompt: string;
}

export async function listFailures(project: string): Promise<FailureItem[]> {
  try {
    const r = await fetch(`/api/failures?project=${encodeURIComponent(project)}`);
    if (!r.ok) return [];
    return (await r.json()).items ?? [];
  } catch {
    return [];
  }
}

export async function addFailureApi(project: string, item: Omit<FailureItem, "id" | "ts">): Promise<void> {
  try {
    await fetch(`/api/failures?project=${encodeURIComponent(project)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ add: item }),
    });
  } catch {
    /* 오류 기록 실패가 회의를 막으면 안 된다 */
  }
}

export async function clearFailuresApi(project: string): Promise<void> {
  await fetch(`/api/failures?project=${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clear: true }),
  });
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

/** 기각 항목인가 — 오너가 "하지 말라"고 판단한 것 */
export function isRejection(d: DecisionItem): boolean {
  return d.source === "rejection" || /^\(오너 기각\)/.test(d.text);
}

/**
 * 결정 원장을 프롬프트 주입용으로 만든다.
 *
 * 오너 실측 2026-07-26 (A-3·A-4):
 *   · v34.1로 확정된 강철이 브레스를 회의가 **4회** 재생산했다.
 *   · 2026-07-15 오너가 **기각**한 "밤 전환 예고"를 **2회** 재설계했다.
 *   · 카운터 위계 무력화·모바일 조작표 같은 명시적 금지를 3라운드 연속 위반했다.
 * 원인은 두 가지다 — ⓐ 확정본이 "그냥 결정 목록"에 섞여 재설계 대상처럼 보이고,
 * ⓑ **기각 원장이 컨텍스트에 아예 없었다**(반려는 어디에도 기록되지 않았다).
 *
 * 그래서 확정과 기각을 분리해 서로 다른 명령으로 제시한다. 기각 항목은 수가 적고
 * 가장 자주 위반되므로 **최신 n개 창에서 잘라내지 않고 전부** 넣는다.
 */
export function decisionsBlock(items: DecisionItem[], n = 12): string {
  const rejected = items.filter(isRejection);
  const decided = items.filter((d) => !isRejection(d)).slice(-n);
  const out: string[] = [];
  if (decided.length > 0) {
    out.push(
      [
        `[✅ 확정 사항 — 이미 결론이 난 것. 다시 설계하지 마라]`,
        `아래는 오너·팀이 확정한 내용이다. **재설계·재제안 금지.** 이견이 있으면 산출물 맨 끝에`,
        `"이의: <항목> — <근거>" 한 줄로만 적고, 본문은 확정본을 전제로 써라.`,
        ...decided.map((d) => `- ${d.text}`),
      ].join("\n")
    );
  }
  if (rejected.length > 0) {
    out.push(
      [
        `[🚫 기각 원장 — 오너가 하지 말라고 판단한 것. 다시 제안하지 마라]`,
        `아래 항목을 되살리거나, 이름만 바꿔 다시 설계하거나, 우회 구현하는 것 전부 금지다.`,
        ...rejected.map((d) => `- ${d.text.replace(/^\(오너 기각\)\s*/, "")}`),
      ].join("\n")
    );
  }
  return out.join("\n\n");
}
