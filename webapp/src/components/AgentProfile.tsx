import { useEffect, useState } from "react";
import { AGENT_MAP, REVIEWERS } from "../lib/agents";
import { getModelsInfo, registerModelKey, setAgentModels, type ModelsInfo } from "../lib/models";
import { AgentSprite } from "./AgentSprite";
import { useVE } from "../store";

/**
 * 에이전트 프로필 창 — 캐릭터의 "사원 카드".
 * 이 에이전트가 쓰는 AI 모델/API를 여기서 바로 바꾸고(개별 적용, 게이트웨이 1회 재시작),
 * 팀 안에서의 관계(담당 섹션·검토자)와 활동(작업·보고서·학습 지식)을 한눈에 본다.
 */
export function AgentProfile() {
  const { profileAgent, closeProfile, selectAgent, feed, reports, knowledge, agentHealth } = useVE();
  const id = profileAgent ?? "";
  const a = AGENT_MAP[id];

  const [models, setModels] = useState<ModelsInfo | null>(null);
  const [draft, setDraft] = useState("");
  const [applying, setApplying] = useState(false);

  const refresh = () => {
    void getModelsInfo()
      .then((m) => {
        setModels(m);
        setDraft(m.agents[id] ?? m.current);
      })
      .catch(() => setModels(null));
  };
  useEffect(refresh, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeProfile();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeProfile]);

  if (!a) return null;

  const current = models ? (models.agents[id] ?? models.current) : "";
  const currentOpt = models?.options.find((o) => o.id === current);
  const draftOpt = models?.options.find((o) => o.id === draft);
  const dirty = models !== null && draft !== current;

  const workCount = feed.filter(
    (m) => m.from === id && ["draft", "review", "revision", "summary", "talk"].includes(m.kind)
  ).length;
  const myReports = reports.filter((r) => r.agent === id);
  const myKnowledge = knowledge.filter((k) => k.agents?.includes("all") || k.agents?.includes(id));
  const reviewer = REVIEWERS[id] ? AGENT_MAP[REVIEWERS[id]] : null;
  const reviewees = Object.entries(REVIEWERS)
    .filter(([, rev]) => rev === id)
    .map(([owner]) => AGENT_MAP[owner])
    .filter(Boolean);
  const health = agentHealth[id];

  const onApply = () => {
    if (!models || !dirty || applying) return;
    if (
      !window.confirm(
        `${a.name}의 모델을 "${draftOpt?.label ?? draft}"(으)로 바꿉니다.\n게이트웨이가 재시작됩니다(약 10초). 진행할까요?`
      )
    )
      return;
    setApplying(true);
    void setAgentModels({ [id]: draft })
      .then(() => {
        window.alert("적용 완료 — 게이트웨이 재시작 중입니다. 10초 뒤부터 새 모델로 응답합니다.");
        refresh();
      })
      .catch((e) => window.alert(`적용 실패: ${e.message}`))
      .finally(() => setApplying(false));
  };

  const onRegisterKey = (provider: "github" | "nvidia") => {
    const guide =
      provider === "github"
        ? "GitHub 개인 액세스 토큰(PAT)을 붙여넣으세요.\n(⚠️ GitHub Models는 무료 티어 4,000토큰 제한 — 유료 결제 필요)"
        : "NVIDIA API 키(nvapi-…)를 붙여넣으세요.\n(발급: https://build.nvidia.com — 무료 크레딧 제공)";
    const key = window.prompt(`${guide}\n저장하면 게이트웨이가 자동 재시작됩니다(약 10초).`);
    if (!key?.trim()) return;
    void registerModelKey(provider, key.trim())
      .then(() => {
        window.alert("키 등록 완료 — 이제 모델 목록에서 선택할 수 있습니다.");
        setTimeout(refresh, 1000);
      })
      .catch((e) => window.alert(`실패: ${e.message}`));
  };

  return (
    <div className="doc-viewer" onClick={(e) => e.target === e.currentTarget && closeProfile()}>
      <div className="doc-window agent-profile">
        <div className="doc-head">
          <div className="profile-id">
            <span className="profile-sprite" style={{ background: a.color + "1e", borderColor: a.color + "77" }}>
              <AgentSprite id={id} size={56} />
            </span>
            <div className="head-meta">
              <div className="head-name">
                {a.emoji} {a.name}
              </div>
              <div className="head-role dim">{a.role}</div>
              <div className="profile-badges">
                <span className="profile-badge" style={{ borderColor: a.color + "66", color: a.color }}>
                  GDD {a.section.replace("## ", "")} {a.sectionTitle} 담당
                </span>
                {health && (
                  <span className={`profile-badge ${health.ok ? "ok" : "bad"}`}>
                    {health.ok ? `🩺 정상 (${Math.round(health.ms / 1000)}초)` : "🩺 응답 없음"}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            className="btn small"
            onClick={() => {
              closeProfile();
              selectAgent(id);
            }}
          >
            💬 대화하기
          </button>
          <button className="btn small" onClick={closeProfile} title="닫기 (Esc)">
            ✕ 닫기
          </button>
        </div>

        <div className="profile-body">
          {/* 두뇌(모델/API) — 이 창의 주인공 */}
          <div className="profile-card">
            <div className="profile-card-title">🧠 두뇌 (AI 모델)</div>
            {models ? (
              <>
                <div className="profile-model-now">
                  현재: <b>{currentOpt?.label ?? current}</b>
                  {currentOpt?.note && <span className="dim"> — {currentOpt.note}</span>}
                </div>
                <div className="profile-model-row">
                  <select
                    className="model-select"
                    value={draft}
                    disabled={applying}
                    onChange={(e) => setDraft(e.target.value)}
                  >
                    {models.options.map((o) => (
                      <option key={o.id} value={o.id} title={o.note}>
                        {o.label}
                        {o.note ? ` — ${o.note}` : ""}
                      </option>
                    ))}
                  </select>
                  <button className="btn small primary" onClick={onApply} disabled={!dirty || applying}>
                    {applying ? "적용 중…" : dirty ? "✅ 이 에이전트만 적용" : "변경 없음"}
                  </button>
                </div>
                <div className="profile-keys">
                  {!models.providers.nvidia && (
                    <button className="btn tiny" onClick={() => onRegisterKey("nvidia")}>
                      🔑 NVIDIA 키 등록
                    </button>
                  )}
                  {!models.providers.github && (
                    <button className="btn tiny" onClick={() => onRegisterKey("github")}>
                      🔑 GitHub 토큰 등록
                    </button>
                  )}
                  <span className="dim">
                    전원 일괄 변경은 사이드바 🧠 셀렉터에서. 개별 적용도 게이트웨이는 1회 재시작됩니다.
                  </span>
                </div>
              </>
            ) : (
              <span className="dim">모델 정보를 불러오지 못했습니다 (PC 로컬에서만 변경 가능)</span>
            )}
          </div>

          {/* 팀 관계 */}
          <div className="profile-card">
            <div className="profile-card-title">🤝 팀 안에서</div>
            <ul className="profile-list">
              <li>
                담당 문서: <b>GDD "{a.section.replace("## ", "")} {a.sectionTitle}"</b> 섹션
              </li>
              {reviewer && (
                <li>
                  내 초안의 검토자: {reviewer.emoji} <b>{reviewer.name}</b>
                </li>
              )}
              {reviewees.length > 0 && (
                <li>
                  내가 검토하는 동료: {reviewees.map((r) => `${r.emoji} ${r.name}`).join(", ")}
                </li>
              )}
            </ul>
          </div>

          {/* 활동 요약 */}
          <div className="profile-card">
            <div className="profile-card-title">📈 활동</div>
            <ul className="profile-list">
              <li>
                회의·협업 작업 기록 <b>{workCount}건</b> — 캐릭터를 눌러 📜 작업 기록 탭에서 열람
              </li>
              <li>
                작성한 보고서 <b>{myReports.length}건</b>
                {myReports.length > 0 && (
                  <span className="dim"> — 최근: {myReports.slice(0, 2).map((r) => `"${r.title}"`).join(", ")}</span>
                )}
              </li>
              <li>
                학습한 이론 <b>{myKnowledge.length}건</b>
                {myKnowledge.length > 0 && (
                  <span className="dim"> — {myKnowledge.slice(0, 2).map((k) => k.title).join(", ")}</span>
                )}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
