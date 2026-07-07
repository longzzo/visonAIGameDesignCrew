import { useEffect, useState } from "react";
import { AGENTS, AGENT_MAP, REVIEWERS } from "../lib/agents";
import { uiAlert, uiConfirm, uiPrompt } from "../lib/dialog";
import { getModelsInfo, registerModelKey, setAgentModels, type ModelsInfo } from "../lib/models";
import { saveTemp, tempOf, TEMP_DEFAULT } from "../lib/tuning";
import { zoneOfAgent } from "../lib/zones";
import { AgentSprite } from "./AgentSprite";
import { useVE } from "../store";

/**
 * 에이전트 프로필 창 — 캐릭터의 "사원 카드".
 * 이 에이전트가 쓰는 AI 모델/API를 여기서 바로 바꾸고(개별 적용, 게이트웨이 1회 재시작),
 * 팀 안에서의 관계(담당 섹션·검토자)와 활동(작업·보고서·학습 지식)을 한눈에 본다.
 */
export function AgentProfile() {
  const { profileAgent, closeProfile, selectAgent, feed, reports, knowledge, agentHealth, commScope, setCommScope, fireAgentAction } = useVE();
  const id = profileAgent ?? "";
  const a = AGENT_MAP[id];
  const scope = commScope[id] ?? { mode: "all" as const, allow: [] };

  const [models, setModels] = useState<ModelsInfo | null>(null);
  const [draft, setDraft] = useState("");
  const [applying, setApplying] = useState(false);
  // 창의성(온도) — 슬라이더 값은 localStorage 영속, 프롬프트 지시문으로 반영
  const [temp, setTemp] = useState(TEMP_DEFAULT);
  useEffect(() => setTemp(tempOf(id)), [id]);
  // 페르소나(AGENTS.md) 편집기
  const [personaOpen, setPersonaOpen] = useState(false);
  const [personaText, setPersonaText] = useState("");
  const [personaSaving, setPersonaSaving] = useState(false);
  const openPersona = () => {
    setPersonaOpen(true);
    setPersonaText("(불러오는 중…)");
    void fetch(`/api/persona?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((j) => setPersonaText(j.ok ? j.text || "# 페르소나\n\n(비어 있음 — 이 에이전트의 말투·전문성·규칙을 마크다운으로 적으세요)" : `불러오기 실패: ${j.error}`))
      .catch((e) => setPersonaText(`불러오기 실패: ${e.message}`));
  };
  const savePersona = () => {
    setPersonaSaving(true);
    void fetch("/api/persona", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, text: personaText }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error);
        setPersonaOpen(false);
        void uiAlert("저장 완료", "페르소나가 저장됐습니다 (직전 버전은 AGENTS.md.bak). 다음 대화·작업부터 반영됩니다.");
      })
      .catch((e) => void uiAlert("저장 실패", String(e?.message ?? e)))
      .finally(() => setPersonaSaving(false));
  };

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

  const onApply = async () => {
    if (!models || !dirty || applying) return;
    const ok = await uiConfirm(`${a.name}의 모델 교체`, {
      message: `"${draftOpt?.label ?? draft}"(으)로 바꿉니다. 게이트웨이가 재시작됩니다(약 10초).`,
      confirmLabel: "✅ 적용",
    });
    if (!ok) return;
    setApplying(true);
    void setAgentModels({ [id]: draft })
      .then(() => {
        void uiAlert("적용 완료", "게이트웨이 재시작 중입니다. 10초 뒤부터 새 모델로 응답합니다.");
        refresh();
      })
      .catch((e) => void uiAlert("적용 실패", e.message))
      .finally(() => setApplying(false));
  };

  const onRegisterKey = async (provider: "github" | "nvidia") => {
    const guide =
      provider === "github"
        ? "GitHub PAT (⚠️ GitHub Models는 무료 티어 4,000토큰 제한 — 유료 결제 필요)"
        : "NVIDIA API 키 (발급: https://build.nvidia.com — 무료 크레딧 제공)";
    const key = await uiPrompt(`${provider === "github" ? "GitHub 토큰" : "NVIDIA 키"} 등록`, {
      message: `${guide}\n저장하면 게이트웨이가 자동 재시작됩니다(약 10초).`,
      placeholder: provider === "nvidia" ? "nvapi-…" : "github_pat_…",
    });
    if (!key?.trim()) return;
    void registerModelKey(provider, key.trim())
      .then(() => {
        void uiAlert("키 등록 완료", "이제 모델 목록에서 선택할 수 있습니다.");
        setTimeout(refresh, 1000);
      })
      .catch((e) => void uiAlert("실패", e.message));
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
          <button className="btn small" onClick={openPersona} title="이 에이전트의 페르소나(AGENTS.md)를 직접 편집합니다 — 말투·전문성·규칙">
            📝 페르소나 편집
          </button>
          {a.custom && (
            <button
              className="btn small danger"
              onClick={() => {
                void uiConfirm(`${a.name} 퇴사 처리`, {
                  message: "로스터와 OpenClaw 설정에서 제거됩니다 (게이트웨이 재시작 ~10초). 페르소나 파일과 GDD 섹션 내용은 보존됩니다.",
                  confirmLabel: "🚪 퇴사",
                }).then((ok) => {
                  if (ok) void fireAgentAction(id).catch((e) => void uiAlert("퇴사 처리 실패", String(e?.message ?? e)));
                });
              }}
              title="채용된 직원을 퇴사시킵니다"
            >
              🚪 퇴사
            </button>
          )}
          <button className="btn small" onClick={closeProfile} title="닫기 (Esc)">
            ✕ 닫기
          </button>
        </div>

        {personaOpen && (
          <div className="persona-editor">
            <div className="persona-head">
              <b>📝 {a.name} — AGENTS.md</b>
              <span className="dim">이 파일이 곧 이 직원의 인격입니다. 저장하면 다음 작업부터 반영됩니다.</span>
            </div>
            <textarea value={personaText} onChange={(e) => setPersonaText(e.target.value)} spellCheck={false} rows={14} />
            <div className="persona-actions">
              <button className="btn small primary" onClick={savePersona} disabled={personaSaving}>
                {personaSaving ? "저장 중…" : "💾 저장"}
              </button>
              <button className="btn small" onClick={() => setPersonaOpen(false)}>
                취소
              </button>
            </div>
          </div>
        )}

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
                  <button className="btn small primary" onClick={() => void onApply()} disabled={!dirty || applying}>
                    {applying ? "적용 중…" : dirty ? "✅ 이 에이전트만 적용" : "변경 없음"}
                  </button>
                </div>
                <div className="temp-slider">
                  <span title="창의성(온도) — 게이트웨이가 모델 temperature를 노출하지 않아 작업 스타일 지시문으로 반영됩니다">
                    🎚 창의성 <b>{temp}</b>/10
                    {temp === TEMP_DEFAULT ? <span className="dim"> (기본)</span> : temp < TEMP_DEFAULT ? " — 보수적" : " — 대담"}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    value={temp}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setTemp(v);
                      saveTemp(id, v);
                    }}
                  />
                  <span className="dim temp-note">
                    낮음 = 확정 사실만·정확성 우선 / 높음 = 과감한 제안 우선. 다음 작업부터 적용.
                  </span>
                </div>
                <div className="profile-keys">
                  {!models.providers.nvidia && (
                    <button className="btn tiny" onClick={() => void onRegisterKey("nvidia")}>
                      🔑 NVIDIA 키 등록
                    </button>
                  )}
                  {!models.providers.github && (
                    <button className="btn tiny" onClick={() => void onRegisterKey("github")}>
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

          {/* 소통 범위 — 이 에이전트가 누구와 검토·협업할 수 있는가 */}
          <div className="profile-card">
            <div className="profile-card-title">📡 소통 범위</div>
            <div className="scope-modes">
              {(
                [
                  ["all", "전체", "모든 동료와 검토·협업 (기본)"],
                  ["dept", "부서 내", `같은 부서(${zoneOfAgent(id).label})끼리만`],
                  ["custom", "커스텀", "아래에서 고른 동료와만"],
                  ["feed", "📮 피드 위탁", "회의·교차검토에 직접 참여하지 않고 결론만 피드로 받아봅니다 (개인 작업·1:1 대화는 그대로)"],
                ] as const
              ).map(([m, label, tip]) => (
                <button
                  key={m}
                  className={`scope-mode ${scope.mode === m ? "on" : ""}`}
                  onClick={() => setCommScope(id, { mode: m, allow: scope.allow ?? [] })}
                  title={tip}
                >
                  {label}
                </button>
              ))}
            </div>
            {scope.mode === "custom" && (
              <div className="scope-chips">
                {AGENTS.filter((x) => x.id !== id && x.id !== "pm" && x.id !== "qa").map((x) => {
                  const on = (scope.allow ?? []).includes(x.id);
                  return (
                    <button
                      key={x.id}
                      className={`chip mini ${on ? "on" : ""}`}
                      style={on ? { borderColor: x.color, color: x.color } : undefined}
                      onClick={() =>
                        setCommScope(id, {
                          mode: "custom",
                          allow: on ? (scope.allow ?? []).filter((v) => v !== x.id) : [...(scope.allow ?? []), x.id],
                        })
                      }
                    >
                      {x.emoji} {x.name.split(" ")[0]}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="dim scope-note">
              {scope.mode === "feed"
                ? "📮 피드 위탁 — 이 직원은 회의에 불려가지 않고, 회의 결론·검토 결과를 피드로만 전달받습니다. 개인 배정 작업과 1:1 대화는 평소대로 합니다."
                : "범위 밖 동료와는 교차 검토·협업 세션이 자동으로 생략됩니다. PM·QA(게이트 역할)는 항상 소통 가능합니다."}
            </div>
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
