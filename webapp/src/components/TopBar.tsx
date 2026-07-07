import { useEffect, useState } from "react";
import { uiAlert, uiConfirm, uiPrompt } from "../lib/dialog";
import { estimateCost, fmtUsd, loadGuard, priceFor, saveGuard, type CostGuard } from "../lib/cost";
import { gateway } from "../lib/gateway";
import { useVE } from "../store";

/** 사용량·비용 패널 — 토큰/호출/추정 비용 + 비용 가드(10분 호출 한도) 설정 */
function UsagePanel({ onClose }: { onClose: () => void }) {
  const { usage, modelName } = useVE();
  const [guard, setGuard] = useState<CostGuard>(loadGuard());
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 2000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const price = priceFor(modelName);
  const cost = estimateCost(modelName, usage.input, usage.output);
  const win = gateway.callsIn10Min();
  const applyGuard = (g: CostGuard) => {
    setGuard(g);
    saveGuard(g);
  };

  return (
    <div className="doc-viewer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="doc-window usage-window">
        <div className="doc-head">
          <b>🪙 사용량 · 비용</b>
          <span className="dim" style={{ flex: 1, fontSize: 11.5 }}>
            이번 세션 기준 · 단가는 추정치 — 실제 청구는 제공자 대시보드가 정답입니다
          </span>
          <button className="btn small" onClick={onClose} title="닫기 (Esc)">
            ✕
          </button>
        </div>
        <div className="usage-body">
          <div className="usage-grid">
            <div className="usage-stat">
              <span className="dim">호출</span>
              <b>{usage.calls.toLocaleString()}회</b>
            </div>
            <div className="usage-stat">
              <span className="dim">입력 토큰</span>
              <b>
                {usage.input.toLocaleString()}
                {usage.estimated ? "≈" : ""}
              </b>
            </div>
            <div className="usage-stat">
              <span className="dim">출력 토큰</span>
              <b>
                {usage.output.toLocaleString()}
                {usage.estimated ? "≈" : ""}
              </b>
            </div>
            <div className="usage-stat">
              <span className="dim">추정 비용</span>
              <b>{fmtUsd(cost)}</b>
            </div>
          </div>
          <div className="usage-price dim">
            현재 모델 <b>{modelName}</b> → {price.label} (입력 ${price.inPrice}/1M · 출력 ${price.outPrice}/1M)
            {price.note ? ` — ${price.note}` : ""}
          </div>

          <div className="usage-guard">
            <div className="usage-guard-head">
              <b>🛑 비용 가드</b>
              <span className="dim">에이전트가 같은 작업을 무한 반복해도 지갑이 터지지 않게, 10분당 호출 수를 제한합니다</span>
            </div>
            <div className="usage-guard-row">
              <label>
                <input
                  type="checkbox"
                  checked={guard.enabled}
                  onChange={(e) => applyGuard({ ...guard, enabled: e.target.checked })}
                />
                가드 켜기
              </label>
              <label>
                10분당 최대{" "}
                <input
                  type="number"
                  min={10}
                  max={500}
                  value={guard.maxPer10Min}
                  onChange={(e) => applyGuard({ ...guard, maxPer10Min: Math.max(10, Number(e.target.value) || 60) })}
                  style={{ width: 64 }}
                />{" "}
                회
              </label>
              <span className={`usage-win ${win >= guard.maxPer10Min * 0.8 ? "warn" : ""}`}>
                최근 10분: <b>{win}</b>/{guard.maxPer10Min}회
              </span>
            </div>
            <div className="dim usage-guard-note">
              한도를 넘으면 새 호출을 차단하고 진행 중 회의를 자동 중단합니다. 참고: 개발팀 직접 작업(dev-task)은 단계
              상한(8스텝)으로 별도 보호됩니다.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TopBar() {
  const [usageOpen, setUsageOpen] = useState(false);
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
  const price = priceFor(modelName);
  const costLabel =
    price.inPrice === 0 && price.outPrice === 0
      ? /NVIDIA/i.test(price.label)
        ? "크레딧"
        : "$0"
      : fmtUsd(estimateCost(modelName, usage.input, usage.output));
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
  const switchView = (v: "orch" | "chat" | "office" | "data") => {
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
        <button className={view === "office" || view === "studio" ? "active" : ""} onClick={() => switchView("office")}>
          🏢 사무실
        </button>
        <button className={view === "orch" ? "active" : ""} onClick={() => switchView("orch")}>
          🗂️ 오케스트레이션
        </button>
        <button className={view === "chat" ? "active" : ""} onClick={() => switchView("chat")}>
          💬 채팅
        </button>
        <button className={view === "data" ? "active" : ""} onClick={() => switchView("data")} title="게임 데이터 파일(JSON/CSV) — 방치형 등 데이터 주도 게임의 밸런스·경제 테이블을 모아 편집">
          🧮 데이터
        </button>
      </nav>
      <div className="topbar-right">
        <span className="badge model-badge" title="현재 모델">
          🧠 {modelName}
        </span>
        <button className="badge usage-badge" onClick={() => setUsageOpen(true)} title="토큰 사용량·추정 비용·비용 가드 설정">
          🪙 {usage.calls}회 · {(usage.input + usage.output).toLocaleString()}tk{usage.estimated ? "≈" : ""} ·{" "}
          {costLabel}
        </button>
        <button className="health-light" onClick={() => void onHealthClick()} title={hTitle}>
          {hLight}
        </button>
        <span className="conn" title={connLabel}>
          <i style={{ background: connColor }} /> <span className="conn-label">{connLabel}</span>
        </span>
      </div>
      {usageOpen && <UsagePanel onClose={() => setUsageOpen(false)} />}
    </header>
  );
}
