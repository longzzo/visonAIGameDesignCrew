import { useState } from "react";
import { uiAlert, uiConfirm } from "../lib/dialog";
import type { NotionPageRead } from "../lib/notionSync";
import { useVE } from "../store";
import { Markdown } from "./Markdown";

/**
 * 노션 편집실 — 노션 페이지 링크를 주면 📚 아키비스트가 읽고,
 * 오너의 요구대로 고친 수정안을 보여주고, 승인하면 노션에 반영한다.
 *   · 반영 전 원본을 config/notion-edits/에 자동 백업
 *   · 하위 페이지·데이터베이스 등 복합 블록은 절대 삭제하지 않음
 */
export function NotionStudio({ onClose }: { onClose: () => void }) {
  const analyzeNotionPage = useVE((s) => s.analyzeNotionPage);
  const applyNotionEdit = useVE((s) => s.applyNotionEdit);

  const [url, setUrl] = useState("");
  const [request, setRequest] = useState("");
  // 작업 종류 — "revise"(전문 수정→본문 교체) / "add"(새 콘텐츠만→끝에 추가). 반영 모드가 여기에 묶인다.
  const [task, setTask] = useState<"revise" | "add">("revise");
  const [busy, setBusy] = useState<"" | "analyze" | "apply">("");
  const [page, setPage] = useState<NotionPageRead | null>(null);
  const [revised, setRevised] = useState("");
  const [tab, setTab] = useState<"revised" | "original">("revised");

  const analyze = async () => {
    if (!url.trim() || !request.trim() || busy) return;
    setBusy("analyze");
    setPage(null);
    setRevised("");
    try {
      const out = await analyzeNotionPage(url.trim(), request.trim(), task);
      setPage(out.page);
      setRevised(out.revised);
      setTab("revised");
    } catch (e: any) {
      void uiAlert("분석 실패", String(e?.message ?? e));
    } finally {
      setBusy("");
    }
  };

  const apply = async (mode: "replace" | "append") => {
    if (!page || !revised.trim() || busy) return;
    // 수정안이 원본보다 크게 짧으면 모델이 전문을 돌려주지 않은 것 — 교체 시 내용 유실 경고
    const shrunk = mode === "replace" && page.md.length > 400 && revised.length < page.md.length * 0.55;
    const ok = await uiConfirm(mode === "replace" ? "노션 본문 교체" : "노션 끝에 추가", {
      message:
        mode === "replace"
          ? `${shrunk ? `⚠️ 수정안(${(revised.length / 1000).toFixed(1)}천자)이 원본(${(page.md.length / 1000).toFixed(1)}천자)보다 크게 짧습니다 — 아키비스트가 일부만 돌려줬을 수 있어, 교체하면 나머지 내용이 사라집니다. [끝에 추가]나 [다시 만들기]를 권장합니다.\n\n` : ""}「${page.title}」의 텍스트 본문을 수정안으로 교체합니다.\n· 하위 페이지·DB 등 ${page.complexCount}개 복합 블록은 삭제되지 않습니다\n· 원본은 자동 백업됩니다 (config/notion-edits/)`
          : `「${page.title}」 끝에 수정안을 덧붙입니다 (기존 내용 유지).`,
      confirmLabel: mode === "replace" ? "✅ 교체 반영" : "➕ 추가 반영",
      danger: shrunk,
    });
    if (!ok) return;
    setBusy("apply");
    try {
      const link = await applyNotionEdit(page.url, page.title, revised, mode);
      const open = await uiConfirm("📚 반영 완료", {
        message: "노션에 반영했습니다. 페이지를 열어볼까요?",
        confirmLabel: "🔗 노션에서 열기",
      });
      if (open) window.open(link, "_blank", "noopener");
      onClose();
    } catch (e: any) {
      void uiAlert("반영 실패", String(e?.message ?? e));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="doc-viewer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="doc-window notion-studio">
        <div className="doc-head">
          <div className="head-meta">
            <div className="head-name">📚 노션 편집실 — 아키비스트</div>
            <div className="head-role dim">페이지 링크를 주면 읽고 분석해, 요구대로 고친 수정안을 승인받아 반영합니다</div>
          </div>
          <button className="btn small" onClick={onClose} title="닫기 (Esc)">
            ✕ 닫기
          </button>
        </div>

        <div className="notion-studio-body">
          <div className="hire-row">
            <label>노션 페이지 링크</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.notion.so/… (그 페이지의 ⋯ → 연결에 통합이 추가되어 있어야 합니다)"
              disabled={busy !== ""}
            />
          </div>
          <div className="hire-row">
            <label>작업 종류</label>
            <div className="doc-tabs">
              <button
                className={`doc-tab ${task === "revise" ? "on" : ""}`}
                onClick={() => setTask("revise")}
                disabled={busy !== ""}
                title="원문 전체를 요구대로 고쳐 텍스트 본문을 교체합니다 — 글 중심 페이지에 적합"
              >
                ✏️ 본문 수정 (교체)
              </button>
              <button
                className={`doc-tab ${task === "add" ? "on" : ""}`}
                onClick={() => setTask("add")}
                disabled={busy !== ""}
                title="새 섹션·내용만 만들어 페이지 끝에 덧붙입니다 — 기존 내용은 건드리지 않아 컬럼·콜아웃이 많은 허브 페이지에도 안전"
              >
                ➕ 내용 추가 (끝에 붙임)
              </button>
            </div>
          </div>
          <div className="hire-row">
            <label>{task === "add" ? "추가 요구" : "수정 요구"}</label>
            <textarea
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              rows={3}
              placeholder={
                task === "add"
                  ? "예: '시장 시스템 기획' 섹션을 추가해줘 — 필수 재료 구매와 던전 연계 퀘스트 두 갈래로.\n예: 마일스톤 아래에 '리스크 목록' 섹션을 추가해줘."
                  : "예: 개요를 3줄로 압축하고, 일정 부분을 표로 정리해줘.\n예: 오타를 고치고 항목마다 볼드 리드를 붙여 읽기 쉽게 다듬어줘."
              }
              disabled={busy !== ""}
            />
          </div>
          <div className="hire-actions">
            <button className="btn primary" onClick={() => void analyze()} disabled={!url.trim() || !request.trim() || busy !== ""}>
              {busy === "analyze" ? "📖 아키비스트가 읽고 고치는 중…" : task === "add" ? "🔍 분석 & 추가안 만들기" : "🔍 분석 & 수정안 만들기"}
            </button>
            {page && (
              <span className="dim" style={{ alignSelf: "center", fontSize: 12 }}>
                「{page.title}」 · 블록 {page.blockCount}개{page.complexCount > 0 ? ` · 보존 대상 ${page.complexCount}개` : ""}
              </span>
            )}
          </div>

          {page && revised && (
            <>
              <div className="doc-tabs" style={{ marginTop: 4 }}>
                <button className={`doc-tab ${tab === "revised" ? "on" : ""}`} onClick={() => setTab("revised")}>
                  ✏️ 수정안
                </button>
                <button className={`doc-tab ${tab === "original" ? "on" : ""}`} onClick={() => setTab("original")}>
                  📄 원본
                </button>
              </div>
              <div className="notion-preview">
                <Markdown text={tab === "revised" ? revised : page.md} />
              </div>
              {page.notes.length > 0 && (
                <div className="dim" style={{ fontSize: 11 }}>ℹ️ {page.notes.join(" · ")}</div>
              )}
              <div className="hire-actions">
                {task === "revise" ? (
                  <button className="btn primary" onClick={() => void apply("replace")} disabled={busy !== ""}>
                    {busy === "apply" ? "반영 중…" : "✅ 본문 교체로 반영"}
                  </button>
                ) : (
                  <button className="btn primary" onClick={() => void apply("append")} disabled={busy !== ""}>
                    {busy === "apply" ? "반영 중…" : "➕ 끝에 추가로 반영"}
                  </button>
                )}
                <button className="btn" onClick={() => void analyze()} disabled={busy !== ""} title="같은 요구로 다시 뽑습니다">
                  🔄 다시 만들기
                </button>
              </div>
            </>
          )}

          <div className="dim hire-note">
            반영 전 원본이 자동 백업되고, 하위 페이지·데이터베이스·임베드는 삭제되지 않습니다. 대상 페이지의
            <b> ⋯ 메뉴 → 연결(Connections)</b>에 Vision Engine 통합이 추가되어 있어야 읽고 쓸 수 있습니다.
          </div>
        </div>
      </div>
    </div>
  );
}
