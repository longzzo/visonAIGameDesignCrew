import { useEffect, useRef, useState } from "react";
import { AGENT_MAP, SPECIALISTS } from "../lib/agents";
import { uiAlert, uiConfirm, uiPrompt } from "../lib/dialog";
import { getImportProgress, importNotionPage } from "../lib/notionSync";
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
    qaGate,
    setQaGate,
    buildDevKit,
    devKitBusy,
    devKitPhase,
    devKitLog,
    kitFiles,
    activeProject,
  } = useVE();
  const bottomRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [stickBottom, setStickBottom] = useState(true);

  const selectedCount = SPECIALISTS.filter((a) => selected[a.id]).length;

  const [importing, setImporting] = useState(false);
  const confirmImport = (name: string, text: string, note?: string) => {
    if (!text.trim()) {
      void uiAlert("문서에서 텍스트를 찾지 못했습니다 — 스캔 상태가 나쁘거나 빈 문서일 수 있습니다");
      return;
    }
    void uiConfirm(`"${name}" (${(text.length / 1000).toFixed(1)}천자) 가져오기`, {
      message: `${note ? `${note}\n\n` : ""}원문은 보고서함에 보관됩니다.\n\n[통합까지 진행] = PM 분배로 GDD에 통합 (기존 기획 유지·증분 반영)\n[보관만] = 보고서함에 저장만`,
      confirmLabel: "통합까지 진행",
      cancelLabel: "보관만",
    }).then((integrate) => void importDocument(name.replace(/\.(md|txt|markdown|pdf)$/i, ""), text, integrate));
  };
  // 노션 기획으로 시작 — 링크를 주면 허브+하위 기획서를 따라 읽어 같은 가져오기 흐름으로
  const [notionImporting, setNotionImporting] = useState(false);
  const [notionProgress, setNotionProgress] = useState("");
  const onImportNotion = async () => {
    if (notionImporting) return;
    const url = await uiPrompt("📓 노션 기획으로 시작", {
      message:
        "기획 허브(또는 기획서) 페이지 링크를 붙여넣으세요.\n하위 기획서 페이지까지 따라 읽어 한 문서로 정리합니다.\n⚠️ 그 페이지의 ⋯ 메뉴 → 연결(Connections)에 노션 통합이 추가되어 있어야 합니다.",
      placeholder: "https://www.notion.so/… 또는 https://app.notion.com/p/…",
    });
    if (!url?.trim()) return;
    setNotionImporting(true);
    setNotionProgress("");
    // 딥 리드가 도는 동안 진행률 폴링 — "허브 3/21 · 씬 시스템"
    const poll = setInterval(() => {
      void getImportProgress(url.trim()).then((p) => {
        if (p) setNotionProgress(`${p.done}/${p.total}${p.title ? ` · ${p.title.slice(0, 14)}` : ""}`);
      });
    }, 2000);
    try {
      const r = await importNotionPage(url.trim());
      const note = `📓 노션에서 ${r.pages}개 페이지를 읽었습니다${r.notes.length ? `\n· ${r.notes.join("\n· ")}` : ""}`;
      confirmImport(r.title || "노션 기획", r.md, note);
    } catch (e: any) {
      void uiAlert("노션 페이지를 읽지 못했습니다", String(e?.message ?? e));
    } finally {
      clearInterval(poll);
      setNotionImporting(false);
      setNotionProgress("");
    }
  };
  const onImportFile = (f: File | undefined) => {
    if (!f) return;
    if (/\.pdf$/i.test(f.name)) {
      // PDF → 서버에서 텍스트 추출(스캔본이면 로컬 OCR — 수 분 걸릴 수 있음) 후 동일한 가져오기 흐름
      setImporting(true);
      void f
        .arrayBuffer()
        .then((buf) =>
          fetch("/api/pdf-text", { method: "POST", headers: { "Content-Type": "application/pdf" }, body: buf })
        )
        .then(async (r) => {
          const j = await r.json();
          if (!r.ok || !j.ok) throw new Error(j.error || "PDF 추출 실패");
          confirmImport(f.name, String(j.text ?? ""), j.note ? `📷 ${j.note}` : undefined);
        })
        .catch((e) => void uiAlert(`PDF를 읽지 못했습니다: ${String(e?.message ?? e).slice(0, 120)}`))
        .finally(() => setImporting(false));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => confirmImport(f.name, String(reader.result ?? ""));
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
          <div className="quickstart-alt dim">
            이미 기획 문서가 있나요?{" "}
            <button className="btn small" onClick={() => fileRef.current?.click()} disabled={importing}>
              {importing ? "PDF 읽는 중…" : "📥 기존 기획(.pdf/.md/.txt)으로 시작"}
            </button>{" "}
            <button className="btn small" onClick={() => void onImportNotion()} disabled={notionImporting}>
              {notionImporting ? (
                <>
                  <span className="spinner" /> 노션 읽는 중{notionProgress ? ` ${notionProgress}` : "…"}
                </>
              ) : (
                "📓 노션 기획으로 시작"
              )}
            </button>{" "}
            — 팀이 문서를 학습해 GDD로 정리합니다
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
          <div className="chips-cluster">
            <div className="chips-cluster-title">
              담당자 선택{autoRoute ? " · 🎯 PM이 이 중에서 자동 배정합니다" : ` · 선택한 ${selectedCount}명 전원에게 전달`}
            </div>
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
            </div>
          </div>
          <details className="orch-opts-box">
            <summary>
              ⚙ 회의 옵션 — {autoRoute ? "자동분배" : "전원전달"} · {crossReview ? "교차검토" : "검토없음"} ·{" "}
              {qaGate ? "QA게이트" : "QA없음"} · 동시 {concurrency}
            </summary>
          <div className="orch-controls">
            <label title="PM이 지시를 먼저 분석해 관련 담당자에게만 배정합니다. 특정 지시는 한 명에게만 갈 수도 있습니다. 끄면 위에서 선택한 전원에게 전달됩니다.">
              <input type="checkbox" checked={autoRoute} onChange={(e) => setAutoRoute(e.target.checked)} disabled={orchRunning} />
              🎯 PM 자동 분배
            </label>
            <label title="동료 에이전트가 초안을 검토하고, 작성자가 수정해 확정 (호출 수 3배)">
              <input type="checkbox" checked={crossReview} onChange={(e) => setCrossReview(e.target.checked)} disabled={orchRunning} />
              교차 검토
            </label>
            <label title="QA 디렉터가 산출물을 루브릭(완결성·구체성·일관성·구현가능성)으로 채점하고, 미달이면 1회 반려·재작성시킵니다 (호출 수 증가)">
              <input type="checkbox" checked={qaGate} onChange={(e) => setQaGate(e.target.checked)} disabled={orchRunning} />
              🧪 QA 게이트
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
          </div>
          </details>
          {orchRunning ? (
            <div className="orch-actions">
              <button className="btn danger" onClick={stopOrch}>
                ⏹ 진행 중단
              </button>
            </div>
          ) : (
            <div className="orch-actions">
              <input
                ref={fileRef}
                type="file"
                accept=".md,.txt,.markdown,.pdf"
                style={{ display: "none" }}
                onChange={(e) => {
                  onImportFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <div className="act-primary">
                <button className="btn primary" onClick={() => void startOrch()} disabled={!orchRequest.trim()}>
                  🚀 시작
                </button>
                <button
                  className="btn"
                  onClick={() => void fullMeeting()}
                  disabled={!orchRequest.trim()}
                  title="전원 + 교차 검토 + GDD 반영으로 즉시 시작"
                >
                  🎪 풀 기획 회의
                </button>
              </div>
              <div className="act-secondary">
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
                    "☀️ 브리핑"
                  )}
                </button>
                <button
                  className="btn"
                  onClick={() => void collabSession()}
                  disabled={!orchRequest.trim() || selectedCount < 2 || selectedCount > 4}
                  title="선택한 에이전트 2~4명이 주제를 놓고 서로 직접 대화하며 결론을 만듭니다 (예: BM+UI/UX+시스템 → 수익모델·컨텐츠 활용 방안). 결론은 보고서함에 저장"
                >
                  🤝 협업{selectedCount >= 2 && selectedCount <= 4 ? ` (${selectedCount})` : ""}
                </button>
                <button
                  className="btn"
                  onClick={() => fileRef.current?.click()}
                  disabled={importing}
                  title="기존에 갖고 있던 기획 문서(.pdf/.md/.txt)를 불러옵니다 — 원문은 보고서함에 보관되고, 원하면 PM 분배로 GDD에 통합됩니다"
                >
                  {importing ? (
                    <>
                      <span className="spinner" /> PDF…
                    </>
                  ) : (
                    "📥 기획 가져오기"
                  )}
                </button>
                <button
                  className="btn"
                  onClick={() => void onImportNotion()}
                  disabled={notionImporting}
                  title="노션 기획 페이지 링크를 주면 하위 기획서까지 따라 읽어 가져옵니다 — 원문은 보고서함에 보관되고, 원하면 PM 분배로 GDD에 통합됩니다"
                >
                  {notionImporting ? (
                    <>
                      <span className="spinner" /> 노션 {notionProgress || "…"}
                    </>
                  ) : (
                    "📓 노션 가져오기"
                  )}
                </button>
                <button
                  className="btn"
                  onClick={() => void buildDevKit()}
                  disabled={devKitBusy}
                  title="현재 GDD를 근거로 유니티 개발 문서 + 밸런스 CSV + 에셋 매니페스트 + 유니티 스켈레톤 코드 + 플레이 가능한 그레이박스를 체인으로 생성하고 ZIP 하나로 내보냅니다"
                >
                  {devKitBusy ? (
                    <>
                      <span className="spinner" /> 킷…
                    </>
                  ) : (
                    "📦 개발 킷"
                  )}
                </button>
              </div>
            </div>
          )}
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

      {/* 개발 착수 킷 — 진행 로그 + 완성 파일 목록 + ZIP 다운로드 */}
      {(devKitBusy || devKitLog.length > 0) && (
        <div className="devkit-panel">
          <div className="devkit-head">
            <b>📦 개발 착수 킷</b>
            {devKitBusy && devKitPhase && (
              <span className="dim">
                <span className="spinner" /> {devKitPhase}
              </span>
            )}
            {!devKitBusy && kitFiles.length > 0 && (
              <a className="btn small primary" href={`/api/kit/zip?project=${encodeURIComponent(activeProject)}`}>
                ⬇️ ZIP 다운로드 ({kitFiles.length}개 파일 + GDD/보고서)
              </a>
            )}
          </div>
          {devKitLog.length > 0 && (
            <ul className="devkit-log">
              {devKitLog.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
          {!devKitBusy && kitFiles.length > 0 && (
            <div className="devkit-files dim">
              {kitFiles.map((f) => (
                <a
                  key={f.path}
                  href={`/api/kit/file?project=${encodeURIComponent(activeProject)}&path=${encodeURIComponent(f.path)}`}
                  target="_blank"
                  rel="noreferrer"
                  title={`${(f.size / 1000).toFixed(1)}KB`}
                >
                  {f.path.endsWith(".html") ? "🕹️" : f.path.endsWith(".csv") ? "📊" : "📄"} {f.path}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

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
