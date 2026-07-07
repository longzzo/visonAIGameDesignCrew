import { useEffect, useRef } from "react";
import { AGENTS, AGENT_MAP } from "../lib/agents";
import { zoneOfAgent } from "./Office3D";
import { useVE, type FeedMsg } from "../store";

/**
 * 라이브 프로세스 보드 — 전사 워크스트림 현황 (Sample 추구미의 3열 보드).
 *   · 좌: 진행 중인 목표(오케스트레이션 카드 = 스트림)
 *   · 중: 에이전트 레인(전 직원의 현재 상태)
 *   · 우: 활동 피드(에이전트 대화 피드)
 * 오케스트레이션 뷰의 데이터를 그대로 읽는 읽기 전용 창 — 기능 대체가 아니라 조망.
 */

const KIND_LABEL: Record<FeedMsg["kind"], string> = {
  request: "요청",
  instruction: "지시",
  draft: "초안",
  review: "검토",
  revision: "수정",
  summary: "통합",
  status: "",
  error: "오류",
  talk: "협업",
};

function who(id: string) {
  if (id === "user") return { name: "오너", emoji: "👤", color: "#9aa5b5" };
  if (id === "system") return { name: "시스템", emoji: "🛠️", color: "#9aa5b5" };
  const a = AGENT_MAP[id];
  return a ? { name: a.name, emoji: a.emoji, color: a.color } : { name: id, emoji: "❔", color: "#9aa5b5" };
}

export function WorkstreamBoard({ onClose }: { onClose: () => void }) {
  const {
    cards,
    feed,
    agentStatus,
    meetingMembers,
    orchRunning,
    stopOrch,
    setView,
    orchBaseline,
    gdd,
    setMeetingDiffOpen,
    livePeek,
  } = useVE();
  const feedEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ block: "end" });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.length]);

  const cardList = Object.values(cards);
  const done = cardList.filter((c) => c.state === "done").length;
  const running = cardList.filter((c) => c.state === "running").length;
  const errs = cardList.filter((c) => c.state === "error").length;
  const goal = [...feed].reverse().find((m) => m.kind === "request");

  const laneStatus = (id: string): { text: string; cls: string } => {
    if (meetingMembers.includes(id)) return { text: "회의 참석", cls: "run" };
    const st = agentStatus[id] ?? "idle";
    if (st === "running") {
      const phase = cards[id]?.phase;
      return { text: phase || "작업 중", cls: "run" };
    }
    if (st === "done") return { text: "완료", cls: "done" };
    if (st === "error") return { text: "오류", cls: "err" };
    return { text: "대기", cls: "idle" };
  };

  return (
    <div className="doc-viewer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="doc-window board-window">
        <div className="doc-head">
          <span className="board-live">● 라이브 프로세스</span>
          <b className="board-title">전사 워크스트림 현황</b>
          <span className="board-stats">
            <i className="bs run">진행 {running}</i>
            <i className="bs done">완료 {done}</i>
            <i className="bs err">오류 {errs}</i>
          </span>
          {orchRunning && (
            <button className="btn small danger" onClick={stopOrch}>
              ⏹ 중단
            </button>
          )}
          <button
            className="btn small"
            onClick={() => {
              setView("orch");
              onClose();
            }}
            title="지시·옵션·상세 카드를 다루는 오케스트레이션 화면"
          >
            🗂️ 상세 화면
          </button>
          {orchBaseline !== null && orchBaseline !== gdd && (
            <button className="btn small primary" onClick={() => setMeetingDiffOpen(true)} title="이번 회의가 GDD를 어떻게 바꿨는지">
              🔍 변경 확인
            </button>
          )}
          <button className="btn small" onClick={onClose} title="닫기 (Esc)">
            ✕
          </button>
        </div>

        <div className="board-cols">
          {/* 진행 중인 목표 (스트림) */}
          <div className="board-col">
            <div className="board-col-title dim">진행 중인 목표</div>
            {goal ? (
              <div className="board-goal">
                <div className="board-goal-t">◎ {goal.text.slice(0, 90)}</div>
                <div className="dim">스트림 {cardList.length} · 완료 {done}</div>
              </div>
            ) : (
              <div className="dim board-empty">아직 목표가 없습니다 — 아래 커맨드바에 지시를 입력하세요.</div>
            )}
            {cardList.map((c) => {
              const a = AGENT_MAP[c.agentId];
              return (
                <div key={c.agentId} className={`board-stream st-${c.state}`}>
                  <span className="bs-ic">
                    {c.state === "done" ? "✓" : c.state === "running" ? "●" : c.state === "error" ? "✗" : "○"}
                  </span>
                  <span className="bs-name">
                    {a?.emoji} {a?.name}
                  </span>
                  <span className="bs-phase dim">{c.state === "running" ? c.phase ?? "작업 중" : c.state === "error" ? (c.error ?? "").slice(0, 40) : c.reflected ? "GDD 반영됨" : ""}</span>
                </div>
              );
            })}
          </div>

          {/* 에이전트 레인 */}
          <div className="board-col">
            <div className="board-col-title dim">워크로드 (에이전트 레인)</div>
            {AGENTS.map((a) => {
              const s = laneStatus(a.id);
              const z = zoneOfAgent(a.id);
              const peek = agentStatus[a.id] === "running" ? (livePeek[a.id] ?? "").slice(-38) : "";
              return (
                <div key={a.id} className="board-lane">
                  <span className="o3d-dot" style={{ background: a.color }} />
                  <span className="bl-name">{a.name}</span>
                  <span className={`bl-st ${s.cls}`}>{s.text}</span>
                  <span className="bl-zone dim">{z.label}</span>
                  {peek && <span className="bl-peek dim">…{peek}</span>}
                </div>
              );
            })}
          </div>

          {/* 활동 피드 */}
          <div className="board-col feedcol">
            <div className="board-col-title dim">활동 피드</div>
            {feed.length === 0 && <div className="dim board-empty">활동이 여기에 실시간으로 쌓입니다.</div>}
            {feed.slice(-60).map((m) => {
              const f = who(m.from);
              const t = m.to ? who(m.to) : null;
              return (
                <div key={m.id} className={`board-feed k-${m.kind}`}>
                  <span className="bf-who" style={{ color: f.color }}>
                    {f.emoji} {f.name}
                  </span>
                  {t && <span className="dim"> → {t.name}</span>}
                  {KIND_LABEL[m.kind] && <span className="bf-kind">{KIND_LABEL[m.kind]}</span>}
                  <div className="bf-text">{m.text.replace(/[#*>`]/g, "").slice(0, 150)}</div>
                </div>
              );
            })}
            <div ref={feedEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
