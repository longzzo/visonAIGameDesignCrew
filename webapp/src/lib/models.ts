// AI 모델 프로바이더(로컬 Ollama / GitHub Models / NVIDIA NIM) 조회·키 등록·전환
// 실제 변경은 Vite 미들웨어(/api/models)가 ~/.openclaw/openclaw.json 을 수정하고
// 게이트웨이를 재시작하는 방식으로 반영된다.

export interface ModelOption {
  id: string; // 예: "github/openai/gpt-5-mini"
  label: string;
  note?: string;
}

export interface ModelsInfo {
  current: string;
  providers: { ollama: boolean; github: boolean; nvidia: boolean };
  options: ModelOption[];
}

export async function getModelsInfo(): Promise<ModelsInfo> {
  const r = await fetch("/api/models");
  if (!r.ok) throw new Error(`모델 정보 조회 실패 (${r.status})`);
  return (await r.json()) as ModelsInfo;
}

/** 프로바이더 API 키 등록 — 저장 후 게이트웨이가 자동 재시작된다 */
export async function registerModelKey(provider: "github" | "nvidia", key: string): Promise<void> {
  const r = await fetch("/api/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ registerKey: { provider, key } }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "키 등록 실패");
}

/** 전 에이전트의 모델 전환 — 게이트웨이가 자동 재시작된다 */
export async function switchModel(model: string): Promise<void> {
  const r = await fetch("/api/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "모델 전환 실패");
}
