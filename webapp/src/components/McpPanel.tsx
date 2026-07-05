import { useEffect, useState } from "react";
import { fetchMcp, reconnectMcp, callMcpTool, type McpServerStatus } from "../lib/mcp";

/**
 * MCP 허브 패널 — config/mcp.json에 등록된 도구 서버의 연결 상태와 도구 목록을 보여주고,
 * 도구를 직접 실행해볼 수 있다 (개발팀 에이전트가 v2.1b부터 이 도구들을 함수호출로 사용).
 */
import { AGENT_MAP } from "../lib/agents";

export function McpPanel({ onClose }: { onClose: () => void }) {
  const [servers, setServers] = useState<McpServerStatus[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tryTool, setTryTool] = useState<{ server: string; name: string } | null>(null);
  const [argText, setArgText] = useState("{}");
  const [result, setResult] = useState<string>("");
  const [running, setRunning] = useState(false);

  const load = async () => {
    setBusy(true);
    const { servers, assignments } = await fetchMcp();
    setServers(servers);
    setAssignments(assignments ?? {});
    setBusy(false);
  };
  useEffect(() => {
    void load();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doReconnect = async () => {
    setBusy(true);
    try {
      setServers(await reconnectMcp());
    } catch {
      await load();
    }
    setBusy(false);
  };

  const runTool = async () => {
    if (!tryTool) return;
    setRunning(true);
    setResult("");
    try {
      const args = JSON.parse(argText || "{}");
      const out = await callMcpTool(tryTool.server, tryTool.name, args);
      setResult((out.isError ? "⚠️ (오류) " : "") + out.text);
    } catch (e: any) {
      setResult("⚠️ " + String(e?.message ?? e));
    }
    setRunning(false);
  };

  const dot = (s: McpServerStatus["status"]) =>
    s === "ready" ? "🟢" : s === "connecting" || s === "pending" ? "🟡" : s === "error" ? "🔴" : "⚪";
  const totalTools = servers.reduce((n, s) => n + s.tools.length, 0);

  return (
    <div className="doc-viewer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="doc-window mcp-panel">
        <div className="doc-head">
          <div className="head-meta">
            <div className="head-name">🔌 MCP 허브 — 에이전트 도구 서버</div>
            <div className="head-role dim">
              config/mcp.json에 등록한 MCP 서버 · 연결된 도구 {totalTools}개 · 개발팀이 이 도구로 실제 파일·git·빌드에 관여합니다
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn small" onClick={() => void doReconnect()} disabled={busy}>
              {busy ? "…" : "🔄 재연결"}
            </button>
            <button className="btn small" onClick={onClose} title="닫기 (Esc)">
              ✕ 닫기
            </button>
          </div>
        </div>

        <div className="mcp-body">
          {servers.length === 0 && !busy && (
            <div className="empty-hint">
              등록된 MCP 서버가 없습니다. <code>config/mcp.json</code>의 서버를 <code>enabled: true</code>로 바꾸고 🔄 재연결을 누르세요.
            </div>
          )}
          {servers.map((s) => (
            <div key={s.id} className={`mcp-server st-${s.status}`}>
              <div className="mcp-server-head" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                <span>{dot(s.status)}</span>
                <b>{s.label}</b>
                <span className="dim">
                  {s.status === "ready"
                    ? `도구 ${s.tools.length}개`
                    : s.status === "disabled"
                      ? "비활성 (config에서 enabled:true)"
                      : s.status === "error"
                        ? "연결 실패"
                        : "연결 중…"}
                </span>
                {s.tools.length > 0 && <span className="mcp-caret">{expanded === s.id ? "▾" : "▸"}</span>}
              </div>
              {assignments[s.id]?.length > 0 && (
                <div className="mcp-assign">
                  담당:{" "}
                  {assignments[s.id].map((aid) => (
                    <span key={aid} className="mcp-assign-tag">
                      {AGENT_MAP[aid]?.emoji} {AGENT_MAP[aid]?.name ?? aid}
                    </span>
                  ))}
                </div>
              )}
              {s.error && <div className="mcp-error">{s.error}</div>}
              {expanded === s.id &&
                s.tools.map((t) => (
                  <div key={t.name} className="mcp-tool">
                    <div className="mcp-tool-name">
                      <code>{t.name}</code>
                      <button
                        className="btn tiny"
                        onClick={() => {
                          setTryTool({ server: s.id, name: t.name });
                          setArgText("{}");
                          setResult("");
                        }}
                      >
                        ▶ 실행
                      </button>
                    </div>
                    {t.description && <div className="mcp-tool-desc dim">{t.description}</div>}
                  </div>
                ))}
            </div>
          ))}
        </div>

        {tryTool && (
          <div className="mcp-try">
            <div className="mcp-try-head">
              <b>▶ {tryTool.server} · {tryTool.name}</b>
              <button className="btn tiny" onClick={() => setTryTool(null)}>
                닫기
              </button>
            </div>
            <textarea
              value={argText}
              onChange={(e) => setArgText(e.target.value)}
              placeholder='{"path": "README.md"}'
              rows={3}
              spellCheck={false}
            />
            <button className="btn small primary" onClick={() => void runTool()} disabled={running}>
              {running ? "실행 중…" : "실행"}
            </button>
            {result && <pre className="mcp-result">{result}</pre>}
          </div>
        )}
      </div>
    </div>
  );
}
