import { AGENT_MAP } from "../lib/agents";
import { useVE } from "../store";
import { Markdown } from "./Markdown";

/**
 * 보고서 → GDD 반영 절차 — 바로 반영하지 않고
 * PM이 게임의 처음 기획(개요)과 가치가 맞는지 검증한 뒤 오너가 승인해야 반영된다.
 */
export function ReportVerifyFlow({ ts, agentId }: { ts: number; agentId: string }) {
  const { reportVerify, requestReportVerify, approveReportVerify, dismissReportVerify } = useVE();
  const rv = reportVerify?.ts === ts ? reportVerify : null;
  const agent = AGENT_MAP[agentId];
  if (!agent) return null;

  return (
    <div className="report-verify">
      {!rv && (
        <button
          className="btn small"
          onClick={() => void requestReportVerify(ts)}
          title="PM이 이 보고서가 게임의 처음 기획(개요) 가치와 맞는지 검증한 뒤, 승인하시면 GDD에 반영됩니다 (직전 버전 자동 백업)"
        >
          🧾 PM 가치검증 → GDD 반영
        </button>
      )}
      {rv?.status === "running" && (
        <div className="bubble assistant pending">
          <span className="spinner" /> 🎯 PM이 처음 기획과 가치 정합성을 검증 중…
        </div>
      )}
      {rv?.status === "error" && (
        <div className="bubble assistant error">
          ⚠️ 검증 실패: {rv.error}{" "}
          <button className="btn tiny" onClick={() => void requestReportVerify(ts)}>
            재시도
          </button>
        </div>
      )}
      {rv?.status === "rejected" && (
        <div className="verify-card">
          <div className="verify-head">🎯 PM 검증 의견 — 반영 비권고</div>
          <Markdown text={rv.verdict || "(의견 없음)"} />
          <div className="verify-actions">
            <button className="btn" onClick={dismissReportVerify}>
              확인 (반영 안 함)
            </button>
          </div>
        </div>
      )}
      {rv?.status === "ready" && (
        <div className="verify-card">
          <div className="verify-head">🎯 PM 가치검증 의견</div>
          <Markdown text={rv.verdict || "(의견 없음)"} />
          <details className="verify-preview">
            <summary>📄 반영안 미리보기 ("{agent.sectionTitle}" 섹션 갱신본)</summary>
            <Markdown text={rv.finalText || ""} />
          </details>
          <div className="verify-actions">
            <button className="btn primary" onClick={() => void approveReportVerify()}>
              ✅ 승인 — GDD 반영 (직전 버전 자동 백업)
            </button>
            <button className="btn" onClick={dismissReportVerify}>
              ❌ 반영 안 함
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
