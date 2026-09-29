import { useEffect, useRef, useState } from "react";
import { AGENT_MAP } from "../lib/agents";
import { uiConfirm } from "../lib/dialog";
import { searchObsidian, type ObsidianSearchHit } from "../lib/obsidian";
import {
  DEFAULT_CONTEXT_POLICY,
  getContextSnapshot,
  saveContextPolicy,
  type ContextPolicy,
  type ContextSnapshot,
} from "../lib/context";
import { useVE } from "../store";
import { Markdown } from "./Markdown";

/**
 * 지식 라이브러리 — 오너가 아는 기획 이론(재미 이론 등)을 제출하면
 * PM이 "이 스튜디오에 필요한가"를 검증하고, 승인된 것만 학습(저장)한다.
 * 학습된 지식은 해당 역할의 프롬프트에 요약본으로 주입된다.
 */
export function KnowledgeStudio({ onClose }: { onClose: () => void }) {
  const {
    knowledge,
    loadKnowledge,
    submitKnowledge,
    pendingKnowledge,
    approveKnowledge,
    dismissKnowledge,
    removeKnowledge,
    obsidian,
    obsidianNotes,
    loadObsidian,
    learnFromObsidian,
    activeProject,
  } = useVE();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // 📚 사서 — 볼트 전문 검색
  const [libQ, setLibQ] = useState("");
  const [libHits, setLibHits] = useState<ObsidianSearchHit[] | null>(null);
  const [libBusy, setLibBusy] = useState(false);
  const [contextInfo, setContextInfo] = useState<ContextSnapshot | null>(null);
  const [contextPolicy, setContextPolicy] = useState<ContextPolicy>(DEFAULT_CONTEXT_POLICY);
  const [contextBusy, setContextBusy] = useState(false);
  const [contextError, setContextError] = useState("");
  const loadContext = async (rebuild = false) => {
    if (!activeProject || contextBusy) return;
    setContextBusy(true);
    setContextError("");
    try {
      const info = await getContextSnapshot(activeProject, rebuild);
      setContextInfo(info);
      setContextPolicy(info.policy);
    } catch (e: any) {
      setContextError(String(e?.message ?? e));
    } finally {
      setContextBusy(false);
    }
  };
  const applyContextPolicy = async () => {
    if (!activeProject || contextBusy) return;
    setContextBusy(true);
    setContextError("");
    try {
      const info = await saveContextPolicy(activeProject, contextPolicy);
      setContextInfo(info);
      setContextPolicy(info.policy);
    } catch (e: any) {
      setContextError(String(e?.message ?? e));
    } finally {
      setContextBusy(false);
    }
  };
  const runLibSearch = async () => {
    if (!libQ.trim() || libBusy) return;
    setLibBusy(true);
    try {
      setLibHits(await searchObsidian(libQ.trim()));
    } finally {
      setLibBusy(false);
    }
  };

  useEffect(() => {
    void loadKnowledge();
    void loadObsidian();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeProject) void loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject]);

  const pk = pendingKnowledge;
  const busy = pk?.status === "running";

  const agentLabel = (ids?: string[]) =>
    !ids || ids.includes("all")
      ? "전원"
      : ids.map((id) => AGENT_MAP[id]?.name ?? id).join(", ");

  return (
    <div className="doc-viewer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="doc-window art-studio">
        <div className="doc-head">
          <div className="head-meta">
            <div className="head-name">📚 지식 라이브러리</div>
            <div className="head-role dim">
              이론을 제출하면 PM이 필요성을 검증하고, 승인된 것만 학습해 해당 역할의 판단에 주입됩니다
            </div>
          </div>
          <button className="btn small" onClick={onClose} title="닫기 (Esc)">
            ✕ 닫기
          </button>
        </div>

        <div className="knowledge-form">
          <input
            className="knowledge-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder='지식 제목 — 예: "라프 코스터의 재미 이론", "훅 모델 (Hooked)"'
            disabled={busy}
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="이론 내용을 붙여넣으세요 (긴 글도 좋습니다 — PM이 실무용으로 압축합니다). 파일로 불러와도 됩니다."
            rows={5}
            disabled={busy}
          />
          <div className="knowledge-actions">
            <input
              ref={fileRef}
              type="file"
              accept=".md,.txt,.markdown"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  const reader = new FileReader();
                  reader.onload = () => {
                    setContent(String(reader.result ?? ""));
                    if (!title.trim()) setTitle(f.name.replace(/\.(md|txt|markdown)$/i, ""));
                  };
                  reader.readAsText(f);
                }
                e.target.value = "";
              }}
            />
            <button className="btn small" onClick={() => fileRef.current?.click()} disabled={busy}>
              📄 파일에서 불러오기
            </button>
            <button
              className="btn primary"
              disabled={busy || !title.trim() || content.trim().length < 50}
              onClick={() => void submitKnowledge(title.trim(), content.trim())}
              title="PM이 이 지식이 스튜디오에 필요한지 검증합니다"
            >
              {busy ? "PM 검증 중…" : "🎯 PM 검증 요청"}
            </button>
          </div>
        </div>

        <section className="context-manager" aria-label="AI 컨텍스트 관리자">
          <div className="context-manager-head">
            <div>
              <b>🧠 AI 컨텍스트 관리자</b>
              <div className="dim">전체 원문은 보존하고, AI에는 예산 안의 관련 기억만 전달합니다.</div>
            </div>
            <span className={`context-status ${contextInfo?.stale ? "stale" : ""}`}>
              {contextBusy ? "갱신 중" : contextInfo?.stale ? "갱신 필요" : contextInfo ? "체크포인트 최신" : "준비 중"}
            </span>
          </div>

          <div className="context-metrics">
            <div><span>원문 추정</span><strong>{(contextInfo?.sourceTokens ?? 0).toLocaleString()}</strong><small>tokens</small></div>
            <div><span>압축 체크포인트</span><strong>{(contextInfo?.packetTokens ?? 0).toLocaleString()}</strong><small>tokens</small></div>
            <div className="saved"><span>예상 절감</span><strong>{contextInfo?.reductionPercent ?? 0}%</strong><small>{(contextInfo?.savedTokens ?? 0).toLocaleString()} tokens</small></div>
          </div>

          <div className="context-policy-row">
            <label>
              회의 공유 기억 예산
              <select
                value={contextPolicy.budgetTokens}
                onChange={(e) => setContextPolicy((p) => ({ ...p, budgetTokens: Number(e.target.value) }))}
                disabled={contextBusy}
              >
                <option value={1200}>절약 · 1,200 토큰</option>
                <option value={2400}>균형 · 2,400 토큰</option>
                <option value={4000}>심층 · 4,000 토큰</option>
                <option value={6000}>최대 · 6,000 토큰</option>
              </select>
            </label>
            <label className="context-check">
              <input
                type="checkbox"
                checked={contextPolicy.autoSnapshot}
                onChange={(e) => setContextPolicy((p) => ({ ...p, autoSnapshot: e.target.checked }))}
              />
              변경 시 자동 압축
            </label>
            <label className="context-check">
              <input
                type="checkbox"
                checked={contextPolicy.obsidianMirror}
                onChange={(e) => setContextPolicy((p) => ({ ...p, obsidianMirror: e.target.checked }))}
              />
              Obsidian에 장기 기억 저장
            </label>
          </div>

          <div className="context-actions">
            <button className="btn primary small" onClick={() => void applyContextPolicy()} disabled={!activeProject || contextBusy}>
              설정 저장
            </button>
            <button className="btn small" onClick={() => void loadContext(true)} disabled={!activeProject || contextBusy}>
              ↻ 지금 다시 압축
            </button>
            {contextInfo?.notePath && <span className="dim context-path" title={contextInfo.notePath}>🗃️ {contextInfo.notePath}</span>}
          </div>
          {contextError && <div className="art-phase error">⚠️ {contextError}</div>}
          {contextInfo?.packet && (
            <details className="context-preview">
              <summary>압축된 체크포인트 미리보기</summary>
              <Markdown text={contextInfo.packet} />
            </details>
          )}
          <div className="context-note dim">
            정본 수치와 현재 담당 섹션은 별도 필수 영역으로 유지합니다. 절약 예산은 결정·과거 기록·Obsidian 노트·조사 자료의 중복을 줄이는 데 적용됩니다.
          </div>
        </section>

        {/* 옵시디안 볼트 — #ve-학습 태그 노트를 학습 후보로 */}
        {obsidian?.connected && (
          <div className="obsidian-box">
            <div className="obsidian-head">
              <b>🗃️ 옵시디안 볼트</b>
              <span className="dim obsidian-path" title={obsidian.vault ?? ""}>
                {obsidian.vault}
              </span>
              <button className="btn tiny" onClick={() => void loadObsidian()} title="볼트 다시 스캔">
                🔄
              </button>
            </div>
            <div className="dim obsidian-hint">
              볼트 노트에 <code>#{obsidian.learnTag}</code> 태그를 달면 여기 나타납니다 · frontmatter{" "}
              <code>agents: [bm, uiux]</code>로 대상 지정 가능 · 보고서·GDD는 볼트 <code>VisionEngine/</code>에 자동
              보관됩니다 · 회의 시작 시 📚 사서가 지시와 관련된 볼트 노트를 자동으로 찾아 팀에 배포합니다
            </div>
            {/* 📚 사서 — 볼트 전문 검색 (태그 없이도 제목·본문 검색) */}
            <div className="obsidian-search">
              <input
                value={libQ}
                onChange={(e) => setLibQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void runLibSearch()}
                placeholder="📚 사서에게 볼트 검색 — 예: 김치 등급, 시장, 발효"
              />
              <button className="btn tiny" disabled={!libQ.trim() || libBusy} onClick={() => void runLibSearch()}>
                {libBusy ? "검색 중…" : "🔎 검색"}
              </button>
            </div>
            {libHits !== null && (
              <div className="obsidian-hits">
                {libHits.length === 0 && <div className="dim obsidian-empty">일치하는 노트가 없습니다.</div>}
                {libHits.map((h) => (
                  <div key={h.path} className="obsidian-hit">
                    <div className="obsidian-hit-title" title={h.path}>
                      {h.fromExport ? "🗂️ " : "📝 "}
                      {h.title}
                      <span className="dim"> · {new Date(h.mtime).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}</span>
                    </div>
                    <div className="obsidian-hit-snippet dim">{h.snippet}</div>
                  </div>
                ))}
              </div>
            )}
            {obsidianNotes.length === 0 ? (
              <div className="dim obsidian-empty">아직 #{obsidian.learnTag} 태그가 달린 노트가 없습니다.</div>
            ) : (
              <ul className="obsidian-notes">
                {obsidianNotes.map((n) => (
                  <li key={n.path}>
                    <span className={`obsidian-state os-${n.state}`}>
                      {n.state === "new" ? "신규" : n.state === "updated" ? "갱신됨" : "학습됨"}
                    </span>
                    <span className="obsidian-title" title={n.path}>
                      {n.title}
                    </span>
                    <span className="dim">
                      {new Date(n.mtime).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}
                    </span>
                    {n.state === "learned" ? (
                      <span className="dim">✓</span>
                    ) : (
                      <button
                        className="btn tiny"
                        disabled={busy}
                        onClick={() => void learnFromObsidian(n.path)}
                        title="PM이 필요성을 검증한 뒤 학습합니다 — 갱신 학습은 이전 버전을 대체"
                      >
                        {n.state === "updated" ? "🔄 다시 학습" : "🎯 학습"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {pk?.status === "running" && (
          <div className="art-phase">
            <span className="spinner" /> 🎯 PM이 이 지식의 필요성을 검토 중…
          </div>
        )}
        {pk?.status === "error" && <div className="art-phase error">⚠️ 검증 실패: {pk.error}</div>}
        {pk?.status === "rejected" && (
          <div className="verify-card" style={{ margin: "8px 14px" }}>
            <div className="verify-head">🎯 PM 판정 — 학습 불필요</div>
            <p className="dim">{pk.reason || "이 스튜디오의 업무와 직접적인 관련이 낮다고 판단했습니다."}</p>
            <div className="verify-actions">
              <button className="btn" onClick={dismissKnowledge}>
                확인
              </button>
            </div>
          </div>
        )}
        {pk?.status === "ready" && (
          <div className="verify-card" style={{ margin: "8px 14px" }}>
            <div className="verify-head">🎯 PM 판정 — 학습 권고</div>
            <p className="dim">{pk.reason}</p>
            <details className="verify-preview" open>
              <summary>
                압축 요약 (프롬프트에는 이것이 주입됩니다) · 적용:{" "}
                {pk.presetAgents?.length ? `${agentLabel(pk.presetAgents)} (노트 지정)` : agentLabel(pk.agents)}
                {pk.source?.startsWith("obsidian:") ? " · 출처: 옵시디안" : ""}
              </summary>
              <Markdown text={pk.summary ?? ""} />
            </details>
            <div className="verify-actions">
              <button
                className="btn primary"
                onClick={() => {
                  void approveKnowledge().then(() => {
                    setTitle("");
                    setContent("");
                  });
                }}
              >
                ✅ 학습시키기
              </button>
              <button className="btn" onClick={dismissKnowledge}>
                ❌ 학습 안 함
              </button>
            </div>
          </div>
        )}

        <div className="doc-body">
          {knowledge.length === 0 && !pk && (
            <div className="empty-hint">
              아직 학습된 지식이 없습니다.
              <br />
              <span className="dim">재미 이론, 몰입 이론, 과금 심리학 등 알고 계신 이론을 위에 붙여넣어 보세요.</span>
            </div>
          )}
          {knowledge.length > 3 && (
            <input
              className="list-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="🔎 지식 검색 (제목·요약)"
            />
          )}
          {knowledge
            .filter(
              (k) =>
                !query.trim() ||
                `${k.title} ${k.summary}`.toLowerCase().includes(query.trim().toLowerCase())
            )
            .map((k) => (
            <details key={k.ts} className="knowledge-item">
              <summary>
                <b>📖 {k.title}</b>
                <span className="dim">
                  {" "}
                  · 적용: {agentLabel(k.agents)} · {new Date(k.ts).toLocaleDateString("ko-KR")}
                  {k.source?.startsWith("obsidian:") ? " · 🗃️ 옵시디안" : ""}
                </span>
                <button
                  className="btn tiny"
                  onClick={(e) => {
                    e.preventDefault();
                    void uiConfirm(`"${k.title}" 지식을 잊게 할까요?`, {
                      message: "휴지통(workspace/knowledge/.trash)으로 이동합니다.",
                      confirmLabel: "🗑 잊기",
                      danger: true,
                    }).then((ok) => ok && void removeKnowledge(k.ts));
                  }}
                >
                  🗑
                </button>
              </summary>
              <div className="knowledge-summary">
                <Markdown text={k.summary} />
              </div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
