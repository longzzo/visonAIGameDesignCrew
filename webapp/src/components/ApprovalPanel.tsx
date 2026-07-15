import { useState } from "react";
import { useVE } from "../store";
import { AGENT_MAP } from "../lib/agents";
import { uiConfirm } from "../lib/dialog";
import type { ApprovalItem } from "../lib/kit";

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

  /**
   * 수동 실행 — 회의를 실제로 띄우는 무거운 동작이라 **항상 확인을 거친다.**
   * 이미 실행된 안건이면 중복이라는 사실을 명시하고 force로만 재실행한다.
   */
  /**
   * 수동 실행 — 회의를 실제로 띄우는 무거운 동작이라 확인을 거친다.
   * 이미 실행된 안건은 버튼 자체가 없어 여기 도달하지 않는다(재실행 경로 없음).
   */
  const run = async (a: ApprovalItem) => {
    const ok = await uiConfirm("이 안건을 지금 실행할까요?", {
      message:
        `"${a.title}"\n\n` +
        (orchRunning
          ? "지금 회의가 진행 중이라, 현재 회의가 끝난 뒤 이어서 착수합니다."
          : "PM이 담당 본부에 배정해 곧바로 회의를 착수합니다.") +
        "\n\n한 번 실행하면 이 안건은 작업 완료로 잠깁니다.",
      confirmLabel: "▶ 실행",
      cancelLabel: "취소",
    });
    if (!ok) return;
    setBusy(a.id);
    try {
      await runApproval(a.id);
    } finally {
      setBusy("");
    }
  };

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
                {/* 이미 실행된 안건은 실행 시각을 보여주고, 재실행은 확인을 거친다.
                    조건 없이 "지금 실행"을 노출했다가 오너가 자동 실행된 건을 다시 눌러
                    중복 지시가 나간 실사고가 있었다 (2026-07-15). */}
                {/* 한 번 실행된 안건은 버튼을 아예 죽이고 "작업 완료"로 끝낸다 (오너 지시 2026-07-16).
                    재실행 경로를 남겨두면 결국 실수로 눌러 중복 지시가 나간다 — 확인창보다 비활성화가 확실하다. */}
                {a.status === "approved" &&
                  (a.ranTs ? (
                    <span className="approval-hist-run">
                      <span className="approval-done" title={`${fmtTs(a.ranTs)}에 담당 본부에 배정되어 실행됨`}>
                        ✅ 작업 완료 · {fmtTs(a.ranTs)}
                      </span>
                    </span>
                  ) : (
                    <span className="approval-hist-run">
                      <button
                        className="btn tiny approval-run"
                        disabled={busy === a.id}
                        onClick={() => void run(a)}
                        title={
                          orchRunning
                            ? "회의 중입니다 — 현재 회의가 끝나면 이어서 실행하도록 예약됩니다 (확인을 거칩니다)"
                            : "PM이 이 승인 안건을 지시로 담당 본부에 배정해 착수합니다 (확인을 거칩니다)"
                        }
                      >
                        ▶ 지금 실행
                      </button>
                    </span>
                  ))}
              </div>
            ))}
          </details>
        )}
      </div>
    </div>
  );
}
