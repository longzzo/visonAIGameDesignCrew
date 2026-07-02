import { useEffect, useState } from "react";
import { AGENT_MAP } from "../lib/agents";
import { AgentSprite } from "./AgentSprite";
import { ArtStudio } from "./ArtStudio";
import { DocViewer } from "./DocViewer";
import { useVE, type FeedMsg } from "../store";

/**
 * 보이는 사무실 v1 — 8명의 에이전트가 책상에 앉아 일하는 모습.
 * 상태(대기/작업/완료/오류)가 캐릭터 애니메이션으로, 최근 발언이 말풍선으로 보인다.
 * 오케스트레이션 이벤트 스트림(feed)을 그대로 시각 레이어에 연결한 것.
 */

const BUBBLE_TTL = 3 * 60 * 1000; // 말풍선 유지 시간 3분

function statusLabel(status: string, phase?: string): string {
  if (status === "running") return phase ?? "작업 중…";
  if (status === "done") return "작업 완료";
  if (status === "error") return "문제 발생";
  return "대기 중";
}

function Desk({ agentId, big }: { agentId: string; big?: boolean }) {
  const { agentStatus, cards, feed, selectAgent } = useVE();
  const a = AGENT_MAP[agentId];
  const st = agentStatus[agentId] ?? "idle";
  const phase = cards[agentId]?.phase;

  // 이 에이전트의 최근 발언 (지시/초안/검토/수정/통합)
  let last: FeedMsg | undefined;
  for (const m of feed) if (m.from === agentId) last = m;
  const fresh = last && Date.now() - last.ts < BUBBLE_TTL;
  const showBubble = st === "running" || fresh;
  const bubbleText =
    st === "running" && !fresh
      ? "…"
      : last
        ? last.text.replace(/[#*>`]/g, "").replace(/\s+/g, " ").slice(0, 90) + (last.text.length > 90 ? "…" : "")
        : "";

  return (
    <div className={`desk st-${st} ${big ? "big" : ""}`} onClick={() => selectAgent(agentId)} title={`${a.name} — 클릭하면 대화`}>
      {showBubble && bubbleText && (
        <div className="speech" style={{ borderColor: a.color + "66" }}>
          {bubbleText}
        </div>
      )}
      <div className="office-avatar" style={{ background: a.color + "26", borderColor: a.color + "88" }}>
        <AgentSprite id={agentId} size={big ? 52 : 42} />
        {st === "running" && <span className="zzz work">⚡</span>}
        {st === "idle" && <span className="zzz">💤</span>}
        {st === "done" && <span className="zzz ok">✅</span>}
        {st === "error" && <span className="zzz err">💢</span>}
      </div>
      <div className="desk-table">
        <span className="monitor">🖥️</span>
        {st === "running" && (
          <span className="typing">
            <i />
            <i />
            <i />
          </span>
        )}
      </div>
      <div className="nameplate" style={{ borderColor: a.color + "55" }}>
        {a.name}
      </div>
      <div className={`desk-status ds-${st}`}>{statusLabel(st, phase)}</div>
    </div>
  );
}

/** 아트 인턴 미니 책상 — 아트 디렉터 바로 아래, 클릭하면 아트 스튜디오 */
function InternDesk({ onOpen }: { onOpen: () => void }) {
  const { artBusy, artStatus, artPhase } = useVE();
  const connected = artStatus?.connected === true;
  return (
    <div
      className={`desk intern ${artBusy ? "st-running" : connected ? "st-done" : "st-idle"}`}
      onClick={onOpen}
      title={connected ? "아트 인턴 — 클릭하면 아트 스튜디오" : "아트 인턴 (Stable Diffusion 미연결) — 클릭해서 설치 안내 보기"}
    >
      {artBusy && artPhase && <div className="speech">{artPhase.slice(0, 40)}</div>}
      <div className="office-avatar" style={{ background: "#e879f926", borderColor: "#e879f955" }}>
        <span className="intern-face">🖌️</span>
        {artBusy ? <span className="zzz work">⚡</span> : connected ? <span className="zzz ok">✅</span> : <span className="zzz">💤</span>}
      </div>
      <div className="nameplate" style={{ borderColor: "#e879f955" }}>
        아트 인턴
      </div>
      <div className={`desk-status ${artBusy ? "ds-running" : "ds-idle"}`}>
        {artBusy ? "그리는 중…" : connected ? "SD 대기 중" : "SD 미연결"}
      </div>
    </div>
  );
}

export function OfficeView() {
  const { projects, activeProject, gddMtime, orchRunning, reports } = useVE();
  const projectName = projects.find((p) => p.id === activeProject)?.name ?? "";
  // 말풍선 TTL 갱신용 틱
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const [docViewer, setDocViewer] = useState<null | "gdd" | "reports">(null);
  const [studioOpen, setStudioOpen] = useState(false);

  const row1 = ["scenario", "gameplay", "systems", "uiux", "td"];
  const row2 = ["balance", "bm", "scheduler"];

  return (
    <section className="office-view">
      <div className="office-header">
        <span className="office-sign">🏢 Vision Engine 스튜디오</span>
        <span className="office-project">{projectName}</span>
        {orchRunning && <span className="office-live">● 회의 진행 중</span>}
        <span className="office-doc-tabs">
          <button className="btn small" onClick={() => setDocViewer("gdd")} title="마스터 GDD를 큰 화면으로">
            📄 GDD
          </button>
          <button className="btn small" onClick={() => setDocViewer("reports")} title="보고서함을 큰 화면으로">
            📋 보고서{reports.length > 0 ? ` ${reports.length}` : ""}
          </button>
        </span>
      </div>
      <div className="office-room">
        <div className="office-wall">
          <button className="gdd-board" onClick={() => setDocViewer("gdd")} title="GDD를 큰 화면으로 보기">
            📄 마스터 GDD 보드
            <span className="dim">{gddMtime ? `갱신 ${new Date(gddMtime).toLocaleTimeString("ko-KR", { hour12: false })}` : "대기"}</span>
          </button>
        </div>
        <div className="office-row pm-row">
          <Desk agentId="pm" big />
        </div>
        <div className="office-row">
          {row1.map((id) => (
            <Desk key={id} agentId={id} />
          ))}
        </div>
        <div className="office-row">
          {row2.map((id) => (
            <Desk key={id} agentId={id} />
          ))}
          <div className="art-corner">
            <Desk agentId="visual" />
            <InternDesk onOpen={() => setStudioOpen(true)} />
          </div>
        </div>
        <div className="office-floor" />
      </div>
      <div className="office-hint dim">
        캐릭터 클릭 → 1:1 대화 · 🖌️ 아트 인턴 클릭 → 컨셉 아트 스튜디오 · 상단 📄/📋 → 큰 화면 문서 뷰어
      </div>

      {docViewer && <DocViewer tab={docViewer} onTab={setDocViewer} onClose={() => setDocViewer(null)} />}
      {studioOpen && <ArtStudio onClose={() => setStudioOpen(false)} />}
    </section>
  );
}
