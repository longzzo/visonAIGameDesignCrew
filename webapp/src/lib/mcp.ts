// MCP 허브 — 등록된 도구 서버 상태·도구 목록·실행

export interface McpTool {
  name: string;
  description: string;
  inputSchema?: unknown;
}
export interface McpServerStatus {
  id: string;
  label: string;
  enabled: boolean;
  status: "ready" | "connecting" | "error" | "disabled" | "pending";
  error: string | null;
  tools: McpTool[];
}
export interface McpFlatTool {
  server: string;
  name: string;
  description: string;
  inputSchema?: unknown;
}

export async function fetchMcp(): Promise<{ servers: McpServerStatus[]; tools: McpFlatTool[]; assignments?: Record<string, string[]> }> {
  try {
    const r = await fetch("/api/mcp");
    if (!r.ok) return { servers: [], tools: [] };
    return await r.json();
  } catch {
    return { servers: [], tools: [] };
  }
}

export async function reconnectMcp(): Promise<McpServerStatus[]> {
  const r = await fetch("/api/mcp/reconnect", { method: "POST" });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "MCP 재연결 실패");
  return j.servers as McpServerStatus[];
}

export async function getUnityDir(): Promise<string | null> {
  try {
    const r = await fetch("/api/mcp/unity");
    if (!r.ok) return null;
    return (await r.json()).dir ?? null;
  } catch {
    return null;
  }
}

export async function saveUnityDir(dir: string): Promise<{ dir: string; exists: boolean }> {
  const r = await fetch("/api/mcp/unity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dir }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "유니티 경로 저장 실패");
  return { dir: j.dir, exists: j.exists };
}

export async function callMcpTool(server: string, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const r = await fetch("/api/mcp/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ server, name, args }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "MCP 도구 실행 실패");
  return { isError: !!j.isError, text: j.text ?? "" };
}
