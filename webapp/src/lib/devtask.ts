// 개발 작업 — 다이렉트 프로바이더 SSE 스트림 소비

export interface DevStep {
  kind: "task" | "say" | "tool" | "toolResult" | "done" | "error" | "phase";
  text?: string;
  server?: string;
  name?: string;
  args?: unknown;
  isError?: boolean;
  final?: string;
  agent?: string;
}

async function consumeSSE(res: Response, onStep: (s: DevStep) => void): Promise<void> {
  if (!res.body) throw new Error("스트림 없음");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const p of parts) {
      const line = p.trim();
      if (!line.startsWith("data:")) continue;
      try {
        onStep(JSON.parse(line.slice(5).trim()) as DevStep);
      } catch {
        /* 파싱 실패 무시 */
      }
    }
  }
}

/** 개발 회의 — 리드 구현 → 코드 리뷰 → 테스트 검증을 순차 스트리밍 */
export async function runDevMeeting(leadId: string, task: string, onStep: (s: DevStep) => void): Promise<void> {
  const res = await fetch("/api/dev-meeting", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leadId, task }),
  });
  await consumeSSE(res, onStep);
}

/** 개발 에이전트에게 태스크를 주고 진행 단계를 콜백으로 스트리밍 */
export async function runDevTask(
  agentId: string,
  task: string,
  onStep: (s: DevStep) => void,
  model?: string
): Promise<void> {
  const res = await fetch("/api/dev-task", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, task, model }),
  });
  await consumeSSE(res, onStep);
}
