import { useEffect } from "react";
import { useVE } from "./store";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatPanel";
import { OrchestrationView } from "./components/OrchestrationView";
import { GddPanel } from "./components/GddPanel";

export default function App() {
  const { view, init, mobilePanel, setMobilePanel } = useVE();

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="app">
      <TopBar />
      <div className={`app-body panel-${mobilePanel}`}>
        <Sidebar />
        <main className="main-panel">{view === "orch" ? <OrchestrationView /> : <ChatPanel />}</main>
        <GddPanel />
      </div>
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
