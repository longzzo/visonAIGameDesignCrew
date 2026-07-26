/**
 * 📒 결정·기각 원장 — 매 회의에 주입되는 "조직의 기억"을 오너가 직접 보고 고친다.
 *
 * 왜 만들었나 (오너 실측 2026-07-26 A-3·A-4):
 * 원장은 프롬프트에 주입되기만 하고 **화면이 아예 없었다.** 그래서
 *   · 오너가 반려한 기능이 어디에도 기록되지 않아 다음 회의가 그대로 되살렸고("밤 전환 예고" 2회),
 *   · "모바일 조작표 금지"처럼 승인 안건이 아닌 **상시 금지**는 등록할 방법 자체가 없었다
 *     (지시문에 대문자로 못박아도 3라운드 연속 뚫렸다).
 * 여기서 등록한 금지는 다음 회의부터 전원 프롬프트에 [🚫 기각 원장]으로 들어간다.
 */
import { useEffect, useState } from "react";
import { useVE } from "../store";
import { isRejection } from "../lib/kit";

export function LedgerPanel({ onClose }: { onClose: () => void }) {
  const project = useVE((s) => s.activeProject);
  const projectName = useVE((s) => s.projects.find((p) => p.id === s.activeProject)?.name ?? "");
  const decisions = useVE((s) => s.decisions);
  const loadDecisions = useVE((s) => s.loadDecisions);
  const addProhibition = useVE((s) => s.addProhibition);
  const addDecisionManual = useVE((s) => s.addDecisionManual);
  const removeDecision = useVE((s) => s.removeDecision);

  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"ban" | "fix">("ban");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadDecisions();
  }, [project, loadDecisions]);

  const bans = decisions.filter(isRejection);
  const fixed = decisions.filter((d) => !isRejection(d));

  const submit = async () => {
    const t = draft.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      if (mode === "ban") await addProhibition(t);
      else await addDecisionManual(t);
      setDraft("");
    } finally {
      setBusy(false);
    }
  };

  const row = (text: string, ts: number, ban: boolean) => (
    <li key={`${ts}-${text}`} className={ban ? "ledger-row ban" : "ledger-row"}>
      <span className="ledger-text">{text.replace(/^\(오너 (기각|승인)\)\s*/, "")}</span>
      <button
        className="btn tiny ledger-del"
        title="원장에서 제거 — 다음 회의부터 주입되지 않습니다"
        onClick={() => void removeDecision(text)}
      >
        ✕
      </button>
    </li>
  );

  return (
    <div className="onb-backdrop" onClick={onClose}>
      <div className="onb-card ledger-card" onClick={(e) => e.stopPropagation()}>
        <div className="approval-head">
          <b>📒 결정·기각 원장</b>
          <span className="dim">{projectName || "(프로젝트를 먼저 선택하세요)"} — 매 회의에 전원에게 주입됩니다</span>
          <button className="btn tiny approval-close" onClick={onClose}>
            ✕ 닫기
          </button>
        </div>

        <div className="ledger-body">
          <div className="ledger-add">
            <div className="ledger-modes">
              <button
                className={mode === "ban" ? "btn tiny primary" : "btn tiny"}
                onClick={() => setMode("ban")}
              >
                🚫 금지
              </button>
              <button
                className={mode === "fix" ? "btn tiny primary" : "btn tiny"}
                onClick={() => setMode("fix")}
              >
                ✅ 확정
              </button>
            </div>
            <input
              className="ledger-input"
              value={draft}
              placeholder={
                mode === "ban"
                  ? "예: 모바일 조작표를 만들지 마라 — PC 전용이다"
                  : "예: 강철이 브레스는 18×1회 즉발로 확정(v34.1)"
              }
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
            <button className="btn tiny primary" onClick={() => void submit()} disabled={!draft.trim() || busy || !project}>
              등록
            </button>
          </div>
          <div className="dim ledger-hint">
            {mode === "ban"
              ? "금지는 개수 제한 없이 전부 주입됩니다 — 가장 자주 위반되는 항목이라 잘라내지 않습니다."
              : "확정 사항은 최신 12건이 주입되고, 팀은 이것을 재설계하지 않습니다."}
          </div>

          <div className="ledger-cols">
            <section className="ledger-col">
              <h4>🚫 기각·금지 ({bans.length})</h4>
              {bans.length === 0 ? (
                <div className="dim ledger-empty">
                  아직 없습니다. 결재함에서 <b>반려</b>하거나 위에서 직접 등록하면 여기에 쌓입니다.
                </div>
              ) : (
                <ul className="ledger-list">{bans.map((d) => row(d.text, d.ts, true))}</ul>
              )}
            </section>
            <section className="ledger-col">
              <h4>✅ 확정 ({fixed.length}){fixed.length > 12 && <span className="dim"> · 최신 12건 주입</span>}</h4>
              {fixed.length === 0 ? (
                <div className="dim ledger-empty">회의에서 결론이 나면 자동으로 쌓입니다.</div>
              ) : (
                <ul className="ledger-list">{[...fixed].reverse().map((d) => row(d.text, d.ts, false))}</ul>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
