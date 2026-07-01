import { useEffect, useState } from "react";
import { AGENT_MAP, SPECIALISTS } from "../lib/agents";
import { useVE } from "../store";
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

const STATE_LABEL: Record<string, string> = {
  pending: "대기",
  queued: "대기열",
  running: "진행 중",
  done: "완료",
  error: "실패",
};

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
    orchRunning,
    startOrch,
    stopOrch,
    cards,
    orchLog,
    reflectToGdd,
  } = useVE();

  const cardList = ["pm", ...SPECIALISTS.map((a) => a.id)]
    .filter((id) => cards[id])
    .map((id) => cards[id]);
  const anyRunning = Object.values(cards).some((c) => c.state === "running");

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
            <label title="로컬 GPU(8GB)에서는 1을 권장">
              동시 실행{" "}
              <select value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} disabled={orchRunning}>
                <option value={1}>1 (안정)</option>
                <option value={2}>2</option>
              </select>
            </label>
            <label>
              <input type="checkbox" checked={autoReflect} onChange={(e) => setAutoReflect(e.target.checked)} />
              GDD 자동 반영
            </label>
            {orchRunning ? (
              <button className="btn danger" onClick={stopOrch}>
                ⏹ 중단
              </button>
            ) : (
              <button className="btn primary" onClick={() => void startOrch()} disabled={!orchRequest.trim()}>
                🚀 오케스트레이션 시작
              </button>
            )}
          </div>
        </div>
      </div>

      {cardList.length > 0 && (
        <div className={`flow-strip ${anyRunning ? "flowing" : ""}`}>
          <span className="flow-node pm">🎯 PM</span>
          <span className="flow-line" />
          <span className="flow-label">{anyRunning ? "에이전트 작업 분배 중…" : "대기"}</span>
          <span className="flow-line rev" />
          <span className="flow-node">📄 GDD</span>
        </div>
      )}

      <div className="cards-grid">
        {cardList.length === 0 && (
          <div className="empty-hint">
            요청을 입력하고 <b>오케스트레이션 시작</b>을 누르면
            <br />
            선택한 에이전트들이 각자 파트를 맡아 작업하는 과정이 카드로 표시됩니다.
          </div>
        )}
        {cardList.map((c) => {
          const a = AGENT_MAP[c.agentId];
          return (
            <div key={c.agentId} className={`orch-card ${c.state}`} style={{ borderTopColor: a.color }}>
              <div className="card-head">
                <span className="agent-emoji" style={{ background: a.color + "22", borderColor: a.color + "55" }}>
                  {a.emoji}
                </span>
                <span className="card-name">{a.name}</span>
                <span className={`state-badge st-${c.state}`}>
                  {c.state === "running" && <span className="spinner" />}
                  {STATE_LABEL[c.state]}
                </span>
                <Elapsed from={c.startedAt} to={c.endedAt} />
              </div>
              {c.instruction && c.state !== "queued" && c.state !== "pending" && (
                <details className="card-inst">
                  <summary>📨 PM의 지시 보기</summary>
                  <pre>{c.instruction}</pre>
                </details>
              )}
              {c.state === "done" && (
                <>
                  <details className="card-output" open={false}>
                    <summary>산출물 보기 ({c.output.length.toLocaleString()}자)</summary>
                    <Markdown text={c.output} />
                  </details>
                  <div className="card-actions">
                    {c.reflected ? (
                      <span className="reflected">✅ GDD 반영됨 → {a.sectionTitle}</span>
                    ) : (
                      <button className="btn tiny" onClick={() => void reflectToGdd(c.agentId, c.output)}>
                        📌 GDD 반영
                      </button>
                    )}
                    <span
                      className="drag-hint"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/x-ve-agent", c.agentId);
                        e.dataTransfer.setData("text/plain", c.output);
                      }}
                    >
                      ⠿ 드래그
                    </span>
                  </div>
                </>
              )}
              {c.state === "error" && <div className="card-error">⚠️ {c.error}</div>}
              {(c.state === "queued" || c.state === "pending") && (
                <div className="card-waiting dim">
                  {c.agentId === "pm" ? "전문 에이전트 완료 후 통합 예정" : "차례를 기다리는 중"}
                </div>
              )}
              {c.state === "running" && <div className="card-waiting">모델이 작성 중…</div>}
            </div>
          );
        })}
      </div>

      {orchLog.length > 0 && (
        <details className="orch-log" open>
          <summary>실행 로그</summary>
          <pre>{orchLog.join("\n")}</pre>
        </details>
      )}
    </section>
  );
}
