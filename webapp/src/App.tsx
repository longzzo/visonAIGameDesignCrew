import { useEffect } from "react";
import { useVE } from "./store";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatPanel";
import { OrchestrationView } from "./components/OrchestrationView";
import { OfficeView } from "./components/OfficeView";
import { GddPanel } from "./components/GddPanel";
import { AgentProfile } from "./components/AgentProfile";

export default function App() {
  const { view, init, mobilePanel, setMobilePanel, profileAgent } = useVE();

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="app">
      <TopBar />
      <div className={`app-body panel-${mobilePanel}`}>
        <Sidebar />
        <main className="main-panel">
          {view === "orch" ? <OrchestrationView /> : view === "office" ? <OfficeView /> : <ChatPanel />}
        </main>
        <GddPanel />
      </div>
      {profileAgent && <AgentProfile />}
      {/* 모바일 전용 하단 탭 (900px 이하에서만 표시) */}
      <nav className="mobile-tabs">
        <button className={mobilePanel === "agents" ? "active" : ""} onClick={() => setMobilePanel("agents")}>
          👥 에이전트
        </button>
        <button className={mobilePanel === "work" ? "active" : ""} onClick={() => setMobilePanel("work")}>
          💼 작업
        </button>
        <button className={mobilePanel === "gdd" ? "active" : ""} onClick={() => setMobilePanel("gdd")}>
          📄 GDD
        </button>
      </nav>
    </div>
  );
}
