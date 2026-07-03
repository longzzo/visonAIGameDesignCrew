// 아트 인턴 — 로컬 Stable Diffusion(A1111 호환 API) 브리지 입출력

export interface ArtImage {
  ts: number;
  prompt: string;
  negative?: string;
  /** 오너가 입력한 원래 요청 (한국어) */
  request?: string;
}

export interface ArtStatus {
  connected: boolean;
  url: string;
}

export async function getArtStatus(): Promise<ArtStatus> {
  try {
    const r = await fetch("/api/art/status");
    return (await r.json()) as ArtStatus;
  } catch {
    return { connected: false, url: "" };
  }
}

export async function listArt(project: string): Promise<ArtImage[]> {
  try {
    const r = await fetch(`/api/art?project=${encodeURIComponent(project)}`);
    if (!r.ok) return [];
    return (await r.json()).images ?? [];
  } catch {
    return [];
  }
}

export async function generateArtImage(
  project: string,
  prompt: string,
  negative: string,
  request: string
): Promise<number> {
  const r = await fetch(`/api/art?project=${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, negative, request }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "이미지 생성 실패");
  return j.ts as number;
}

export async function deleteArtImage(project: string, ts: number): Promise<void> {
  await fetch(`/api/art?project=${encodeURIComponent(project)}&ts=${ts}`, { method: "DELETE" });
}

export function artFileUrl(project: string, ts: number): string {
  return `/api/art/file?project=${encodeURIComponent(project)}&ts=${ts}`;
}

/* ── 사무실 커스텀 배경 (아트 인턴이 그리는 스튜디오 인테리어) ── */

export interface OfficeBgMeta {
  ts: number;
  prompt: string;
  request?: string;
}

export async function getOfficeBg(): Promise<OfficeBgMeta | null> {
  try {
    const r = await fetch("/api/office-bg");
    if (!r.ok) return null;
    return (await r.json()).custom ?? null;
  } catch {
    return null;
  }
}

export async function generateOfficeBgImage(prompt: string, negative: string, request: string): Promise<number> {
  const r = await fetch("/api/office-bg", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, negative, request }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "배경 생성 실패");
  return j.ts as number;
}
