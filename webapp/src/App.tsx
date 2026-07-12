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
import { ApprovalPanel } from "./components/ApprovalPanel";

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
    costGuardTrip,
    dismissCostGuard,
    meetingDiffOpen,
    docViewer,
    artStudioOpen,
    setArtStudioOpen,
    approvalsOpen,
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
      {costGuardTrip && (
        <div className="app-banner err">
          {costGuardTrip}
          <button className="btn tiny" onClick={dismissCostGuard}>
            닫기
          </button>
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
      {/* 마스터 GDD는 사이드 상주 대신 📄 GDD 탭에서만 — 오너 가독성 요청 (사이드 3번째 컬럼 제거) */}
      <div className={`app-body no-side-gdd panel-${mobilePanel} ${view === "office" || view === "studio" ? "office-full" : ""}`}>
        <Sidebar />
        <main className="main-panel">
          {view === "orch" ? (
            <OrchestrationView />
          ) : view === "office" || view === "studio" ? (
            // "studio" = 사무실 스튜디오의 별칭 — 첫 방문 기본 화면이 3D 스튜디오가 되도록
            <OfficeView />
          ) : view === "data" ? (
            <DataPanel />
          ) : view === "gdd" ? (
            <GddPanel full />
          ) : (
            <ChatPanel />
          )}
        </main>
      </div>
      {profileAgent && <AgentProfile />}
      {meetingDiffOpen && <DiffViewer />}
      {docViewer && <DocViewer />}
      {artStudioOpen && <ArtStudio onClose={() => setArtStudioOpen(false)} />}
      {approvalsOpen && <ApprovalPanel />}
      <DialogHost />
      {/* 모바일 전용 하단 탭 (900px 이하에서만 표시) */}
      <nav className="mobile-tabs">
        <button className={mobilePanel === "agents" ? "active" : ""} onClick={() => setMobilePanel("agents")}>
          👥 에이전트
        </button>
        <button className={mobilePanel === "work" ? "active" : ""} onClick={() => setMobilePanel("work")}>
          💼 작업
        </button>
        <button className={view === "gdd" ? "active" : ""} onClick={() => { useVE.getState().setView("gdd"); setMobilePanel("work"); }}>
          📄 GDD
        </button>
      </nav>
    </div>
  );
}
