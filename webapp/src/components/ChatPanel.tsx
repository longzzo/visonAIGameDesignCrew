import { useEffect, useRef, useState } from "react";
import { AGENT_MAP, DEFAULT_REPORT_TOPIC } from "../lib/agents";
import { useVE } from "../store";
import { Markdown } from "./Markdown";

export function ChatPanel() {
  const {
    activeAgent,
    chats,
    chatBusy,
    sendChat,
    newChatSession,
    reflectToGdd,
    pendingVerify,
    requestPmVerify,
    approveVerify,
    rejectVerify,
    generateReport,
    reportBusy,
    feed,
    openProfile,
  } = useVE();
  const agent = AGENT_MAP[activeAgent];
  const msgs = chats[activeAgent] ?? [];
  const busy = chatBusy[activeAgent] ?? false;
  const rBusy = reportBusy[activeAgent] ?? false;
  const pv = pendingVerify[activeAgent];
  const [input, setInput] = useState("");
  /** "chat" = 오너와의 1:1 대화, "work" = 이 에이전트가 팀 안에서 한 일(피드 필터) */
  const [tab, setTab] = useState<"chat" | "work">("chat");
  const bottomRef = useRef<HTMLDivElement>(null);

  const WORK_LABEL: Record<string, string> = {
    draft: "초안",
    review: "동료 검토",
    revision: "수정본",
    summary: "통합/결론",
    talk: "협업 발언",
    instruction: "지시",
  };
  const workLog = feed.filter(
    (m) => m.from === activeAgent && ["draft", "review", "revision", "summary", "talk"].includes(m.kind)
  );

  const hasConclusion = msgs.some((m) => m.role === "assistant" && !m.error && m.text.trim());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length, msgs[msgs.length - 1]?.text?.length, pv?.status]);

  const submit = () => {
    const t = input.trim();
    if (!t || busy) return;
    setInput("");
    void sendChat(t);
  };

  return (
    <section className="chat-panel">
      <div className="panel-head">
        <button
          className="agent-emoji big as-btn"
          style={{ background: agent.color + "22", borderColor: agent.color + "55" }}
          onClick={() => openProfile(activeAgent)}
          title="프로필 열기 — 이 에이전트의 모델/API를 여기서 바꿉니다"
        >
          {agent.emoji}
        </button>
        <div className="head-meta">
          <div className="head-name">{agent.name}</div>
          <div className="head-role">{agent.role}</div>
        </div>
        <div className="chat-tabs">
          <button className={`doc-tab ${tab === "chat" ? "on" : ""}`} onClick={() => setTab("chat")} title="오너와의 1:1 대화">
            💬 대화
          </button>
          <button
            className={`doc-tab ${tab === "work" ? "on" : ""}`}
            onClick={() => setTab("work")}
            title="이 에이전트가 회의·협업에서 한 일만 모아 봅니다"
          >
            📜 작업 기록{workLog.length > 0 ? ` ${workLog.length}` : ""}
          </button>
        </div>
        {activeAgent !== "pm" && (
          <button
            className="btn small"
            disabled={busy || !hasConclusion || pv?.status === "running"}
            onClick={() => void requestPmVerify(activeAgent)}
            title="이 대화의 결론을 PM이 기존 기획과 대조해 검증합니다. 승인하셔야만 GDD에 반영되며, 반영 직전 버전은 자동 백업됩니다."
          >
            🧾 PM 검증 → GDD 반영
          </button>
        )}
        <button
          className="btn small"
          disabled={busy || rBusy}
          onClick={() => {
            const topic = window.prompt(
              `${agent.name}에게 요청할 보고서 주제를 입력하세요.\n(현재 GDD 전체를 근거로 정식 명세서 수준의 문서를 작성해 보고서함에 저장합니다)`,
              DEFAULT_REPORT_TOPIC[activeAgent] ?? `${agent.sectionTitle} 명세서`
            );
            if (topic?.trim()) void generateReport(activeAgent, topic.trim());
          }}
          title="현재 GDD를 근거로 정식 보고서(명세서)를 작성해 프로젝트 보고서함에 저장합니다. 아트 명세서, 개발 명세서, 일정표 등."
        >
          {rBusy ? (
            <>
              <span className="spinner" /> 작성 중…
            </>
          ) : (
            "📋 보고서"
          )}
        </button>
        <button className="btn small" onClick={() => newChatSession(activeAgent)} title="새 컨텍스트로 대화 시작">
          🧹 새 대화
        </button>
      </div>

      {tab === "work" ? (
        <div className="chat-scroll">
          {workLog.length === 0 && (
            <div className="empty-hint">
              아직 작업 기록이 없습니다.
              <br />
              <span className="dim">오케스트레이션·협업 세션에서 {agent.name}가 한 발언과 산출물이 여기에 모입니다.</span>
            </div>
          )}
          {workLog.map((m) => (
            <div key={m.id} className="work-entry">
              <div className="work-head">
                <span className={`feed-kind k-${m.kind}`}>{WORK_LABEL[m.kind] ?? m.kind}</span>
                {m.to && AGENT_MAP[m.to] && (
                  <span className="dim">→ {AGENT_MAP[m.to].emoji} {AGENT_MAP[m.to].name}</span>
                )}
                <span className="feed-time">
                  {new Date(m.ts).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}
                </span>
              </div>
              <Markdown text={m.text} />
            </div>
          ))}
        </div>
      ) : (
        <>
      <div className="chat-scroll">
        {msgs.length === 0 && (
          <div className="empty-hint">
            {agent.emoji} {agent.name}에게 기획 질문을 보내보세요.
            <br />
            <span className="dim">
              논의가 끝나면 <b>🧾 PM 검증</b>을 눌러 결론을 검증받고, 승인하면 GDD에 반영됩니다.
            </span>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={`bubble ${m.role} ${m.error ? "error" : ""}`}>
            {m.role === "assistant" ? <Markdown text={m.text || "…"} /> : <div className="user-text">{m.text}</div>}
            {m.role === "assistant" && !m.streaming && !m.error && m.text && (
              <div className="bubble-actions">
                <button
                  className="btn tiny"
                  title={`검증 없이 바로 GDD "${agent.sectionTitle}" 섹션에 반영 (직전 버전 자동 백업)`}
                  onClick={() => void reflectToGdd(activeAgent, m.text)}
                >
                  📌 바로 반영
                </button>
                <span
                  className="drag-hint"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/x-ve-agent", activeAgent);
                    e.dataTransfer.setData("text/plain", m.text);
                  }}
                  title="오른쪽 GDD 패널로 드래그해서 반영"
                >
                  ⠿ 드래그
                </span>
              </div>
            )}
            {m.streaming && <span className="cursor">▍</span>}
          </div>
        ))}
        {busy && msgs[msgs.length - 1]?.role === "user" && (
          <div className="bubble assistant pending">
            <span className="spinner" /> {agent.name}가 작성 중… <span className="dim">(로컬 모델은 수십 초 걸릴 수 있음)</span>
          </div>
        )}

        {/* PM 검증 → 오너 승인 카드 */}
        {pv?.status === "running" && (
          <div className="bubble assistant pending">
            <span className="spinner" /> 🎯 PM이 결론을 기존 기획과 대조 검증 중…
          </div>
        )}
        {pv?.status === "error" && (
          <div className="bubble assistant error">
            ⚠️ PM 검증 실패: {pv.error}{" "}
            <button className="btn tiny" onClick={() => void requestPmVerify(activeAgent)}>
              재시도
            </button>
          </div>
        )}
        {pv?.status === "ready" && (
          <div className="verify-card">
            <div className="verify-head">🎯 PM 검증 의견</div>
            <Markdown text={pv.verdict || "(의견 없음)"} />
            <details className="verify-preview">
              <summary>📄 반영안 미리보기 ("{agent.sectionTitle}" 섹션 갱신본)</summary>
              <Markdown text={pv.finalText || ""} />
            </details>
            <div className="verify-actions">
              <button className="btn primary" onClick={() => void approveVerify(activeAgent)}>
                ✅ 승인 — GDD 반영 (직전 버전 자동 백업)
              </button>
              <button className="btn" onClick={() => rejectVerify(activeAgent)}>
                ❌ 반영 안 함
              </button>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="composer">
        <textarea
          value={input}
          placeholder={`${agent.name}에게 메시지… (Enter 전송, Shift+Enter 줄바꿈)`}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
        />
        <button className="btn primary" onClick={submit} disabled={busy || !input.trim()}>
          {busy ? "응답 대기…" : "전송 ➤"}
        </button>
      </div>
        </>
      )}
    </section>
  );
}
