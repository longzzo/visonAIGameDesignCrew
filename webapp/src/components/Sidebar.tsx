import { AGENTS } from "../lib/agents";
import { useVE } from "../store";

const STATUS_LABEL: Record<string, string> = {
  idle: "대기",
  running: "작업 중",
  done: "완료",
  error: "오류",
};

export function Sidebar() {
  const {
    agentStatus,
    activeAgent,
    selectAgent,
    view,
    conn,
    connDetail,
    reconnect,
    agentHealth,
    healthRunning,
    healthCheck,
  } = useVE();

  const healthDone = Object.keys(agentHealth).length;
  const healthOk = Object.values(agentHealth).filter((h) => h.ok).length;

  return (
    <aside className="sidebar">
      <div className="sidebar-title">에이전트</div>
      <ul className="agent-list">
        {AGENTS.map((a) => {
          const st = agentStatus[a.id] ?? "idle";
          const active = view === "chat" && activeAgent === a.id;
          const health = agentHealth[a.id];
          return (
            <li
              key={a.id}
              className={`agent-item ${active ? "active" : ""}`}
              onClick={() => selectAgent(a.id)}
              title={a.role}
            >
              <span className="agent-emoji" style={{ background: a.color + "22", borderColor: a.color + "55" }}>
                {a.emoji}
              </span>
              <span className="agent-meta">
                <span className="agent-name">{a.name}</span>
                <span className="agent-role">{a.role}</span>
              </span>
              {health && (
                <span
                  className={`health-mark ${health.ok ? "ok" : "bad"}`}
                  title={health.ok ? `응답 ${Math.round(health.ms / 1000)}초: ${health.reply ?? ""}` : health.error}
                >
                  {health.ok ? "✓" : "✗"}
                </span>
              )}
              <span className={`status-dot st-${st}`} title={STATUS_LABEL[st]} />
            </li>
          );
        })}
      </ul>
      <div className="sidebar-foot">
        <button className="btn small" onClick={() => void healthCheck()} disabled={healthRunning}>
          {healthRunning ? (
            <>
              <span className="spinner" /> 점검 중… ({healthDone}/{AGENTS.length})
            </>
          ) : healthDone > 0 ? (
            `🩺 전원 점검 (${healthOk}/${healthDone} 정상) — 다시`
          ) : (
            "🩺 에이전트 전원 점검"
          )}
        </button>
        {conn !== "connected" && (
          <button className="btn small" onClick={() => void reconnect()}>
            🔌 게이트웨이 재연결
          </button>
        )}
        {conn === "error" && <div className="conn-hint">{connDetail}</div>}
        <a className="webchat-link" href="http://127.0.0.1:18789" target="_blank" rel="noreferrer">
          OpenClaw 기본 WebChat 열기 ↗
        </a>
      </div>
    </aside>
  );
}
