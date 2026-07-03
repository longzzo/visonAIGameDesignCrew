import { useState } from "react";
import { AGENTS, AGENT_MAP } from "../lib/agents";
import { uiConfirm } from "../lib/dialog";
import { downloadReport } from "../lib/reports";
import { useVE } from "../store";
import { Markdown } from "./Markdown";
import { ReportVerifyFlow } from "./ReportVerifyFlow";

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
    reports,
    loadReports,
    reportPreview,
    openReport,
    closeReportPreview,
    removeReport,
  } = useVE();
  const [dragOver, setDragOver] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [reportQuery, setReportQuery] = useState("");

  const toggleVersions = () => {
    const next = !showVersions;
    setShowVersions(next);
    setShowReports(false);
    if (next) void loadGddVersions();
  };

  const toggleReports = () => {
    const next = !showReports;
    setShowReports(next);
    setShowVersions(false);
    if (next) void loadReports();
  };

  const onRestore = (ts: number) => {
    void uiConfirm(`${fmtTs(ts)} 버전으로 GDD를 되돌릴까요?`, {
      message: "현재 버전도 히스토리에 남으므로 다시 되돌릴 수 있습니다.",
      confirmLabel: "⏪ 복원",
    }).then((ok) => {
      if (ok) {
        void restoreGdd(ts);
        setShowVersions(false);
      }
    });
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
          <div className="head-name">{reportPreview ? "📋 보고서" : "📄 마스터 GDD"}</div>
          <div className="head-role dim">
            {reportPreview
              ? `${AGENT_MAP[reportPreview.agent]?.name ?? reportPreview.agent} — ${fmtTs(reportPreview.ts)}`
              : gddPreview
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
              <button
                className={`btn tiny ${showReports || reportPreview ? "primary" : ""}`}
                onClick={toggleReports}
                title={`보고서함 (${reports.length}건) — 아트 명세서, 개발 명세서, 일정표 등`}
              >
                📋{reports.length > 0 ? ` ${reports.length}` : ""}
              </button>
              <button className={`btn tiny ${showVersions ? "primary" : ""}`} onClick={toggleVersions} title="버전 히스토리">
                🕘
              </button>
              <button className="btn tiny" onClick={() => setGddEditing(true)} disabled={!!gddPreview || !!reportPreview}>
                ✏️ 편집
              </button>
              <button className="btn tiny" onClick={() => void loadGdd()} title="파일에서 다시 읽기">
                🔄
              </button>
            </>
          )}
        </div>
      </div>

      {showReports && (
        <div className="version-drawer">
          {reports.length === 0 && (
            <div className="dim">
              아직 보고서가 없습니다. 에이전트 1:1 대화의 <b>📋 보고서</b> 버튼으로 명세서를 요청해 보세요.
            </div>
          )}
          {reports.length > 4 && (
            <input
              className="list-search"
              value={reportQuery}
              onChange={(e) => setReportQuery(e.target.value)}
              placeholder="🔎 보고서 검색 (제목·작성자)"
            />
          )}
          {reports
            .filter((r) => {
              if (!reportQuery.trim()) return true;
              const q = reportQuery.trim().toLowerCase();
              return (
                r.title.toLowerCase().includes(q) ||
                (AGENT_MAP[r.agent]?.name ?? r.agent).toLowerCase().includes(q)
              );
            })
            .map((r) => {
            const a = AGENT_MAP[r.agent];
            return (
              <div key={r.ts} className={`version-item ${reportPreview?.ts === r.ts ? "active" : ""}`}>
                <button className="version-time" onClick={() => void openReport(r.ts)} title="이 보고서 열기">
                  {a?.emoji ?? "📋"} {r.title} <span className="dim">({fmtTs(r.ts)} · {(r.size / 1000).toFixed(1)}천자)</span>
                </button>
                <button
                  className="btn tiny"
                  onClick={() => {
                    void uiConfirm(`보고서 "${r.title}"를 삭제할까요?`, {
                      message: "휴지통(.trash)으로 이동합니다 — 실수라면 파일 탐색기에서 복구할 수 있습니다.",
                      confirmLabel: "🗑 삭제",
                      danger: true,
                    }).then((ok) => ok && void removeReport(r.ts));
                  }}
                  title="삭제 (휴지통으로)"
                >
                  🗑
                </button>
              </div>
            );
          })}
        </div>
      )}

      {reportPreview && (
        <>
          <div className="preview-banner">
            📋 보고서를 보고 있습니다
            <button className="btn tiny primary" onClick={() => downloadReport(reportPreview)}>
              ⬇️ .md 다운로드
            </button>
            <button className="btn tiny" onClick={closeReportPreview}>
              GDD로 돌아가기
            </button>
          </div>
          <div className="report-verify-wrap">
            <ReportVerifyFlow ts={reportPreview.ts} agentId={reportPreview.agent} />
          </div>
        </>
      )}

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
        {AGENTS.filter((a) => !a.staff).map((a) => (
          <button key={a.id} className="chip mini" onClick={() => scrollToSection(a.section)} title={a.name}>
            {a.emoji} {a.sectionTitle}
          </button>
        ))}
      </div>

      {gddEditing ? (
        <textarea className="gdd-editor" value={gddDraft} onChange={(e) => setGddDraft(e.target.value)} spellCheck={false} />
      ) : (
        <div className="gdd-content">
          <Markdown
            text={
              reportPreview
                ? reportPreview.markdown
                : gddPreview
                  ? gddPreview.markdown
                  : gdd || "_GDD를 불러오는 중…_"
            }
          />
        </div>
      )}
      {dragOver && <div className="drop-veil">여기에 놓으면 해당 에이전트의 GDD 섹션에 반영됩니다</div>}
    </aside>
  );
}
