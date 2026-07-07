import { useVE } from "../store";
import { AGENT_MAP } from "../lib/agents";

/**
 * 결정 요청 오버레이 (Sample 추구미의 중앙 결정 모달).
 * 실제 대기 중인 오너 결정(보고서 가치검증 승인 / 지식 학습 승인)을
 * 옵션 카드로 보여준다 — 자동 적용은 없다(기획 반영은 오너 권한).
 */
export function DecisionOverlay() {
  const {
    reportVerify,
    approveReportVerify,
    dismissReportVerify,
    pendingKnowledge,
    approveKnowledge,
    dismissKnowledge,
  } = useVE();

  const rv = reportVerify?.status === "ready" ? reportVerify : null;
  const pk = !rv && pendingKnowledge?.status === "ready" ? pendingKnowledge : null;
  if (!rv && !pk) return null;

  return (
    <div className="decision-veil">
      <div className="decision-card glass">
        <div className="decision-head">
          <span className="decision-tag">결정 요청</span>
          {rv ? (
            <b>
              보고서 「{rv.title.slice(0, 40)}」를 GDD에 반영할까요?
              <span className="dim"> — {AGENT_MAP[rv.agentId]?.name}</span>
            </b>
          ) : (
            <b>지식 「{pk!.title.slice(0, 40)}」을 팀에 학습시킬까요?</b>
          )}
        </div>
        <div className="decision-verdict dim">{((rv ? rv.verdict : pk!.summary || pk!.reason) ?? "").slice(0, 400)}</div>
        <div className="decision-opts">
          {rv ? (
            <>
              <button className="decision-opt primary" onClick={() => void approveReportVerify()}>
                <b>✅ 반영 승인</b>
                <span>PM 검증안을 GDD 해당 섹션에 반영 (직전 버전 자동 백업)</span>
              </button>
              <button className="decision-opt" onClick={dismissReportVerify}>
                <b>📋 보관만</b>
                <span>반영하지 않고 보고서함에 그대로 둔다</span>
              </button>
            </>
          ) : (
            <>
              <button className="decision-opt primary" onClick={() => void approveKnowledge()}>
                <b>✅ 학습 승인</b>
                <span>{(pk!.agents ?? []).map((a) => AGENT_MAP[a]?.name ?? a).join("·") || "관련 팀"}에게 학습시킨다</span>
              </button>
              <button className="decision-opt" onClick={dismissKnowledge}>
                <b>✕ 반려</b>
                <span>학습하지 않는다</span>
              </button>
            </>
          )}
        </div>
        <div className="decision-foot dim">결정할 때까지 파이프라인이 대기합니다 — 자동 적용은 하지 않습니다.</div>
      </div>
    </div>
  );
}
