import { useState } from "react";
import { useVE } from "../store";
import { AGENT_MAP } from "../lib/agents";

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * 승인 대기 창 — PM에게 총 결정권이 있지만, 방향을 바꾸는 초중대 사항은 여기 쌓여 오너 결재를 기다린다.
 * 승인하면 결정 원장에 적립되고, ⚡ 자동 실행이 켜져 있으면 PM이 곧바로 담당 본부에 배정해 착수한다.
 */
/** source가 "meeting:<agentId>"면 상신한 에이전트를 돌려준다 — 안건이 "어디서 왜" 나왔는지 추적용 */
function raiserOf(source?: string): { id: string; name: string } | null {
  const id = /^meeting:(.+)$/.exec(source ?? "")?.[1];
  if (!id) return null;
  return { id, name: AGENT_MAP[id]?.name ?? id };
}

export function ApprovalPanel() {
  const { approvals, setApprovalsOpen, decideApproval, addApproval, approvalAutoRun, setApprovalAutoRun, runApproval, orchRunning, selectAgent } =
    useVE();
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState("");
  /** 안건별 오너 코멘트 — "이것만 이렇게 고쳐서 승인"을 담는다(조건부 승인·반려 사유 공용) */
  const [notes, setNotes] = useState<Record<string, string>>({});
  const pending = approvals.filter((a) => a.status === "pending").sort((a, b) => b.ts - a.ts);
  const decided = approvals.filter((a) => a.status !== "pending").sort((a, b) => (b.decidedTs ?? b.ts) - (a.decidedTs ?? a.ts)).slice(0, 10);

  const decide = async (id: string, status: "approved" | "rejected") => {
    setBusy(id);
    try {
      await decideApproval(id, status, (notes[id] ?? "").trim());
      setNotes((n) => ({ ...n, [id]: "" }));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="onb-backdrop" onClick={() => setApprovalsOpen(false)}>
      <div className="onb-card approval-card" onClick={(e) => e.stopPropagation()}>
        <div className="approval-head">
          <b>🔔 승인 대기 — 오너 결재함</b>
          <span className="dim">
            PM이 판단한 초중대 사항입니다 · 승인하면 결정 원장에 적립되어 이후 모든 회의에 적용됩니다
          </span>
          <button className="btn tiny approval-close" onClick={() => setApprovalsOpen(false)}>
            ✕ 닫기
          </button>
        </div>

        <label
          className="approval-autorun"
          title="켜면 승인하는 즉시 PM이 담당 본부에 배정해 실행 회의를 착수합니다. 끄면 결정 원장 적립만 하고, 아래 ▶ 지금 실행으로 원할 때 시작합니다."
        >
          <input type="checkbox" checked={approvalAutoRun} onChange={(e) => setApprovalAutoRun(e.target.checked)} />
          ⚡ 승인 시 자동 실행
          <span className="dim">
            {approvalAutoRun
              ? " — 승인 즉시 PM이 담당 본부에 배정해 착수합니다 (회의 중이면 종료 후 이어서)"
              : " — 원장 적립만 합니다. 착수는 ▶ 지금 실행으로 직접 (다음 회의부터 자동 참조)"}
          </span>
        </label>

        {pending.length === 0 && <div className="dim approval-empty">대기 중인 안건이 없습니다.</div>}
        {pending.map((a) => {
          const raiser = raiserOf(a.source);
          return (
            <div key={a.id} className="approval-item">
              <div className="approval-title">{a.title}</div>
              {/* 배경은 "상신자 / 회의 / 근거 발췌" 여러 줄이라 줄바꿈을 살려 보여준다 */}
              {a.detail && <div className="approval-detail dim">{a.detail}</div>}
              <div className="approval-meta dim">
                {fmtTs(a.ts)} · 출처: {raiser ? `${raiser.name} 상신 (회의)` : a.source === "meeting" ? "회의 상신" : a.source || "수동"}
              </div>
              {/* 오너 코멘트 — 조건부 승인("이것만 이렇게 고쳐서")을 담는 자리.
                  입력하면 결정 원장·PM 실행 지시 양쪽에 원안보다 우선하는 지시로 실린다. */}
              <textarea
                className="approval-note"
                rows={2}
                value={notes[a.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
                placeholder="수정 지시·조건 (선택) — 예: &quot;RX는 28 말고 32로&quot; / &quot;도감 대신 까치를 남겨&quot;. 적으면 원안보다 우선하는 지시로 결정 원장과 담당 배정에 함께 전달됩니다."
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) void decide(a.id, "approved");
                }}
              />
              <div className="approval-actions">
                <button
                  className="btn small primary"
                  disabled={busy === a.id}
                  title={(notes[a.id] ?? "").trim() ? "수정 지시를 붙여 승인합니다 (Ctrl+Enter)" : "원안 그대로 승인합니다 (Ctrl+Enter)"}
                  onClick={() => void decide(a.id, "approved")}
                >
                  {(notes[a.id] ?? "").trim() ? "✅ 수정 지시 붙여 승인" : "✅ 승인"}
                </button>
                <button
                  className="btn small"
                  disabled={busy === a.id}
                  title={(notes[a.id] ?? "").trim() ? "반려 사유를 남기고 반려합니다" : "반려합니다 (사유를 적으면 함께 기록됩니다)"}
                  onClick={() => void decide(a.id, "rejected")}
                >
                  ❌ 반려
                </button>
                {raiser && (
                  <button
                    className="btn small"
                    title={`${raiser.name}의 대화방에서 이 안건의 전체 설명(어디서·왜·근거·승인 시 무슨 일)을 읽습니다`}
                    onClick={() => {
                      selectAgent(raiser.id);
                      setApprovalsOpen(false);
                    }}
                  >
                    💬 {raiser.name} 대화에서 보기
                  </button>
                )}
              </div>
            </div>
          );
        })}

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
                {/* 오너 코멘트가 있으면 반드시 보여준다 — 조건부 승인이었는지 나중에 확인할 수 없으면
                    "원안 승인"으로 오해되어 수정 조건이 사라진다 */}
                {a.note && <div className="approval-hist-note">⚠️ 오너 지시: {a.note}</div>}
                {a.status === "approved" && (
                  <button
                    className="btn tiny approval-run"
                    onClick={() => runApproval(a.id)}
                    title={
                      orchRunning
                        ? "회의 중입니다 — 현재 회의가 끝나면 이어서 실행하도록 예약됩니다"
                        : "PM이 이 승인 안건을 지시로 담당 본부에 배정해 지금 착수합니다"
                    }
                  >
                    ▶ 지금 실행
                  </button>
                )}
              </div>
            ))}
          </details>
        )}
      </div>
    </div>
  );
}
