import { useEffect } from "react";
import { useVE } from "./store";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatPanel";
import { OrchestrationView } from "./components/OrchestrationView";
import { GddPanel } from "./components/GddPanel";

export default function App() {
  const { view, init } = useVE();

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="app">
      <TopBar />
      <div className="app-body">
        <Sidebar />
        <main className="main-panel">{view === "orch" ? <OrchestrationView /> : <ChatPanel />}</main>
        <GddPanel />
      </div>
    </div>
  );
}
