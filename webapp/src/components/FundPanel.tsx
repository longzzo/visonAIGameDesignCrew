/**
 * 🩺 기초 점검 — 기획서에 "쓰여 있는 것"이 아니라 "없는 것"을 찾는다.
 *
 * 오너 지적 2026-07-26: "기본적인 사운드 같은 기초적인 부분을 놓친 게 많다".
 * 원인은 구조였다 — 11개 절 담당자는 각자 자기 절을 쓰고, QA는 쓴 것의 품질만 채점한다.
 * 아무의 일도 아닌 기초(HP 회복·사운드·해상도·접근성)는 오너가 눈치챌 때까지 아무도 안 짚었다.
 */
import { useVE } from "../store";
import { FUNDAMENTALS, LAYER_ORDER, type FundLayer } from "../lib/fundamentals";
import { AGENT_MAP } from "../lib/agents";

const VERDICT_UI: Record<string, { icon: string; cls: string; label: string }> = {
  없음: { icon: "❌", cls: "fund-miss", label: "없음" },
  약함: { icon: "⚠️", cls: "fund-weak", label: "약함" },
  있음: { icon: "✅", cls: "fund-ok", label: "있음" },
};

const LAYER_HINT: Record<FundLayer, string> = {
  성립: "없으면 게임이 성립하지 않는다",
  체험: "없으면 재미가 전달되지 않는다",
  완성: "없으면 미완성 빌드로 보인다",
};

export function FundPanel({ onClose }: { onClose: () => void }) {
  const project = useVE((s) => s.activeProject);
  const projectName = useVE((s) => s.projects.find((p) => p.id === s.activeProject)?.name ?? "");
  const busy = useVE((s) => s.fundBusy);
  const findings = useVE((s) => s.fundFindings);
  const ranAt = useVE((s) => s.fundRanAt);
  const error = useVE((s) => s.fundError);
  const runAudit = useVE((s) => s.runFundamentalsAudit);
  const directiveFrom = useVE((s) => s.directiveFromFinding);

  const byId = new Map(findings.map((f) => [f.id, f]));
  const miss = findings.filter((f) => f.verdict === "없음").length;
  const weak = findings.filter((f) => f.verdict === "약함").length;

  return (
    <div className="onb-backdrop" onClick={onClose}>
      <div className="onb-card fund-card" onClick={(e) => e.stopPropagation()}>
        <div className="approval-head">
          <b>🩺 기초 점검</b>
          <span className="dim">{projectName || "(프로젝트를 먼저 선택하세요)"} — 게임으로서 빠진 것이 없는지</span>
          <button className="btn tiny approval-close" onClick={onClose}>
            ✕ 닫기
          </button>
        </div>

        <div className="fund-body">
          <div className="fund-toolbar">
            <button className="btn primary" onClick={() => void runAudit()} disabled={busy || !project}>
              {busy ? "점검 중…" : findings.length ? "다시 점검" : "기초 점검 실행"}
            </button>
            {findings.length > 0 && (
              <span className="dim fund-summary">
                ❌ {miss} · ⚠️ {weak} · ✅ {findings.length - miss - weak}
                {ranAt ? ` · ${new Date(ranAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}` : ""}
              </span>
            )}
          </div>

          {error && <div className="deck-error">⚠️ {error}</div>}

          {!findings.length && !busy && (
            <div className="fund-intro dim">
              기획서를 <b>체크리스트 {FUNDAMENTALS.length}항목</b>과 대조해 <b>빠진 기초</b>를 찾습니다.
              담당자가 각자 자기 절을 잘 써도, 아무의 일도 아닌 기초는 통째로 빠집니다 — 실제로
              냥빙고는 <b>HP 회복 부재</b>를 개발 중반에, <b>사운드</b>는 "담당 0명" 상태로 뒤늦게 발견했습니다.
            </div>
          )}

          {LAYER_ORDER.map((layer) => {
            const items = FUNDAMENTALS.filter((f) => f.layer === layer);
            return (
              <div className="fund-layer" key={layer}>
                <div className="fund-layer-head">
                  <b>{layer}층</b> <span className="dim">— {LAYER_HINT[layer]}</span>
                </div>
                {items.map((item) => {
                  const f = byId.get(item.id);
                  const ui = f ? VERDICT_UI[f.verdict] : null;
                  const owner = AGENT_MAP[item.owner];
                  return (
                    <div className={`fund-row ${ui?.cls ?? ""}`} key={item.id}>
                      <span className="fund-icon">{ui?.icon ?? "·"}</span>
                      <div className="fund-main">
                        <div className="fund-label">
                          {item.label}
                          <span className="dim fund-owner">
                            {owner ? ` ${owner.emoji} ${owner.name}` : ""}
                          </span>
                        </div>
                        {f && <div className="dim fund-evidence">{f.evidence}</div>}
                        {f && f.verdict !== "있음" && f.action && <div className="fund-action">→ {f.action}</div>}
                      </div>
                      {f && f.verdict !== "있음" && (
                        <button
                          className="btn tiny primary fund-fix"
                          onClick={() => directiveFrom(item.id)}
                          title="이 결손을 메우는 지시문을 입력창에 채웁니다 (착수는 시작 버튼)"
                        >
                          지시문 만들기
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
