import { useVE } from "../store";

export function TopBar() {
  const { projectName, setProjectName, modelName, conn, usage, view, setView } = useVE();
  const connColor = conn === "connected" ? "var(--ok)" : conn === "connecting" ? "var(--warn)" : "var(--err)";
  const connLabel =
    conn === "connected" ? "게이트웨이 연결됨" : conn === "connecting" ? "연결 중…" : "연결 안 됨";

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">◮</span>
        <span className="brand-name">Vision Engine</span>
      </div>
      <input
        className="project-name"
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        title="프로젝트 이름 (클릭해서 수정)"
      />
      <nav className="view-tabs">
        <button className={view === "orch" ? "active" : ""} onClick={() => setView("orch")}>
          🗂️ 오케스트레이션
        </button>
        <button className={view === "chat" ? "active" : ""} onClick={() => setView("chat")}>
          💬 에이전트 채팅
        </button>
      </nav>
      <div className="topbar-right">
        <span className="badge model-badge" title="현재 모델">
          🧠 {modelName}
        </span>
        <span className="badge" title={`API 호출 ${usage.calls}회${usage.estimated ? " (일부 추정치)" : ""}`}>
          🪙 입력 {usage.input.toLocaleString()} / 출력 {usage.output.toLocaleString()}
          {usage.estimated ? "≈" : ""} · $0 (로컬)
        </span>
        <span className="conn" title={connLabel}>
          <i style={{ background: connColor }} /> {connLabel}
        </span>
      </div>
    </header>
  );
}
