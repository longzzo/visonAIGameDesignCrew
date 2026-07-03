import { useEffect, useRef, useState } from "react";
import { AGENT_MAP, SPECIALISTS } from "../lib/agents";
import { uiAlert, uiConfirm } from "../lib/dialog";
import { useVE, type FeedMsg } from "../store";
import { Markdown } from "./Markdown";

function Elapsed({ from, to }: { from?: number; to?: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!from || to) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [from, to]);
  if (!from) return null;
  const sec = Math.round(((to ?? Date.now()) - from) / 1000);
  return <span className="elapsed">{sec}s</span>;
}

const KIND_LABEL: Record<FeedMsg["kind"], string> = {
  request: "요청",
  instruction: "지시",
  draft: "초안",
  review: "검토",
  revision: "수정본",
  summary: "통합",
  status: "",
  error: "",
  talk: "협업",
};

function who(id: string): { name: string; emoji: string; color: string } {
  if (id === "user") return { name: "오너", emoji: "👤", color: "#9aa5b5" };
  if (id === "system") return { name: "시스템", emoji: "🛠️", color: "#9aa5b5" };
  const a = AGENT_MAP[id];
  return a ? { name: a.name, emoji: a.emoji, color: a.color } : { name: id, emoji: "❔", color: "#9aa5b5" };
}

/** 말풍선 하나 — 긴 내용은 접어서 표시 */
function FeedBubble({ m }: { m: FeedMsg }) {
  const f = who(m.from);
  const t = m.to ? who(m.to) : null;
  const time = new Date(m.ts).toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit" });

  if (m.kind === "status" || m.kind === "error") {
    return (
      <div className={`feed-status ${m.kind === "error" ? "error" : ""}`}>
        {m.from !== "system" && (
          <span className="feed-status-from" style={{ color: f.color }}>
            {f.emoji} {f.name}
          </span>
        )}
        <span>{m.text}</span>
        <span className="feed-time">{time}</span>
      </div>
    );
  }

  const long = m.text.length > 350;
  const isUser = m.from === "user";
  return (
    <div className={`feed-msg ${isUser ? "from-user" : ""}`}>
      <span className="feed-avatar" style={{ background: f.color + "22", borderColor: f.color + "66" }}>
        {f.emoji}
      </span>
      <div className="feed-body" style={{ borderColor: f.color + "44" }}>
        <div className="feed-head">
          <b style={{ color: f.color }}>{f.name}</b>
          {t && (
            <span className="feed-to">
              → {t.emoji} {t.name}
            </span>
          )}
          {KIND_LABEL[m.kind] && <span className={`feed-kind k-${m.kind}`}>{KIND_LABEL[m.kind]}</span>}
          <span className="feed-time">{time}</span>
        </div>
        {long ? (
          <details className="feed-long">
            <summary>
              <span className="feed-preview">{m.text.slice(0, 180).replace(/\n/g, " ")}…</span>
              <span className="dim"> (펼치기, {m.text.length.toLocaleString()}자)</span>
            </summary>
            <Markdown text={m.text} />
          </details>
        ) : (
          <Markdown text={m.text} />
        )}
      </div>
    </div>
  );
}

export function OrchestrationView() {
  const {
    orchRequest,
    setOrchRequest,
    selected,
    toggleSelected,
    collabSession,
    importDocument,
    concurrency,
    setConcurrency,
    autoReflect,
    setAutoReflect,
    crossReview,
    setCrossReview,
    webResearch,
    setWebResearch,
    autoRoute,
    setAutoRoute,
    braveOk,
    orchRunning,
    startOrch,
    stopOrch,
    fullMeeting,
    cards,
    feed,
    clearFeed,
    reflectToGdd,
    gdd,
    dailyBriefing,
    briefingBusy,
    modelName,
    orchBaseline,
    setMeetingDiffOpen,
  } = useVE();
  const bottomRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [stickBottom, setStickBottom] = useState(true);

  const selectedCount = SPECIALISTS.filter((a) => selected[a.id]).length;

  const onImportFile = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      if (!text.trim()) {
        void uiAlert("빈 파일입니다");
        return;
      }
      void uiConfirm(`"${f.name}" (${(text.length / 1000).toFixed(1)}천자) 가져오기`, {
        message: "원문은 보고서함에 보관됩니다.\n\n[통합까지 진행] = PM 분배로 GDD에 통합 (기존 기획 유지·증분 반영)\n[보관만] = 보고서함에 저장만",
        confirmLabel: "통합까지 진행",
        cancelLabel: "보관만",
      }).then((integrate) => void importDocument(f.name.replace(/\.(md|txt)$/i, ""), text, integrate));
    };
    reader.readAsText(f);
  };

  useEffect(() => {
    if (stickBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed.length, stickBottom]);

  const cardList = ["pm", ...SPECIALISTS.map((a) => a.id)].filter((id) => cards[id]).map((id) => cards[id]);

  // 아직 기획이 거의 빈 프로젝트 — 아이디어 한 줄로 시작하는 퀵스타트를 보여준다
  const emptySections = (gdd.match(/아직 작성되지 않음/g) ?? []).length;
  const isFreshProject = gdd.length > 0 && emptySections >= 8 && !orchRunning && feed.length === 0;

  return (
    <section className="orch-view">
      {isFreshProject && (
        <div className="quickstart">
          <div className="quickstart-title">🎬 새 게임, 아이디어 한 줄이면 됩니다</div>
          <div className="quickstart-sub dim">
            떠오른 컨셉을 적고 회의를 열면 — PM이 지휘하고 10명의 팀이 세계관·게임플레이·시스템·아트·일정까지 첫
            GDD를 한 번에 만듭니다.
          </div>
          <div className="quickstart-row">
            <input
              value={orchRequest}
              onChange={(e) => setOrchRequest(e.target.value)}
              placeholder='예: "달빛 아래에서만 힘이 강해지는 너구리 닌자 로그라이크"'
              onKeyDown={(e) => {
                if (e.key === "Enter" && orchRequest.trim()) void fullMeeting();
              }}
            />
            <button className="btn primary" onClick={() => void fullMeeting()} disabled={!orchRequest.trim()}>
              🎪 풀 기획 회의로 시작
            </button>
          </div>
        </div>
      )}
      <div className="orch-form">
        <textarea
          value={orchRequest}
          onChange={(e) => setOrchRequest(e.target.value)}
          placeholder={'새 지시사항을 입력하세요 — 기존 기획은 유지되고 지시만 반영됩니다. 예: "전투를 턴제로 바꿔줘", "겨울 시즌 이벤트 추가해줘" (첫 기획이면 컨셉을 자유롭게)'}
          rows={2}
          disabled={orchRunning}
        />
        <div className="orch-options">
          <div className="chips">
            {SPECIALISTS.map((a) => (
              <button
                key={a.id}
                className={`chip ${selected[a.id] ? "on" : ""}`}
                style={selected[a.id] ? { borderColor: a.color, color: a.color } : undefined}
                onClick={() => toggleSelected(a.id)}
                disabled={orchRunning}
                title={a.role}
              >
                {a.emoji} {a.name.replace(" 디자이너", "").replace(" 라이터", "").replace(" 전략가", "").replace(" 디렉터", "")}
              </button>
            ))}
            {autoRoute && <span className="dim chips-hint">← PM이 이 중에서 담당자를 골라 배정합니다</span>}
          </div>
          <div className="orch-controls">
            <label title="PM이 지시를 먼저 분석해 관련 담당자에게만 배정합니다. 특정 지시는 한 명에게만 갈 수도 있습니다. 끄면 위에서 선택한 전원에게 전달됩니다.">
              <input type="checkbox" checked={autoRoute} onChange={(e) => setAutoRoute(e.target.checked)} disabled={orchRunning} />
              🎯 PM 자동 분배
            </label>
            <label title="동료 에이전트가 초안을 검토하고, 작성자가 수정해 확정 (호출 수 3배)">
              <input type="checkbox" checked={crossReview} onChange={(e) => setCrossReview(e.target.checked)} disabled={orchRunning} />
              교차 검토
            </label>
            <label
              title={
                braveOk
                  ? "에이전트가 web_search/web_fetch로 인터넷 조사를 할 수 있게 허용"
                  : "검색 키가 없어 페이지 조회(web_fetch)만 사용됩니다 — 사이드바 🔑에서 Brave 키를 등록하면 검색도 가능"
              }
            >
              <input type="checkbox" checked={webResearch} onChange={(e) => setWebResearch(e.target.checked)} disabled={orchRunning} />
              🌐 웹 리서치{webResearch && !braveOk ? <span className="dim"> (조회만)</span> : null}
            </label>
            <label>
              <input type="checkbox" checked={autoReflect} onChange={(e) => setAutoReflect(e.target.checked)} />
              GDD 자동 반영
            </label>
            <label title="동시에 일하는 에이전트 수 — 로컬 모델(GPU 1개)은 1 권장, 클라우드 모델(GitHub/NVIDIA)이면 4~7로 올려 전원이 동시에 일하는 모습을 볼 수 있습니다">
              동시{" "}
              <select value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} disabled={orchRunning}>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={4}>4</option>
                <option value={7}>7</option>
              </select>
            </label>
            {orchRunning ? (
              <button className="btn danger" onClick={stopOrch}>
                ⏹ 중단
              </button>
            ) : (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".md,.txt,.markdown"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    onImportFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <button
                  className="btn"
                  onClick={() => fileRef.current?.click()}
                  title="기존에 갖고 있던 기획 문서(.md/.txt)를 불러옵니다 — 원문은 보고서함에 보관되고, 원하면 PM 분배로 GDD에 통합됩니다"
                >
                  📥 문서 가져오기
                </button>
                <button
                  className="btn"
                  onClick={() => void dailyBriefing()}
                  disabled={briefingBusy}
                  title="PM이 기획 현황·오늘 추천 작업 3가지·리스크를 정리해 PM 대화방으로 보고합니다 — 출근하면 한 번"
                >
                  {briefingBusy ? (
                    <>
                      <span className="spinner" /> 브리핑…
                    </>
                  ) : (
                    "☀️ 오늘의 브리핑"
                  )}
                </button>
                <button
                  className="btn"
                  onClick={() => void collabSession()}
                  disabled={!orchRequest.trim() || selectedCount < 2 || selectedCount > 4}
                  title="선택한 에이전트 2~4명이 주제를 놓고 서로 직접 대화하며 결론을 만듭니다 (예: BM+UI/UX+시스템 → 수익모델·컨텐츠 활용 방안). 결론은 보고서함에 저장"
                >
                  🤝 협업 세션{selectedCount >= 2 && selectedCount <= 4 ? ` (${selectedCount}명)` : ""}
                </button>
                <button
                  className="btn"
                  onClick={() => void fullMeeting()}
                  disabled={!orchRequest.trim()}
                  title="전원 + 교차 검토 + GDD 반영으로 즉시 시작"
                >
                  🎪 풀 기획 회의
                </button>
                <button className="btn primary" onClick={() => void startOrch()} disabled={!orchRequest.trim()}>
                  🚀 시작
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 진행률 요약 — 몇 명 끝났고 얼마나 걸리고 있는지 한 줄 */}
      {orchRunning && cardList.length > 0 && (() => {
        const done = cardList.filter((c) => c.state === "done").length;
        const total = cardList.length;
        const started = Math.min(...cardList.map((c) => c.startedAt ?? Date.now()));
        const elapsed = Math.round((Date.now() - started) / 1000);
        const eta = done > 0 ? Math.round((elapsed / done) * (total - done)) : null;
        const isLocal = modelName.startsWith("ollama/");
        return (
          <div className="orch-progress">
            <div className="orch-progress-bar">
              <i style={{ width: `${Math.round((done / total) * 100)}%` }} />
            </div>
            <span>
              {done}/{total} 완료 · 경과 {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
              {eta !== null && eta > 5 ? ` · 남은 예상 ~${Math.max(1, Math.round(eta / 60))}분` : ""}
              {isLocal ? " · ⚠️ 로컬 모델은 오래 걸립니다 (동시 1 권장)" : ""}
            </span>
          </div>
        );
      })()}

      {/* 진행 상태 스트립 */}
      {cardList.length > 0 && (
        <div className="status-strip">
          {cardList.map((c) => {
            const a = AGENT_MAP[c.agentId];
            return (
              <div key={c.agentId} className={`strip-item ${c.state}`} title={c.error ?? c.phase ?? ""}>
                <span className="strip-emoji">{a.emoji}</span>
                <span className="strip-name">{a.name.split(" ")[0]}</span>
                {c.state === "running" && <span className="spinner" />}
                {c.state === "done" && <span className="strip-ok">✓</span>}
                {c.state === "error" && <span className="strip-bad">✗</span>}
                {(c.state === "queued" || c.state === "pending") && <span className="dim">·</span>}
                {c.phase && <span className="strip-phase">{c.phase}</span>}
                <Elapsed from={c.startedAt} to={c.endedAt} />
                {c.state === "done" && !c.reflected && (
                  <button className="btn tiny" onClick={() => void reflectToGdd(c.agentId, c.output)} title="GDD에 반영">
                    📌
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 에이전트 대화 피드 */}
      <div
        className="feed-scroll"
        ref={feedRef}
        onScroll={() => {
          const el = feedRef.current;
          if (!el) return;
          setStickBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
        }}
      >
        {feed.length === 0 && (
          <div className="empty-hint">
            요청을 입력하고 <b>🚀 시작</b>을 누르면 PM과 에이전트들이
            <br />
            지시 → 초안 → 동료 검토 → 수정 → 통합을 <b>대화로 주고받는 과정</b>이 여기에 표시됩니다.
          </div>
        )}
        {feed.map((m) => (
          <FeedBubble key={m.id} m={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      {feed.length > 0 && !orchRunning && (
        <div className="feed-foot">
          <button className="btn tiny" onClick={clearFeed} title="이 프로젝트의 대화 기록을 지웁니다">
            🧹 피드 비우기
          </button>
          {orchBaseline !== null && orchBaseline !== gdd && (
            <button
              className="btn tiny primary"
              onClick={() => setMeetingDiffOpen(true)}
              title="이번 회의가 GDD를 어떻게 바꿨는지 섹션별 diff로 확인하고, 원하면 통째로 되돌립니다"
            >
              🔍 이번 회의 변경 확인
            </button>
          )}
          <span className="dim">피드는 프로젝트별로 자동 저장됩니다 ({feed.length}건)</span>
        </div>
      )}
    </section>
  );
}
