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
