import { uiAlert, uiConfirm, uiPrompt } from "../lib/dialog";
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
    health,
    restartGatewayAction,
  } = useVE();
  const connColor = conn === "connected" ? "var(--ok)" : conn === "connecting" ? "var(--warn)" : "var(--err)";
  const connLabel =
    conn === "connected" ? "게이트웨이 연결됨" : conn === "connecting" ? "연결 중…" : "연결 안 됨";
  const current = projects.find((p) => p.id === activeProject);

  // 시스템 신호등 — 전부 정상 🟢 / 일부 🟡 / 핵심(게이트웨이) 죽음 🔴
  const hItems = health
    ? [
        { name: "게이트웨이", ok: health.gateway, core: true },
        { name: "Ollama(로컬 모델)", ok: health.ollama, core: false },
        { name: "SD(아트 인턴)", ok: health.sd, core: false },
        { name: "옵시디안 볼트", ok: health.vault, core: false },
      ]
    : [];
  const hBad = hItems.filter((i) => !i.ok);
  const hLight = !health ? "⚪" : hBad.some((i) => i.core) ? "🔴" : hBad.length > 0 ? "🟡" : "🟢";
  const hTitle = !health
    ? "시스템 상태 확인 중…"
    : hBad.length === 0
      ? "모든 구성요소 정상"
      : `문제: ${hBad.map((i) => i.name).join(", ")} — 클릭하면 게이트웨이 재시작`;

  const onHealthClick = async () => {
    if (!health || hBad.length === 0) return;
    if (!health.gateway) {
      const ok = await uiConfirm("게이트웨이가 응답하지 않습니다", {
        message: "지금 재시작할까요? (~10초, 진행 중인 에이전트 호출은 끊깁니다)",
        confirmLabel: "🔄 재시작",
      });
      if (ok) {
        await restartGatewayAction().catch((e) => uiAlert("재시작 실패", String(e?.message ?? e)));
      }
      return;
    }
    await uiAlert(
      "시스템 상태",
      hItems.map((i) => `${i.ok ? "✅" : "❌"} ${i.name}`).join("\n") +
        (!health.sd ? "\n\nSD는 ArtIntern-SD.bat 또는 런처로 켤 수 있습니다." : "")
    );
  };

  const onCreate = async () => {
    const name = await uiPrompt("새 프로젝트 이름", { defaultValue: "새 게임 프로젝트" });
    if (name?.trim()) void createProjectAction(name.trim());
  };
  const onRename = async () => {
    const name = await uiPrompt("프로젝트 이름 변경", { defaultValue: current?.name ?? "" });
    if (name?.trim()) void renameProjectAction(name.trim());
  };
  const onDelete = async () => {
    if (!current) return;
    if (orchRunning) {
      await uiAlert("삭제 불가", "오케스트레이션이 진행 중입니다. 끝난 뒤 삭제하세요.");
      return;
    }
    const ok = await uiConfirm(`"${current.name}" 프로젝트를 삭제할까요?`, {
      message: "프로젝트는 휴지통(workspace/.trash)으로 이동합니다 — 실수라면 파일 탐색기에서 복구할 수 있습니다.",
      confirmLabel: "🗑 삭제",
      danger: true,
    });
    if (ok) void deleteProjectAction(current.id);
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
        <button className="btn tiny" onClick={() => void onCreate()} title="새 프로젝트">
          ＋
        </button>
        <button className="btn tiny" onClick={() => void onRename()} title="이름 변경">
          ✏️
        </button>
        <button className="btn tiny danger-hover" onClick={() => void onDelete()} title="프로젝트 삭제 (휴지통으로 이동)">
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
        <button className="health-light" onClick={() => void onHealthClick()} title={hTitle}>
          {hLight}
        </button>
        <span className="conn" title={connLabel}>
          <i style={{ background: connColor }} /> <span className="conn-label">{connLabel}</span>
        </span>
      </div>
    </header>
  );
}
