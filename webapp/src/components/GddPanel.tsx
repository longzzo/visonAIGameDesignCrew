import { useState } from "react";
import { AGENTS } from "../lib/agents";
import { useVE } from "../store";
import { Markdown } from "./Markdown";

export function GddPanel() {
  const {
    gdd,
    gddMtime,
    gddEditing,
    gddDraft,
    gddSaving,
    setGddEditing,
    setGddDraft,
    saveGddDraft,
    loadGdd,
    reflectToGdd,
  } = useVE();
  const [dragOver, setDragOver] = useState(false);

  const scrollToSection = (prefix: string) => {
    const container = document.querySelector(".gdd-content");
    if (!container) return;
    const heads = container.querySelectorAll("h2");
    for (const h of heads) {
      if (h.textContent?.trim().startsWith(prefix.replace("## ", ""))) {
        h.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
  };

  return (
    <aside
      className={`gdd-panel ${dragOver ? "drag-over" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-ve-agent")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const agentId = e.dataTransfer.getData("application/x-ve-agent");
        const text = e.dataTransfer.getData("text/plain");
        if (agentId && text) void reflectToGdd(agentId, text);
      }}
    >
      <div className="panel-head">
        <div className="head-meta">
          <div className="head-name">📄 마스터 GDD</div>
          <div className="head-role dim">
            {gddMtime ? `갱신: ${new Date(gddMtime).toLocaleTimeString("ko-KR", { hour12: false })}` : "실시간 미리보기"}
          </div>
        </div>
        <div className="gdd-tools">
          {gddEditing ? (
            <>
              <button className="btn tiny primary" disabled={gddSaving} onClick={() => void saveGddDraft()}>
                {gddSaving ? "저장 중…" : "💾 저장"}
              </button>
              <button className="btn tiny" onClick={() => setGddEditing(false)}>
                취소
              </button>
            </>
          ) : (
            <>
              <button className="btn tiny" onClick={() => setGddEditing(true)}>
                ✏️ 편집
              </button>
              <button className="btn tiny" onClick={() => void loadGdd()} title="파일에서 다시 읽기">
                🔄
              </button>
            </>
          )}
        </div>
      </div>

      <div className="section-chips">
        {AGENTS.map((a) => (
          <button key={a.id} className="chip mini" onClick={() => scrollToSection(a.section)} title={a.name}>
            {a.emoji} {a.sectionTitle}
          </button>
        ))}
      </div>

      {gddEditing ? (
        <textarea className="gdd-editor" value={gddDraft} onChange={(e) => setGddDraft(e.target.value)} spellCheck={false} />
      ) : (
        <div className="gdd-content">
          <Markdown text={gdd || "_GDD를 불러오는 중…_"} />
        </div>
      )}
      {dragOver && <div className="drop-veil">여기에 놓으면 해당 에이전트의 GDD 섹션에 반영됩니다</div>}
    </aside>
  );
}
