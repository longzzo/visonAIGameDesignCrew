import { useState } from "react";
import { useVE } from "../store";

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * 승인 대기 창 — PM에게 총 결정권이 있지만, 방향을 바꾸는 초중대 사항은 여기 쌓여 오너 결재를 기다린다.
 * 승인하면 결정 원장에 적립되어 다음 회의부터 모든 에이전트에게 자동 주입된다.
 */
export function ApprovalPanel() {
  const { approvals, setApprovalsOpen, decideApproval, addApproval } = useVE();
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState("");
  const pending = approvals.filter((a) => a.status === "pending").sort((a, b) => b.ts - a.ts);
  const decided = approvals.filter((a) => a.status !== "pending").sort((a, b) => (b.decidedTs ?? b.ts) - (a.decidedTs ?? a.ts)).slice(0, 10);

  const decide = async (id: string, status: "approved" | "rejected") => {
    setBusy(id);
    try {
      await decideApproval(id, status);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="onb-backdrop" onClick={() => setApprovalsOpen(false)}>
      <div className="onb-card approval-card" onClick={(e) => e.stopPropagation()}>
        <div className="approval-head">
          <b>🔔 승인 대기 — 오너 결재함</b>
          <span className="dim">PM이 판단한 초중대 사항입니다 · 승인하면 결정 원장에 적립되어 다음 회의부터 팀 전체에 적용됩니다</span>
          <button className="btn tiny approval-close" onClick={() => setApprovalsOpen(false)}>
            ✕ 닫기
          </button>
        </div>

        {pending.length === 0 && <div className="dim approval-empty">대기 중인 안건이 없습니다.</div>}
        {pending.map((a) => (
          <div key={a.id} className="approval-item">
            <div className="approval-title">{a.title}</div>
            {a.detail && <div className="approval-detail dim">{a.detail}</div>}
            <div className="approval-meta dim">
              {fmtTs(a.ts)} · 출처: {a.source === "meeting" ? "회의 상신" : a.source || "수동"}
            </div>
            <div className="approval-actions">
              <button className="btn small primary" disabled={busy === a.id} onClick={() => void decide(a.id, "approved")}>
                ✅ 승인
              </button>
              <button className="btn small" disabled={busy === a.id} onClick={() => void decide(a.id, "rejected")}>
                ❌ 반려
              </button>
            </div>
          </div>
        ))}

        <div className="approval-add">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="직접 안건 추가 — 예: 챕터 4 숨겨진 층(46~50층) 신설"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newTitle.trim()) {
                void addApproval(newTitle.trim(), "", "owner");
                setNewTitle("");
              }
            }}
          />
          <button
            className="btn small"
            disabled={!newTitle.trim()}
            onClick={() => {
              void addApproval(newTitle.trim(), "", "owner");
              setNewTitle("");
            }}
          >
            ＋ 추가
          </button>
        </div>

        {decided.length > 0 && (
          <details className="approval-history">
            <summary className="dim">결재 이력 ({decided.length})</summary>
            {decided.map((a) => (
              <div key={a.id} className="approval-hist-item dim">
                {a.status === "approved" ? "✅" : "❌"} {a.title} <span>({fmtTs(a.decidedTs ?? a.ts)})</span>
              </div>
            ))}
          </details>
        )}
      </div>
    </div>
  );
}
