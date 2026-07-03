import { useEffect, useState } from "react";
import { AGENTS } from "../lib/agents";
import { setBraveKey } from "../lib/gdd";
import { getModelsInfo, registerModelKey, setAgentModels, switchModel, type ModelsInfo } from "../lib/models";
import { KnowledgeStudio } from "./KnowledgeStudio";
import { useVE } from "../store";

const STATUS_LABEL: Record<string, string> = {
  idle: "대기",
  running: "작업 중",
  done: "완료",
  error: "오류",
};

export function Sidebar() {
  const {
    agentStatus,
    activeAgent,
    selectAgent,
    view,
    conn,
    connDetail,
    reconnect,
    agentHealth,
    healthRunning,
    healthCheck,
    braveOk,
    loadBraveStatus,
    modelName,
    setModelName,
    reports,
    readReports,
    knowledge,
  } = useVE();
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);

  // 에이전트별 읽지 않은 보고서 수 — 확인 여부 배지
  const unreadByAgent: Record<string, number> = {};
  for (const r of reports) {
    if (!readReports.includes(r.ts)) unreadByAgent[r.agent] = (unreadByAgent[r.agent] ?? 0) + 1;
  }

  const healthDone = Object.keys(agentHealth).length;
  const healthOk = Object.values(agentHealth).filter((h) => h.ok).length;

  const [models, setModels] = useState<ModelsInfo | null>(null);
  const [switching, setSwitching] = useState(false);
  /** 역할별 모델 초안 — "적용"을 눌러야 실제 반영(게이트웨이 재시작 1회) */
  const [agentDraft, setAgentDraft] = useState<Record<string, string>>({});
  const refreshModels = () => {
    void getModelsInfo()
      .then((info) => {
        setModels(info);
        setAgentDraft(info.agents);
      })
      .catch(() => setModels(null));
  };
  useEffect(refreshModels, []);

  const draftDirty =
    models !== null && AGENTS.some((a) => (agentDraft[a.id] ?? models.current) !== (models.agents[a.id] ?? models.current));

  const onApplyAgentModels = () => {
    if (!models || !draftDirty || switching) return;
    const changed: Record<string, string> = {};
    for (const a of AGENTS) {
      const next = agentDraft[a.id];
      if (next && next !== models.agents[a.id]) changed[a.id] = next;
    }
    if (!window.confirm(`역할별 모델을 적용합니다 (${Object.keys(changed).length}명 변경).\n게이트웨이가 재시작됩니다(약 10초). 진행할까요?`)) return;
    setSwitching(true);
    void setAgentModels(changed)
      .then(() => {
        setModels({ ...models, agents: { ...models.agents, ...changed } });
        window.alert("역할별 모델 적용 완료 — 게이트웨이 재시작 중입니다. 10초 뒤 🩺 전원 점검으로 확인해 보세요.");
      })
      .catch((e) => window.alert(`적용 실패: ${e.message}`))
      .finally(() => setSwitching(false));
  };

  const onBraveKey = () => {
    const key = window.prompt(
      "Brave Search API 키를 붙여넣으세요.\n(발급: https://brave.com/search/api — Free 플랜, 월 2,000회 무료)\n저장하면 게이트웨이가 자동 재시작됩니다(약 10초)."
    );
    if (!key?.trim()) return;
    void setBraveKey(key.trim())
      .then(() => {
        void loadBraveStatus();
        window.alert("저장 완료 — 게이트웨이 재시작 중입니다. 10초 뒤부터 에이전트가 웹 검색을 쓸 수 있습니다.");
      })
      .catch((e) => window.alert(`실패: ${e.message}`));
  };

  const onRegisterKey = (provider: "github" | "nvidia") => {
    const guide =
      provider === "github"
        ? "GitHub 개인 액세스 토큰(PAT)을 붙여넣으세요.\n(github.com → Settings → Developer settings → Fine-grained token, models 권한)"
        : "NVIDIA API 키(nvapi-…)를 붙여넣으세요.\n(발급: https://build.nvidia.com — 무료 크레딧 제공)";
    const key = window.prompt(`${guide}\n저장하면 게이트웨이가 자동 재시작됩니다(약 10초).`);
    if (!key?.trim()) return;
    void registerModelKey(provider, key.trim())
      .then(() => {
        window.alert("키 등록 완료 — 게이트웨이 재시작 중입니다. 이제 모델 목록에서 선택할 수 있습니다.");
        setTimeout(refreshModels, 1000);
      })
      .catch((e) => window.alert(`실패: ${e.message}`));
  };

  const onSwitchModel = (id: string) => {
    if (!models || id === models.current || switching) return;
    const opt = models.options.find((o) => o.id === id);
    if (!window.confirm(`모든 에이전트의 모델을 "${opt?.label ?? id}"(으)로 바꿉니다.\n게이트웨이가 재시작됩니다(약 10초). 진행할까요?`)) return;
    setSwitching(true);
    void switchModel(id)
      .then(() => {
        setModelName(id);
        const agents = Object.fromEntries(AGENTS.map((a) => [a.id, id]));
        setModels({ ...models, current: id, agents });
        setAgentDraft(agents);
        window.alert("모델 전환 완료 — 게이트웨이 재시작 중입니다. 10초 뒤 🩺 전원 점검으로 확인해 보세요.");
      })
      .catch((e) => window.alert(`전환 실패: ${e.message}`))
      .finally(() => setSwitching(false));
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-title">에이전트</div>
      <ul className="agent-list">
        {AGENTS.map((a) => {
          const st = agentStatus[a.id] ?? "idle";
          const active = view === "chat" && activeAgent === a.id;
          const health = agentHealth[a.id];
          return (
            <li
              key={a.id}
              className={`agent-item ${active ? "active" : ""}`}
              onClick={() => selectAgent(a.id)}
              title={a.role}
            >
              <span className="agent-emoji" style={{ background: a.color + "22", borderColor: a.color + "55" }}>
                {a.emoji}
              </span>
              <span className="agent-meta">
                <span className="agent-name">{a.name}</span>
                <span className="agent-role">{a.role}</span>
              </span>
              {unreadByAgent[a.id] > 0 && (
                <span
                  className="report-badge"
                  title={`읽지 않은 보고서 ${unreadByAgent[a.id]}건 — GDD 패널 📋 또는 사무실 📋 탭에서 확인`}
                >
                  📋{unreadByAgent[a.id]}
                </span>
              )}
              {health && (
                <span
                  className={`health-mark ${health.ok ? "ok" : "bad"}`}
                  title={health.ok ? `응답 ${Math.round(health.ms / 1000)}초: ${health.reply ?? ""}` : health.error}
                >
                  {health.ok ? "✓" : "✗"}
                </span>
              )}
              <span className={`status-dot st-${st}`} title={STATUS_LABEL[st]} />
            </li>
          );
        })}
      </ul>
      <div className="sidebar-foot">
        <div className="model-box">
          <div className="model-box-title">🧠 AI 모델</div>
          {models ? (
            <>
              <select
                className="model-select"
                value={models.current}
                disabled={switching}
                onChange={(e) => onSwitchModel(e.target.value)}
                title={models.options.find((o) => o.id === models.current)?.note ?? ""}
              >
                {models.options.map((o) => (
                  <option key={o.id} value={o.id} title={o.note}>
                    {o.label}
                    {o.note ? ` — ${o.note}` : ""}
                  </option>
                ))}
              </select>
              <details className="agent-models">
                <summary title="PM은 헤드급 모델, 팀원은 경량 모델처럼 역할마다 다른 모델을 배정할 수 있습니다">
                  ⚙️ 역할별 모델 (PM만 강하게 등)
                </summary>
                {AGENTS.map((a) => (
                  <div key={a.id} className="agent-model-row">
                    <span className="agent-model-name" title={a.role}>
                      {a.emoji} {a.name.replace(" 디자이너", "").replace(" 라이터", "").replace(" 전략가", "").replace(" 디렉터", "")}
                    </span>
                    <select
                      className="model-select mini"
                      value={agentDraft[a.id] ?? models.current}
                      disabled={switching}
                      onChange={(e) => setAgentDraft((d) => ({ ...d, [a.id]: e.target.value }))}
                    >
                      {models.options.map((o) => (
                        <option key={o.id} value={o.id} title={o.note}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                <button className="btn small" onClick={onApplyAgentModels} disabled={!draftDirty || switching}>
                  {switching ? "적용 중…" : draftDirty ? "✅ 적용 (게이트웨이 재시작)" : "변경 없음"}
                </button>
              </details>
              {!models.providers.github && (
                <button className="btn small" onClick={() => onRegisterKey("github")} title="GitHub Models(GPT-5 계열)를 쓰려면 PAT 등록">
                  🔑 GitHub Models 토큰 등록
                </button>
              )}
              {!models.providers.nvidia && (
                <button className="btn small" onClick={() => onRegisterKey("nvidia")} title="NVIDIA NIM API(Qwen3 235B 등)를 쓰려면 키 등록">
                  🔑 NVIDIA API 키 등록
                </button>
              )}
            </>
          ) : (
            <span className="dim">{modelName}</span>
          )}
        </div>
        <button className="btn small" onClick={() => void healthCheck()} disabled={healthRunning}>
          {healthRunning ? (
            <>
              <span className="spinner" /> 점검 중… ({healthDone}/{AGENTS.length})
            </>
          ) : healthDone > 0 ? (
            `🩺 전원 점검 (${healthOk}/${healthDone} 정상) — 다시`
          ) : (
            "🩺 에이전트 전원 점검"
          )}
        </button>
        <button
          className="btn small"
          onClick={() => setKnowledgeOpen(true)}
          title="게임 기획 이론(재미 이론 등)을 제출하면 PM이 필요성을 검증하고, 승인된 것만 학습해 에이전트 판단에 반영합니다"
        >
          📚 지식 학습{knowledge.length > 0 ? ` (${knowledge.length})` : ""}
        </button>
        <button
          className="btn small"
          onClick={onBraveKey}
          title="Brave Search API 키를 등록하면 에이전트들이 웹 검색(web_search)을 쓸 수 있습니다. 페이지 조회(web_fetch)는 키 없이도 됩니다."
        >
          {braveOk ? "🔑 웹 검색 활성화됨 ✓ (키 변경)" : "🔑 웹 검색 키 등록"}
        </button>
        {conn !== "connected" && (
          <button className="btn small" onClick={() => void reconnect()}>
            🔌 게이트웨이 재연결
          </button>
        )}
        {conn === "error" && <div className="conn-hint">{connDetail}</div>}
        <a className="webchat-link" href="http://127.0.0.1:18789" target="_blank" rel="noreferrer">
          OpenClaw 기본 WebChat 열기 ↗
        </a>
      </div>
      {knowledgeOpen && <KnowledgeStudio onClose={() => setKnowledgeOpen(false)} />}
    </aside>
  );
}
