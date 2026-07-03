import { useEffect, useRef, useState } from "react";
import { AGENT_MAP } from "../lib/agents";
import { useVE } from "../store";
import { Markdown } from "./Markdown";

/**
 * 지식 라이브러리 — 오너가 아는 기획 이론(재미 이론 등)을 제출하면
 * PM이 "이 스튜디오에 필요한가"를 검증하고, 승인된 것만 학습(저장)한다.
 * 학습된 지식은 해당 역할의 프롬프트에 요약본으로 주입된다.
 */
export function KnowledgeStudio({ onClose }: { onClose: () => void }) {
  const {
    knowledge,
    loadKnowledge,
    submitKnowledge,
    pendingKnowledge,
    approveKnowledge,
    dismissKnowledge,
    removeKnowledge,
  } = useVE();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadKnowledge();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pk = pendingKnowledge;
  const busy = pk?.status === "running";

  const agentLabel = (ids?: string[]) =>
    !ids || ids.includes("all")
      ? "전원"
      : ids.map((id) => AGENT_MAP[id]?.name ?? id).join(", ");

  return (
    <div className="doc-viewer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="doc-window art-studio">
        <div className="doc-head">
          <div className="head-meta">
            <div className="head-name">📚 지식 라이브러리</div>
            <div className="head-role dim">
              이론을 제출하면 PM이 필요성을 검증하고, 승인된 것만 학습해 해당 역할의 판단에 주입됩니다
            </div>
          </div>
          <button className="btn small" onClick={onClose} title="닫기 (Esc)">
            ✕ 닫기
          </button>
        </div>

        <div className="knowledge-form">
          <input
            className="knowledge-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder='지식 제목 — 예: "라프 코스터의 재미 이론", "훅 모델 (Hooked)"'
            disabled={busy}
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="이론 내용을 붙여넣으세요 (긴 글도 좋습니다 — PM이 실무용으로 압축합니다). 파일로 불러와도 됩니다."
            rows={5}
            disabled={busy}
          />
          <div className="knowledge-actions">
            <input
              ref={fileRef}
              type="file"
              accept=".md,.txt,.markdown"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  const reader = new FileReader();
                  reader.onload = () => {
                    setContent(String(reader.result ?? ""));
                    if (!title.trim()) setTitle(f.name.replace(/\.(md|txt|markdown)$/i, ""));
                  };
                  reader.readAsText(f);
                }
                e.target.value = "";
              }}
            />
            <button className="btn small" onClick={() => fileRef.current?.click()} disabled={busy}>
              📄 파일에서 불러오기
            </button>
            <button
              className="btn primary"
              disabled={busy || !title.trim() || content.trim().length < 50}
              onClick={() => void submitKnowledge(title.trim(), content.trim())}
              title="PM이 이 지식이 스튜디오에 필요한지 검증합니다"
            >
              {busy ? "PM 검증 중…" : "🎯 PM 검증 요청"}
            </button>
          </div>
        </div>

        {pk?.status === "running" && (
          <div className="art-phase">
            <span className="spinner" /> 🎯 PM이 이 지식의 필요성을 검토 중…
          </div>
        )}
        {pk?.status === "error" && <div className="art-phase error">⚠️ 검증 실패: {pk.error}</div>}
        {pk?.status === "rejected" && (
          <div className="verify-card" style={{ margin: "8px 14px" }}>
            <div className="verify-head">🎯 PM 판정 — 학습 불필요</div>
            <p className="dim">{pk.reason || "이 스튜디오의 업무와 직접적인 관련이 낮다고 판단했습니다."}</p>
            <div className="verify-actions">
              <button className="btn" onClick={dismissKnowledge}>
                확인
              </button>
            </div>
          </div>
        )}
        {pk?.status === "ready" && (
          <div className="verify-card" style={{ margin: "8px 14px" }}>
            <div className="verify-head">🎯 PM 판정 — 학습 권고</div>
            <p className="dim">{pk.reason}</p>
            <details className="verify-preview" open>
              <summary>압축 요약 (프롬프트에는 이것이 주입됩니다) · 적용: {agentLabel(pk.agents)}</summary>
              <Markdown text={pk.summary ?? ""} />
            </details>
            <div className="verify-actions">
              <button
                className="btn primary"
                onClick={() => {
                  void approveKnowledge().then(() => {
                    setTitle("");
                    setContent("");
                  });
                }}
              >
                ✅ 학습시키기
              </button>
              <button className="btn" onClick={dismissKnowledge}>
                ❌ 학습 안 함
              </button>
            </div>
          </div>
        )}

        <div className="doc-body">
          {knowledge.length === 0 && !pk && (
            <div className="empty-hint">
              아직 학습된 지식이 없습니다.
              <br />
              <span className="dim">재미 이론, 몰입 이론, 과금 심리학 등 알고 계신 이론을 위에 붙여넣어 보세요.</span>
            </div>
          )}
          {knowledge.map((k) => (
            <details key={k.ts} className="knowledge-item">
              <summary>
                <b>📖 {k.title}</b>
                <span className="dim"> · 적용: {agentLabel(k.agents)} · {new Date(k.ts).toLocaleDateString("ko-KR")}</span>
                <button
                  className="btn tiny"
                  onClick={(e) => {
                    e.preventDefault();
                    if (window.confirm(`"${k.title}" 지식을 잊게 할까요?`)) void removeKnowledge(k.ts);
                  }}
                >
                  🗑
                </button>
              </summary>
              <div className="knowledge-summary">
                <Markdown text={k.summary} />
              </div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
