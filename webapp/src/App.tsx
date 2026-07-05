import { useEffect, useState } from "react";
import { useVE } from "./store";
import { Onboarding, needsOnboarding } from "./components/Onboarding";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatPanel";
import { OrchestrationView } from "./components/OrchestrationView";
import { OfficeView } from "./components/OfficeView";
import { DataPanel } from "./components/DataPanel";
import { GddPanel } from "./components/GddPanel";
import { AgentProfile } from "./components/AgentProfile";
import { DialogHost } from "./components/DialogHost";
import { DiffViewer } from "./components/DiffViewer";
import { DocViewer } from "./components/DocViewer";
import { ArtStudio } from "./components/ArtStudio";

export default function App() {
  const {
    view,
    init,
    mobilePanel,
    setMobilePanel,
    profileAgent,
    conn,
    quotaSuspect,
    dismissQuota,
    switchToLocalModel,
    meetingDiffOpen,
    docViewer,
    artStudioOpen,
    setArtStudioOpen,
  } = useVE();

  const [onboard, setOnboard] = useState(false);
  useEffect(() => {
    void init();
    setOnboard(needsOnboarding());
  }, [init]);

  return (
    <div className="app">
      {onboard && <Onboarding onClose={() => setOnboard(false)} />}
      <TopBar />
      {conn !== "connected" && conn !== "idle" && (
        <div className="app-banner warn">
          🔌 게이트웨이 이벤트 연결이 끊겼습니다 — 자동 재연결 중… <span className="dim">(작업 실행은 계속 가능합니다. 모델 교체 직후라면 ~10초 뒤 붙습니다)</span>
        </div>
      )}
      {quotaSuspect && (
        <div className="app-banner err">
          🪙 클라우드 모델 오류: <span className="dim">{quotaSuspect}</span> — 크레딧 소진/요청 한도일 수 있습니다.
          <button className="btn tiny" onClick={() => void switchToLocalModel().catch(() => undefined)}>
            🔁 로컬 모델로 전환
          </button>
          <button className="btn tiny" onClick={dismissQuota}>
            닫기
          </button>
        </div>
      )}
      <div className={`app-body panel-${mobilePanel}`}>
        <Sidebar />
        <main className="main-panel">
          {view === "orch" ? (
            <OrchestrationView />
          ) : view === "office" ? (
            <OfficeView />
          ) : view === "data" ? (
            <DataPanel />
          ) : (
            <ChatPanel />
          )}
        </main>
        <GddPanel />
      </div>
      {profileAgent && <AgentProfile />}
      {meetingDiffOpen && <DiffViewer />}
      {docViewer && <DocViewer />}
      {artStudioOpen && <ArtStudio onClose={() => setArtStudioOpen(false)} />}
      <DialogHost />
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
