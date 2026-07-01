import { useEffect, useRef, useState } from "react";
import { AGENT_MAP } from "../lib/agents";
import { useVE } from "../store";
import { Markdown } from "./Markdown";

export function ChatPanel() {
  const { activeAgent, chats, chatBusy, sendChat, newChatSession, reflectToGdd } = useVE();
  const agent = AGENT_MAP[activeAgent];
  const msgs = chats[activeAgent] ?? [];
  const busy = chatBusy[activeAgent] ?? false;
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length, msgs[msgs.length - 1]?.text?.length]);

  const submit = () => {
    const t = input.trim();
    if (!t || busy) return;
    setInput("");
    void sendChat(t);
  };

  return (
    <section className="chat-panel">
      <div className="panel-head">
        <span className="agent-emoji big" style={{ background: agent.color + "22", borderColor: agent.color + "55" }}>
          {agent.emoji}
        </span>
        <div className="head-meta">
          <div className="head-name">{agent.name}</div>
          <div className="head-role">{agent.role}</div>
        </div>
        <button className="btn small" onClick={() => newChatSession(activeAgent)} title="새 컨텍스트로 대화 시작">
          🧹 새 대화
        </button>
      </div>

      <div className="chat-scroll">
        {msgs.length === 0 && (
          <div className="empty-hint">
            {agent.emoji} {agent.name}에게 기획 질문을 보내보세요.
            <br />
            <span className="dim">예: "수집형 RPG의 코어 루프 제안해줘"</span>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={`bubble ${m.role} ${m.error ? "error" : ""}`}>
            {m.role === "assistant" ? <Markdown text={m.text || "…"} /> : <div className="user-text">{m.text}</div>}
            {m.role === "assistant" && !m.streaming && !m.error && m.text && (
              <div className="bubble-actions">
                <button
                  className="btn tiny"
                  title={`GDD "${agent.sectionTitle}" 섹션에 반영`}
                  onClick={() => void reflectToGdd(activeAgent, m.text)}
                >
                  📌 GDD 반영
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
    </section>
  );
}
