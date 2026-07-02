import { useEffect, useRef, useState } from "react";
import { AGENT_MAP, SPECIALISTS } from "../lib/agents";
import { useVE, type FeedMsg } from "../store";
import { Markdown } from "./Markdown";

function Elapsed({ from, to }: { from?: number; to?: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!from || to) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [from, to]);
  if (!from) return null;
  const sec = Math.round(((to ?? Date.now()) - from) / 1000);
  return <span className="elapsed">{sec}s</span>;
}

const KIND_LABEL: Record<FeedMsg["kind"], string> = {
  request: "요청",
  instruction: "지시",
  draft: "초안",
  review: "검토",
  revision: "수정본",
  summary: "통합",
  status: "",
  error: "",
};

function who(id: string): { name: string; emoji: string; color: string } {
  if (id === "user") return { name: "오너", emoji: "👤", color: "#9aa5b5" };
  if (id === "system") return { name: "시스템", emoji: "🛠️", color: "#9aa5b5" };
  const a = AGENT_MAP[id];
  return a ? { name: a.name, emoji: a.emoji, color: a.color } : { name: id, emoji: "❔", color: "#9aa5b5" };
}

/** 말풍선 하나 — 긴 내용은 접어서 표시 */
function FeedBubble({ m }: { m: FeedMsg }) {
  const f = who(m.from);
  const t = m.to ? who(m.to) : null;
  const time = new Date(m.ts).toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit" });

  if (m.kind === "status" || m.kind === "error") {
    return (
      <div className={`feed-status ${m.kind === "error" ? "error" : ""}`}>
        {m.from !== "system" && (
          <span className="feed-status-from" style={{ color: f.color }}>
            {f.emoji} {f.name}
          </span>
        )}
        <span>{m.text}</span>
        <span className="feed-time">{time}</span>
      </div>
    );
  }

  const long = m.text.length > 350;
  const isUser = m.from === "user";
  return (
    <div className={`feed-msg ${isUser ? "from-user" : ""}`}>
      <span className="feed-avatar" style={{ background: f.color + "22", borderColor: f.color + "66" }}>
        {f.emoji}
      </span>
      <div className="feed-body" style={{ borderColor: f.color + "44" }}>
        <div className="feed-head">
          <b style={{ color: f.color }}>{f.name}</b>
          {t && (
            <span className="feed-to">
              → {t.emoji} {t.name}
            </span>
          )}
          {KIND_LABEL[m.kind] && <span className={`feed-kind k-${m.kind}`}>{KIND_LABEL[m.kind]}</span>}
          <span className="feed-time">{time}</span>
        </div>
        {long ? (
          <details className="feed-long">
            <summary>
              <span className="feed-preview">{m.text.slice(0, 180).replace(/\n/g, " ")}…</span>
              <span className="dim"> (펼치기, {m.text.length.toLocaleString()}자)</span>
            </summary>
            <Markdown text={m.text} />
          </details>
        ) : (
          <Markdown text={m.text} />
        )}
      </div>
    </div>
  );
}

export function OrchestrationView() {
  const {
    orchRequest,
    setOrchRequest,
    selected,
    toggleSelected,
    concurrency,
    setConcurrency,
    autoReflect,
    setAutoReflect,
    crossReview,
    setCrossReview,
    orchRunning,
    startOrch,
    stopOrch,
    cards,
    feed,
    clearFeed,
    reflectToGdd,
  } = useVE();
  const bottomRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const [stickBottom, setStickBottom] = useState(true);

  useEffect(() => {
    if (stickBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed.length, stickBottom]);

  const cardList = ["pm", ...SPECIALISTS.map((a) => a.id)].filter((id) => cards[id]).map((id) => cards[id]);

  return (
    <section className="orch-view">
      <div className="orch-form">
        <textarea
          value={orchRequest}
          onChange={(e) => setOrchRequest(e.target.value)}
          placeholder={'기획 요청을 입력하세요. 예: "고양이들이 우주 정거장을 운영하는 모바일 방치형 게임"'}
          rows={2}
          disabled={orchRunning}
        />
        <div className="orch-options">
          <div className="chips">
            {SPECIALISTS.map((a) => (
              <button
                key={a.id}
                className={`chip ${selected[a.id] ? "on" : ""}`}
                style={selected[a.id] ? { borderColor: a.color, color: a.color } : undefined}
                onClick={() => toggleSelected(a.id)}
                disabled={orchRunning}
                title={a.role}
              >
                {a.emoji} {a.name.replace(" 디자이너", "").replace(" 라이터", "").replace(" 전략가", "").replace(" 디렉터", "")}
              </button>
            ))}
          </div>
          <div className="orch-controls">
            <label title="동료 에이전트가 초안을 검토하고, 작성자가 수정해 확정 (호출 수 3배)">
              <input type="checkbox" checked={crossReview} onChange={(e) => setCrossReview(e.target.checked)} disabled={orchRunning} />
              교차 검토
            </label>
            <label>
              <input type="checkbox" checked={autoReflect} onChange={(e) => setAutoReflect(e.target.checked)} />
              GDD 자동 반영
            </label>
            <label title="로컬 GPU(8GB)에서는 1을 권장">
              동시{" "}
              <select value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} disabled={orchRunning}>
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </label>
            {orchRunning ? (
              <button className="btn danger" onClick={stopOrch}>
                ⏹ 중단
              </button>
            ) : (
              <button className="btn primary" onClick={() => void startOrch()} disabled={!orchRequest.trim()}>
                🚀 시작
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 진행 상태 스트립 */}
      {cardList.length > 0 && (
        <div className="status-strip">
          {cardList.map((c) => {
            const a = AGENT_MAP[c.agentId];
            return (
              <div key={c.agentId} className={`strip-item ${c.state}`} title={c.error ?? c.phase ?? ""}>
                <span className="strip-emoji">{a.emoji}</span>
                <span className="strip-name">{a.name.split(" ")[0]}</span>
                {c.state === "running" && <span className="spinner" />}
                {c.state === "done" && <span className="strip-ok">✓</span>}
                {c.state === "error" && <span className="strip-bad">✗</span>}
                {(c.state === "queued" || c.state === "pending") && <span className="dim">·</span>}
                {c.phase && <span className="strip-phase">{c.phase}</span>}
                <Elapsed from={c.startedAt} to={c.endedAt} />
                {c.state === "done" && !c.reflected && (
                  <button className="btn tiny" onClick={() => void reflectToGdd(c.agentId, c.output)} title="GDD에 반영">
                    📌
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 에이전트 대화 피드 */}
      <div
        className="feed-scroll"
        ref={feedRef}
        onScroll={() => {
          const el = feedRef.current;
          if (!el) return;
          setStickBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
        }}
      >
        {feed.length === 0 && (
          <div className="empty-hint">
            요청을 입력하고 <b>🚀 시작</b>을 누르면 PM과 에이전트들이
            <br />
            지시 → 초안 → 동료 검토 → 수정 → 통합을 <b>대화로 주고받는 과정</b>이 여기에 표시됩니다.
          </div>
        )}
        {feed.map((m) => (
          <FeedBubble key={m.id} m={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      {feed.length > 0 && !orchRunning && (
        <div className="feed-foot">
          <button className="btn tiny" onClick={clearFeed} title="이 프로젝트의 대화 기록을 지웁니다">
            🧹 피드 비우기
          </button>
          <span className="dim">피드는 프로젝트별로 자동 저장됩니다 ({feed.length}건)</span>
        </div>
      )}
    </section>
  );
}
