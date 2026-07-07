// 직원 채용/퇴사 클라이언트 API — 서버(/api/hire)가 OpenClaw 설정에 에이전트를
// 추가·제거하고 게이트웨이를 재시작한다. 채용된 직원 메타는 config/custom-agents.json에 영속.

export interface HireInfo {
  id: string;
  name: string;
  emoji: string;
  role: string;
  /** 배치 부서 (zones의 존 id: plan/dev/biz/art/qa) */
  zone: string;
  color: string;
  /** 이 직원이 담당하는 GDD 섹션 번호 (12부터 증가) */
  section: number;
}

export interface HireRequest {
  id: string;
  name: string;
  emoji: string;
  role: string;
  zone: string;
  persona?: string;
}

export async function listHires(): Promise<HireInfo[]> {
  try {
    const r = await fetch("/api/hire");
    const j = await r.json();
    return j?.ok && Array.isArray(j.hires) ? j.hires : [];
  } catch {
    return [];
  }
}

export async function hireAgentApi(req: HireRequest): Promise<HireInfo> {
  const r = await fetch("/api/hire", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new Error(j?.error || `채용 실패 (HTTP ${r.status})`);
  return j.hire as HireInfo;
}

export async function fireAgentApi(id: string): Promise<void> {
  const r = await fetch("/api/hire", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fire: id }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new Error(j?.error || `퇴사 처리 실패 (HTTP ${r.status})`);
}
