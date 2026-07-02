import { useVE } from "../store";

export function TopBar() {
  const {
    projects,
    activeProject,
    setActiveProject,
    createProjectAction,
    renameProjectAction,
    deleteProjectAction,
    modelName,
    conn,
    usage,
    view,
    setView,
    setMobilePanel,
    orchRunning,
  } = useVE();
  const connColor = conn === "connected" ? "var(--ok)" : conn === "connecting" ? "var(--warn)" : "var(--err)";
  const connLabel =
    conn === "connected" ? "게이트웨이 연결됨" : conn === "connecting" ? "연결 중…" : "연결 안 됨";
  const current = projects.find((p) => p.id === activeProject);

  const onCreate = () => {
    const name = window.prompt("새 프로젝트 이름을 입력하세요", "새 게임 프로젝트");
    if (name?.trim()) void createProjectAction(name.trim());
  };
  const onRename = () => {
    const name = window.prompt("프로젝트 이름 변경", current?.name ?? "");
    if (name?.trim()) void renameProjectAction(name.trim());
  };
  const onDelete = () => {
    if (!current) return;
    if (orchRunning) {
      window.alert("오케스트레이션이 진행 중입니다. 끝난 뒤 삭제하세요.");
      return;
    }
    if (
      window.confirm(
        `"${current.name}" 프로젝트를 삭제할까요?\nGDD와 프로젝트 데이터가 디스크에서 완전히 삭제됩니다 (되돌릴 수 없음).`
      )
    ) {
      void deleteProjectAction(current.id);
    }
  };
  const switchView = (v: "orch" | "chat" | "office") => {
    setView(v);
    setMobilePanel("work");
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">◮</span>
        <span className="brand-name">Vision Engine</span>
      </div>
      <div className="project-ctl" title="게임 프로젝트 전환/관리">
        <select value={activeProject} onChange={(e) => void setActiveProject(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button className="btn tiny" onClick={onCreate} title="새 프로젝트">
          ＋
        </button>
        <button className="btn tiny" onClick={onRename} title="이름 변경">
          ✏️
        </button>
        <button className="btn tiny danger-hover" onClick={onDelete} title="프로젝트 삭제 (GDD 포함)">
          🗑
        </button>
      </div>
      <nav className="view-tabs">
        <button className={view === "orch" ? "active" : ""} onClick={() => switchView("orch")}>
          🗂️ 오케스트레이션
        </button>
        <button className={view === "chat" ? "active" : ""} onClick={() => switchView("chat")}>
          💬 에이전트 채팅
        </button>
        <button className={view === "office" ? "active" : ""} onClick={() => switchView("office")}>
          🏢 사무실
        </button>
      </nav>
      <div className="topbar-right">
        <span className="badge model-badge" title="현재 모델">
          🧠 {modelName}
        </span>
        <span className="badge usage-badge" title={`API 호출 ${usage.calls}회${usage.estimated ? " (일부 추정치)" : ""}`}>
          🪙 입력 {usage.input.toLocaleString()} / 출력 {usage.output.toLocaleString()}
          {usage.estimated ? "≈" : ""} · $0 (로컬)
        </span>
        <span className="conn" title={connLabel}>
          <i style={{ background: connColor }} /> <span className="conn-label">{connLabel}</span>
        </span>
      </div>
    </header>
  );
}
