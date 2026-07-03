// 시스템 헬스 — 게이트웨이/Ollama/SD/볼트 생존 여부 (신호등)

export interface SystemHealth {
  gateway: boolean;
  ollama: boolean;
  sd: boolean;
  vault: boolean;
  remoteReadonly: boolean;
  ts: number;
}

export async function getSystemHealth(): Promise<SystemHealth | null> {
  try {
    const r = await fetch("/api/health");
    if (!r.ok) return null;
    return (await r.json()) as SystemHealth;
  } catch {
    // 이 API 자체가 안 뜨면 웹 서버(Vite)가 죽은 것 — 호출측에서 페이지가 이미 죽어 있음
    return null;
  }
}

/** 게이트웨이 재시작 (PC 로컬 전용) — 약 10초 뒤 자동 재연결된다 */
export async function restartGatewayViaApi(): Promise<void> {
  const r = await fetch("/api/health", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ restart: "gateway" }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "게이트웨이 재시작 실패");
}
