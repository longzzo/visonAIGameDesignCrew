import { useEffect, useState } from "react";
import { useVE } from "../store";
import { AGENT_MAP } from "../lib/agents";

/**
 * 결정 요청 오버레이 (Sample 추구미의 중앙 결정 모달).
 * 실제 대기 중인 오너 결정(보고서 가치검증 승인 / 지식 학습 승인)을 옵션 카드로 보여준다.
 * 자동 승인은 기본 꺼짐 — 오너가 ⏱ 체크로 켜면 20초 카운트다운 뒤 권장안을 적용한다.
 */
const AUTO_KEY = "ve-decision-auto";
const AUTO_SECS = 20;

function loadAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) === "on";
  } catch {
    return false;
  }
}

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
  const decisionKey = rv ? `rv-${rv.ts}` : pk ? `pk-${pk.title}` : "";

  const [auto, setAuto] = useState(loadAuto);
  const [left, setLeft] = useState<number | null>(null);

  // 결정이 뜨고 자동 승인이 켜져 있으면 카운트다운 시작 (결정이 바뀌면 리셋)
  useEffect(() => {
    if (!decisionKey || !auto) {
      setLeft(null);
      return;
    }
    setLeft(AUTO_SECS);
    const t = setInterval(() => setLeft((v) => (v === null || v <= 0 ? v : v - 1)), 1000);
    return () => clearInterval(t);
  }, [decisionKey, auto]);

  useEffect(() => {
    if (left !== 0) return;
    setLeft(null);
    if (rv) void approveReportVerify();
    else if (pk) void approveKnowledge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  if (!rv && !pk) return null;

  const toggleAuto = () => {
    const next = !auto;
    setAuto(next);
    try {
      localStorage.setItem(AUTO_KEY, next ? "on" : "off");
    } catch {
      /* noop */
    }
  };

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
                <b>✅ 반영 승인{left !== null ? ` (${left}초 뒤 자동)` : ""}</b>
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
                <b>✅ 학습 승인{left !== null ? ` (${left}초 뒤 자동)` : ""}</b>
                <span>{(pk!.agents ?? []).map((a) => AGENT_MAP[a]?.name ?? a).join("·") || "관련 팀"}에게 학습시킨다</span>
              </button>
              <button className="decision-opt" onClick={dismissKnowledge}>
                <b>✕ 반려</b>
                <span>학습하지 않는다</span>
              </button>
            </>
          )}
        </div>
        <div className="decision-foot dim">
          <label className="decision-auto" title="켜면 결정 요청이 뜬 뒤 20초 동안 반응이 없을 때 권장안(승인)을 자동 적용합니다">
            <input type="checkbox" checked={auto} onChange={toggleAuto} /> ⏱ {AUTO_SECS}초 뒤 자동 승인 (기본 꺼짐)
          </label>
          {auto ? "카운트다운 중에도 버튼으로 즉시 결정할 수 있습니다." : "결정할 때까지 파이프라인이 대기합니다."}
        </div>
      </div>
    </div>
  );
}
