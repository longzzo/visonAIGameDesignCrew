export interface UnityPreviewStatus {
  ready: boolean;
  projectDir: string | null;
  projectExists: boolean;
  buildDir: string | null;
  configuredBuild: string | null;
  updatedAt: number;
  reason: string;
  previewUrl: string | null;
}

export async function getUnityPreviewStatus(): Promise<UnityPreviewStatus> {
  const response = await fetch("/api/unity-preview/status", { cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(body?.error || "Unity 미리보기 상태를 확인할 수 없습니다.");
  return body as UnityPreviewStatus;
}

export async function saveUnityWebglDir(dir: string): Promise<UnityPreviewStatus> {
  const response = await fetch("/api/unity-preview/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dir }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(body?.error || "WebGL 빌드 경로를 저장할 수 없습니다.");
  return body as UnityPreviewStatus;
}

export async function useUnityAsCodexWorkdir(dir: string): Promise<void> {
  const response = await fetch("/api/readiness", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "set-codex-workdir", dir }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(body?.error || "Codex 작업 폴더를 Unity 프로젝트로 설정할 수 없습니다.");
}
