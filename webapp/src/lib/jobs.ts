export interface RecoverableJob {
  id: string;
  status: "interrupted" | "failed";
  request: string;
  poolIds: string[];
  autoRoute: boolean;
  updatedAt: number;
  error?: string;
}

export async function createOrchestrationJob(project: string, input: Omit<RecoverableJob, "id" | "status" | "updatedAt">): Promise<string> {
  const response = await fetch(`/api/jobs?project=${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`작업 체크포인트 생성 실패 (${response.status})`);
  return (await response.json()).job.id;
}

export async function finishOrchestrationJob(project: string, id: string, status: "completed" | "failed" | "stopped", error?: string): Promise<void> {
  const response = await fetch(`/api/jobs?project=${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status, error }),
  });
  if (!response.ok) throw new Error(`작업 체크포인트 갱신 실패 (${response.status})`);
}

export async function heartbeatOrchestrationJob(project: string, id: string): Promise<void> {
  const response = await fetch(`/api/jobs?project=${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status: "running" }),
  });
  if (!response.ok) throw new Error(`작업 체크포인트 heartbeat 실패 (${response.status})`);
}

export async function loadRecoverableJob(project: string): Promise<RecoverableJob | null> {
  const response = await fetch(`/api/jobs?project=${encodeURIComponent(project)}`);
  if (!response.ok) return null;
  return (await response.json()).job ?? null;
}
