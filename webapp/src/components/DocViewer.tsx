import { useEffect } from "react";
import { AGENT_MAP } from "../lib/agents";
import { downloadReport } from "../lib/reports";
import { useVE } from "../store";
import { Markdown } from "./Markdown";

/**
 * 전체화면 문서 뷰어 — 사무실에서 GDD/보고서를 큰 화면으로 읽는다.
 * (오른쪽 패널이 좁아 잘 안 보이는 문제의 해결책)
 */
export function DocViewer({
  tab,
  onTab,
  onClose,
}: {
  tab: "gdd" | "reports";
  onTab: (t: "gdd" | "reports") => void;
  onClose: () => void;
}) {
  const { gdd, reports, loadReports, reportPreview, openReport } = useVE();

  useEffect(() => {
    void loadReports();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="doc-viewer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="doc-window">
        <div className="doc-head">
          <div className="doc-tabs">
            <button className={`doc-tab ${tab === "gdd" ? "on" : ""}`} onClick={() => onTab("gdd")}>
              📄 마스터 GDD
            </button>
            <button className={`doc-tab ${tab === "reports" ? "on" : ""}`} onClick={() => onTab("reports")}>
              📋 보고서함 {reports.length > 0 ? `(${reports.length})` : ""}
            </button>
          </div>
          {tab === "reports" && reportPreview && (
            <button className="btn small" onClick={() => downloadReport(reportPreview)}>
              ⬇️ .md 다운로드
            </button>
          )}
          <button className="btn small" onClick={onClose} title="닫기 (Esc)">
            ✕ 닫기
          </button>
        </div>

        {tab === "gdd" ? (
          <div className="doc-body">
            <Markdown text={gdd || "_GDD가 비어 있습니다._"} />
          </div>
        ) : (
          <div className="doc-split">
            <div className="doc-list">
              {reports.length === 0 && (
                <div className="dim" style={{ padding: 12 }}>
                  아직 보고서가 없습니다.
                  <br />
                  에이전트 1:1 대화의 <b>📋 보고서</b> 버튼으로 요청해 보세요.
                </div>
              )}
              {reports.map((r) => {
                const a = AGENT_MAP[r.agent];
                return (
                  <button
                    key={r.ts}
                    className={`doc-list-item ${reportPreview?.ts === r.ts ? "active" : ""}`}
                    onClick={() => void openReport(r.ts)}
                  >
                    <span className="doc-item-title">
                      {a?.emoji ?? "📋"} {r.title}
                    </span>
                    <span className="dim">
                      {a?.name ?? r.agent} · {new Date(r.ts).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} · {(r.size / 1000).toFixed(1)}천자
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="doc-body">
              {reportPreview ? (
                <Markdown text={reportPreview.markdown} />
              ) : (
                <div className="empty-hint">왼쪽 목록에서 보고서를 선택하세요.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
