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
import { FailurePanel } from "./components/FailurePanel";
import { NaverPanel } from "./components/NaverPanel";
import { DeckPanel } from "./components/DeckPanel";
import { DeliverPanel } from "./components/DeliverPanel";
import { FundPanel } from "./components/FundPanel";
import { LedgerPanel } from "./components/LedgerPanel";

/**
 * 연결 끊김 배너 — **무엇이** 끊겼는지 구분한다.
 *
 * 오너 신고 2026-07-29: "게이트웨이 이벤트 연결이 끊겼습니다 — 자동 재연결 중"이 계속 떠 있고
 * 아무리 기다려도 복구되지 않았다. 확인해보니 **게이트웨이(18789)는 멀쩡했고 VE 앱 서버(5199)가
 * 죽어 있었다**(netstat: LISTENING 없음, 앱이 SYN_SENT만 반복).
 *
 * 게이트웨이 WebSocket은 Vite의 `/gateway-ws` 프록시를 지나가므로, **앱 서버가 죽으면 증상이
 * "게이트웨이 끊김"으로 나타난다** — 원인을 정반대로 지목하는 셈이다. 게다가 이 경우엔
 * 자동 재연결이 영원히 성공하지 못한다(붙을 서버 자체가 없다). 그래서 안내가 아니라 오진이었다.
 *
 * 그래서 앱 서버를 직접 찔러 보고, 죽었으면 그렇게 말하고 복구 방법을 알려준다.
 */
function ConnBanner() {
  const [serverDown, setServerDown] = useState(false);
  useEffect(() => {
    let alive = true;
    const probe = async () => {
      try {
        // 앱 서버(Vite)가 직접 응답하는 엔드포인트 — 게이트웨이를 거치지 않는다
        const r = await fetch("/api/projects", { cache: "no-store" });
        if (alive) setServerDown(!r.ok);
      } catch {
        if (alive) setServerDown(true);
      }
    };
    void probe();
    const t = setInterval(probe, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (serverDown) {
    return (
      <div className="app-banner err">
        🚫 <b>VE 앱 서버(:5199)가 응답하지 않습니다</b> — 게이트웨이가 아니라 <b>웹 서버</b>가 내려간 상태라{" "}
        <b>자동 재연결로는 복구되지 않습니다.</b>{" "}
        <span className="dim">터미널에서 vision-engine/webapp 폴더의 `npm run dev`를 다시 실행한 뒤 이 창을 새로고침하세요.</span>
      </div>
    );
  }
  return (
    <div className="app-banner warn">
      🔌 게이트웨이 이벤트 연결이 끊겼습니다 — 자동 재연결 중…{" "}
      <span className="dim">(작업 실행은 계속 가능합니다. 모델 교체 직후라면 ~10초 뒤 붙습니다)</span>
    </div>
  );
}

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
    deadModels,
    dismissCostGuard,
    meetingDiffOpen,
    docViewer,
    artStudioOpen,
    setArtStudioOpen,
    approvalsOpen,
    failuresOpen,
    naverOpen,
    setNaverOpen,
    deckOpen,
    deliverOpen,
    setDeliverOpen,
    fundOpen,
    setFundOpen,
    ledgerOpen,
    setLedgerOpen,
    setDeckOpen,
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
      {conn !== "connected" && conn !== "idle" && <ConnBanner />}
      {deadModels.length > 0 && (
        <div className="app-banner err">
          🚫 <b>배정된 AI 모델을 제공자가 더 이상 서비스하지 않습니다</b> — <code>{deadModels.join(", ")}</code>.{" "}
          이 모델을 쓰는 에이전트는 <b>모든 호출이 실패</b>합니다(410). 좌측 <b>AI 모델</b>에서 다른 모델로 바꾸세요.
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
      {failuresOpen && <FailurePanel />}
      {naverOpen && <NaverPanel onClose={() => setNaverOpen(false)} />}
      {deckOpen && <DeckPanel onClose={() => setDeckOpen(false)} />}
      {ledgerOpen && <LedgerPanel onClose={() => setLedgerOpen(false)} />}
      {deliverOpen && <DeliverPanel onClose={() => setDeliverOpen(false)} />}
      {fundOpen && <FundPanel onClose={() => setFundOpen(false)} />}
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
