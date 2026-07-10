import { useEffect, useMemo, useState } from "react";
import { AGENT_MAP } from "../lib/agents";
import { downloadReport } from "../lib/reports";
import { artFileUrl } from "../lib/art";
import { uiAlert, uiConfirm, uiPrompt } from "../lib/dialog";
import { getNotionStatus, publishNotion, setupNotion, type NotionStatus } from "../lib/notionSync";
import { useVE } from "../store";
import { Markdown } from "./Markdown";
import { NotionStudio } from "./NotionStudio";
import { ReportVerifyFlow } from "./ReportVerifyFlow";

/**
 * 전체화면 문서 뷰어 — GDD·보고서·아트 보관함을 큰 화면에서 본다.
 * 스토어의 docViewer 플래그로 어디서든 열 수 있는 전역 모달.
 *   · GDD:   왼쪽 섹션 목차 + 읽기 좋은 폭의 본문
 *   · 보고서: 왼쪽 목록 + 오른쪽 본문(가치검증 포함)
 *   · 아트:   생성된 컨셉 아트 갤러리 + "새 컨셉 아트"로 스튜디오 열기
 */
export function DocViewer() {
  const {
    docViewer: tab,
    openDocViewer,
    closeDocViewer,
    gdd,
    reports,
    reportPreview,
    openReport,
    artImages,
    activeProject,
    setArtStudioOpen,
    removeArt,
    attachArtToGdd,
  } = useVE();
  const [attached, setAttached] = useState<number[]>([]);
  // 노션 발행 — 아키비스트(📚)가 GDD·보고서를 오너 노션에 레퍼런스 디자인으로 발행
  const [notion, setNotion] = useState<NotionStatus | null>(null);
  const [publishing, setPublishing] = useState(false);
  // 노션 편집실 — 링크를 주면 읽고 분석해 요구대로 수정
  const [notionStudio, setNotionStudio] = useState(false);
  useEffect(() => {
    if (tab) void getNotionStatus().then(setNotion).catch(() => setNotion(null));
  }, [tab]);

  const onNotionSetup = async () => {
    const token = await uiPrompt("노션 연동 ① 통합 토큰", {
      message:
        "notion.so/my-integrations 에서 내부 통합(Internal Integration)을 만들고 토큰(ntn_…)을 붙여넣으세요.\n토큰은 이 PC의 config/notion.json에만 저장됩니다 (커밋 제외).",
      placeholder: "ntn_…",
    });
    if (!token?.trim()) return;
    const parentUrl = await uiPrompt("노션 연동 ② 부모 페이지", {
      message: "발행 위치가 될 노션 페이지의 링크를 붙여넣으세요.\n⚠️ 그 페이지의 ⋯ 메뉴 → 연결(Connections)에서 방금 만든 통합을 추가해야 접근할 수 있습니다.",
      placeholder: "https://www.notion.so/…",
    });
    if (!parentUrl?.trim()) return;
    try {
      const pageTitle = await setupNotion(token.trim(), parentUrl.trim());
      setNotion(await getNotionStatus());
      void uiAlert("📚 노션 연동 완료", `부모 페이지: "${pageTitle}"\n이제 회의·보고서가 끝날 때마다 90초 뒤 자동 발행됩니다. 지금 바로 발행하려면 📚 버튼을 다시 누르세요.`);
    } catch (e: any) {
      void uiAlert("연동 실패", String(e?.message ?? e));
    }
  };

  const onNotionPublish = async () => {
    if (!activeProject || publishing) return;
    setPublishing(true);
    try {
      const url = await publishNotion(activeProject);
      setNotion(await getNotionStatus());
      const open = await uiConfirm("📚 노션 발행 완료", {
        message: "허브 페이지(개요 표 + 섹션별 기획서 + 보고서함)로 발행했습니다. 노션에서 열어볼까요?",
        confirmLabel: "🔗 노션에서 열기",
      });
      if (open) window.open(url, "_blank", "noopener");
    } catch (e: any) {
      void uiAlert("발행 실패", String(e?.message ?? e));
    } finally {
      setPublishing(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDocViewer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDocViewer]);

  // GDD 섹션 목차 (## 헤딩)
  const sections = useMemo(() => {
    const out: { title: string; raw: string }[] = [];
    const re = /^##\s+(.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(gdd)) !== null) out.push({ title: m[1].trim(), raw: m[0] });
    return out;
  }, [gdd]);

  const scrollToSection = (title: string) => {
    const body = document.querySelector(".doc-body");
    if (!body) return;
    for (const h of body.querySelectorAll("h2")) {
      if (h.textContent?.trim() === title) {
        h.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
  };

  if (!tab) return null;

  return (
    <div className="doc-viewer" onClick={(e) => e.target === e.currentTarget && closeDocViewer()}>
      <div className="doc-window">
        <div className="doc-head">
          <div className="doc-tabs">
            <button className={`doc-tab ${tab === "gdd" ? "on" : ""}`} onClick={() => openDocViewer("gdd")}>
              📄 마스터 GDD
            </button>
            <button className={`doc-tab ${tab === "reports" ? "on" : ""}`} onClick={() => openDocViewer("reports")}>
              📋 보고서함 {reports.length > 0 ? `(${reports.length})` : ""}
            </button>
            <button className={`doc-tab ${tab === "art" ? "on" : ""}`} onClick={() => openDocViewer("art")}>
              🖼️ 아트 보관함 {artImages.length > 0 ? `(${artImages.length})` : ""}
            </button>
          </div>
          {(tab === "gdd" || tab === "reports") && (
            <button
              className="btn small"
              disabled={publishing}
              onClick={() => void (notion?.configured ? onNotionPublish() : onNotionSetup())}
              title={
                notion?.configured
                  ? `노션 아키비스트가 GDD·보고서를 발행합니다 (자동 발행 ${notion.auto ? "켜짐" : "꺼짐"}${notion.last[activeProject]?.ts ? ` · 마지막 ${new Date(notion.last[activeProject]!.ts).toLocaleTimeString("ko-KR", { hour12: false })}` : ""})`
                  : "노션 워크스페이스와 연동합니다 (통합 토큰 + 부모 페이지)"
              }
            >
              {publishing ? "📚 발행 중…" : notion?.configured ? "📚 노션 발행" : "📚 노션 연동"}
            </button>
          )}
          {(tab === "gdd" || tab === "reports") && notion?.configured && (
            <button
              className="btn small"
              onClick={() => setNotionStudio(true)}
              title="노션 편집실 — 페이지 링크를 주면 아키비스트가 읽고 분석해, 요구대로 고쳐서 반영합니다"
            >
              ✏️ 노션 편집실
            </button>
          )}
          {tab === "reports" && reportPreview && (
            <button className="btn small" onClick={() => downloadReport(reportPreview)}>
              ⬇️ .md 다운로드
            </button>
          )}
          {tab === "art" && (
            <button className="btn small primary" onClick={() => setArtStudioOpen(true)}>
              🖌️ 새 컨셉 아트
            </button>
          )}
          <button className="btn small" onClick={closeDocViewer} title="닫기 (Esc)">
            ✕ 닫기
          </button>
        </div>

        {tab === "gdd" && (
          <div className="doc-split">
            <div className="doc-nav">
              <div className="doc-nav-title dim">목차</div>
              {sections.length === 0 && <div className="dim" style={{ padding: "6px 10px" }}>섹션이 없습니다.</div>}
              {sections.map((s, i) => (
                <button key={i} className="doc-nav-item" onClick={() => scrollToSection(s.title)} title={s.title}>
                  {s.title}
                </button>
              ))}
            </div>
            <div className="doc-body">
              <div className="doc-readable">
                <Markdown text={gdd || "_GDD가 비어 있습니다._"} />
              </div>
            </div>
          </div>
        )}

        {tab === "reports" && (
          <div className="doc-split">
            <div className="doc-list">
              {reports.length === 0 && (
                <div className="dim" style={{ padding: 12 }}>
                  아직 보고서가 없습니다.
                  <br />
                  에이전트 1:1 대화의 <b>📋 보고서</b> 버튼으로 요청해 보세요.
                </div>
              )}
              {reports.map((r) => {
                const a = AGENT_MAP[r.agent];
                return (
                  <button
                    key={r.ts}
                    className={`doc-list-item ${reportPreview?.ts === r.ts ? "active" : ""}`}
                    onClick={() => void openReport(r.ts)}
                  >
                    <span className="doc-item-title">
                      {a?.emoji ?? "📋"} {r.title}
                    </span>
                    <span className="dim">
                      {a?.name ?? r.agent} ·{" "}
                      {new Date(r.ts).toLocaleString("ko-KR", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}{" "}
                      · {(r.size / 1000).toFixed(1)}천자
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="doc-body">
              {reportPreview ? (
                <div className="doc-readable">
                  <ReportVerifyFlow ts={reportPreview.ts} agentId={reportPreview.agent} />
                  <Markdown text={reportPreview.markdown} />
                </div>
              ) : (
                <div className="empty-hint">왼쪽 목록에서 보고서를 선택하세요.</div>
              )}
            </div>
          </div>
        )}

        {tab === "art" && (
          <div className="doc-body art-archive">
            {artImages.length === 0 ? (
              <div className="empty-hint">
                아직 보관된 컨셉 아트가 없습니다.
                <br />
                <b>🖌️ 새 컨셉 아트</b>를 눌러 아트 인턴(로컬 Stable Diffusion)에게 요청하세요.
                <br />
                생성된 아트는 프로젝트별로 이곳에 저장됩니다.
              </div>
            ) : (
              <div className="art-grid">
                {artImages.map((img) => (
                  <figure key={img.ts} className="art-card">
                    <a href={artFileUrl(activeProject, img.ts)} target="_blank" rel="noreferrer" title={img.prompt}>
                      <img src={artFileUrl(activeProject, img.ts)} alt={img.request ?? img.prompt} loading="lazy" />
                    </a>
                    <figcaption>
                      <span className="art-caption" title={`프롬프트: ${img.prompt}`}>
                        {img.provider && (
                          <span className={`art-prov-badge ${img.provider}`}>
                            {img.provider === "nvidia" ? "☁️ NVIDIA" : "🖥️ 로컬"}
                          </span>
                        )}
                        {img.request || img.prompt.slice(0, 60)}
                      </span>
                      <div className="art-card-actions">
                        <button
                          className="btn tiny"
                          disabled={attached.includes(img.ts)}
                          onClick={() => void attachArtToGdd(img.ts).then(() => setAttached((a) => [...a, img.ts]))}
                          title='GDD "8. 아트" 섹션에 이미지로 삽입'
                        >
                          {attached.includes(img.ts) ? "✓ 삽입됨" : "📌 GDD"}
                        </button>
                        <button
                          className="btn tiny"
                          onClick={() => {
                            void uiConfirm("이 컨셉 아트를 삭제할까요?", {
                              message: "휴지통(.trash)으로 이동합니다.",
                              confirmLabel: "🗑 삭제",
                              danger: true,
                            }).then((ok) => ok && void removeArt(img.ts));
                          }}
                        >
                          🗑
                        </button>
                      </div>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {notionStudio && <NotionStudio onClose={() => setNotionStudio(false)} />}
    </div>
  );
}
