export type BackupStatus = {
  projects: number;
  files: number;
  bytes: number;
  maxBytes: number;
};

export type RestoreReceipt = {
  ok: boolean;
  imported: Array<{ sourceId: string; id: string; copied: boolean }>;
  files: number;
  bytes: number;
  createdAt: string;
};

async function apiError(response: Response, fallback: string): Promise<Error> {
  try {
    const body = await response.json();
    return new Error(String(body?.error || fallback));
  } catch {
    return new Error(fallback);
  }
}

export async function getBackupStatus(): Promise<BackupStatus> {
  const response = await fetch("/api/backup/status", { cache: "no-store" });
  if (!response.ok) throw await apiError(response, "백업 상태를 확인하지 못했습니다.");
  const body = await response.json();
  return { projects: Number(body.projects || 0), files: Number(body.files || 0), bytes: Number(body.bytes || 0), maxBytes: Number(body.maxBytes || 0) };
}

function downloadName(response: Response): string {
  const disposition = response.headers.get("content-disposition") || "";
  const matched = disposition.match(/filename="([^"]+)"/i);
  return matched?.[1] || `VisionEngine-all-projects-${new Date().toISOString().slice(0, 10)}.vebackup`;
}

export async function downloadBackup(projectId = ""): Promise<void> {
  const query = projectId ? `?project=${encodeURIComponent(projectId)}` : "";
  const response = await fetch(`/api/backup/export${query}`, { cache: "no-store" });
  if (!response.ok) throw await apiError(response, "백업 파일을 만들지 못했습니다.");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = downloadName(response);
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

export async function restoreBackup(file: File): Promise<RestoreReceipt> {
  if (!file.name.toLowerCase().endsWith(".vebackup")) throw new Error(".vebackup 파일을 선택하세요.");
  if (file.size > 300 * 1024 * 1024) throw new Error("백업 파일은 300MB까지 복원할 수 있습니다.");
  const response = await fetch("/api/backup/import", {
    method: "POST",
    headers: { "Content-Type": "application/vnd.vision-engine.backup" },
    body: file,
  });
  if (!response.ok) throw await apiError(response, "백업을 복원하지 못했습니다.");
  return response.json();
}
