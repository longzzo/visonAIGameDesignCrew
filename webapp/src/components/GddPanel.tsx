import { useState } from "react";
import { AGENTS } from "../lib/agents";
import { useVE } from "../store";
import { Markdown } from "./Markdown";

function fmtTs(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

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
    gddVersions,
    loadGddVersions,
    gddPreview,
    previewGddVersion,
    closeGddPreview,
    restoreGdd,
  } = useVE();
  const [dragOver, setDragOver] = useState(false);
  const [showVersions, setShowVersions] = useState(false);

  const toggleVersions = () => {
    const next = !showVersions;
    setShowVersions(next);
    if (next) void loadGddVersions();
  };

  const onRestore = (ts: number) => {
    if (window.confirm(`${fmtTs(ts)} 버전으로 GDD를 되돌릴까요?\n(현재 버전도 히스토리에 남으므로 다시 되돌릴 수 있습니다)`)) {
      void restoreGdd(ts);
      setShowVersions(false);
    }
  };

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
            {gddPreview
              ? `과거 버전 미리보기 — ${fmtTs(gddPreview.ts)}`
              : gddMtime
                ? `갱신: ${new Date(gddMtime).toLocaleTimeString("ko-KR", { hour12: false })}`
                : "실시간 미리보기"}
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
              <button className={`btn tiny ${showVersions ? "primary" : ""}`} onClick={toggleVersions} title="버전 히스토리">
                🕘
              </button>
              <button className="btn tiny" onClick={() => setGddEditing(true)} disabled={!!gddPreview}>
                ✏️ 편집
              </button>
              <button className="btn tiny" onClick={() => void loadGdd()} title="파일에서 다시 읽기">
                🔄
              </button>
            </>
          )}
        </div>
      </div>

      {showVersions && (
        <div className="version-drawer">
          {gddVersions.length === 0 && <div className="dim">저장된 버전이 없습니다. GDD가 변경될 때마다 자동 저장됩니다.</div>}
          {gddVersions.map((v) => (
            <div key={v.ts} className={`version-item ${gddPreview?.ts === v.ts ? "active" : ""}`}>
              <button className="version-time" onClick={() => void previewGddVersion(v.ts)} title="이 버전 미리보기">
                🕘 {fmtTs(v.ts)} <span className="dim">({(v.size / 1024).toFixed(1)}KB)</span>
              </button>
              <button className="btn tiny" onClick={() => onRestore(v.ts)}>
                복원
              </button>
            </div>
          ))}
        </div>
      )}

      {gddPreview && (
        <div className="preview-banner">
          ⏪ 과거 버전을 보고 있습니다
          <button className="btn tiny primary" onClick={() => onRestore(gddPreview.ts)}>
            이 버전으로 복원
          </button>
          <button className="btn tiny" onClick={closeGddPreview}>
            현재로 돌아가기
          </button>
        </div>
      )}

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
          <Markdown text={gddPreview ? gddPreview.markdown : gdd || "_GDD를 불러오는 중…_"} />
        </div>
      )}
      {dragOver && <div className="drop-veil">여기에 놓으면 해당 에이전트의 GDD 섹션에 반영됩니다</div>}
    </aside>
  );
}
