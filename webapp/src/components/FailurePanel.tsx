import { useVE } from "../store";

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * 🗂️ 오류함 — 재시도(5초 → 2분)까지 실패한 게이트웨이 호출을 모아 둔다.
 * 오너 요청(2026-07-15): "실패한 거 따로 모아두면 내가 물어볼 수 있게".
 * 디스크(workspace/projects/<id>/failures.json)에 남으므로 앱을 껐다 켜도 유지되고,
 * 메인 헤드(클로드)가 파일을 직접 읽어 진단할 수 있다.
 */
export function FailurePanel() {
  const { failures, setFailuresOpen, clearFailures } = useVE();
  const items = [...failures].sort((a, b) => b.ts - a.ts);

  return (
    <div className="onb-backdrop" onClick={() => setFailuresOpen(false)}>
      <div className="onb-card approval-card" onClick={(e) => e.stopPropagation()}>
        <div className="approval-head">
          <b>🗂️ 오류함 — 재시도 후에도 실패한 호출</b>
          <span className="dim">
            게이트웨이 오류는 5초 → 2분 간격으로 자동 재시도하고, 그래도 실패한 것만 여기 남습니다 · 최근 80건
          </span>
          <button className="btn tiny approval-close" onClick={() => setFailuresOpen(false)}>
            ✕ 닫기
          </button>
        </div>

        {items.length === 0 && <div className="dim approval-empty">실패한 호출이 없습니다. 👍</div>}

        {items.map((f) => (
          <div key={f.id} className="approval-item">
            <div className="approval-title">
              {f.agentName || f.agentId} {f.phase && <span className="dim">— {f.phase}</span>}
            </div>
            <div className="fail-err">{f.error}</div>
            <div className="approval-meta dim">
              {fmtTs(f.ts)} · {f.attempts}회 시도 실패 · tag: {f.tag}
            </div>
            {f.prompt && (
              <details className="fail-prompt">
                <summary className="dim">보낸 지시 보기</summary>
                <pre>{f.prompt}</pre>
              </details>
            )}
          </div>
        ))}

        {items.length > 0 && (
          <div className="approval-add">
            <span className="dim" style={{ flex: 1, fontSize: 12 }}>
              해결된 오류는 비워도 됩니다 — 남겨두면 메인 헤드(클로드)가 원인을 분석할 수 있습니다.
            </span>
            <button className="btn small" onClick={() => void clearFailures()}>
              🧹 오류함 비우기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
