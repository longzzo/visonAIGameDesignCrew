/**
 * 📊 발표자료 — GDD를 게임 발표용 슬라이드(HTML·PDF·PPTX)로 만든다.
 *
 * 내용은 발표 디자이너(아트 디렉터)가 GDD에서 뽑고, 디자인은 theme-game.css가 전담한다.
 * 오너는 옵시디안 「발표 디자인」에서 색·폰트만 고치면 다음 생성부터 반영된다.
 */
import { useEffect } from "react";
import { useVE } from "../store";

const FMT_LABEL: Record<string, { icon: string; name: string; hint: string }> = {
  html: { icon: "🌐", name: "HTML", hint: "브라우저로 바로 발표·미리보기" },
  pdf: { icon: "📄", name: "PDF", hint: "제출·인쇄용 (디자인 그대로)" },
  pptx: { icon: "📊", name: "PPTX", hint: "파워포인트에서 열기" },
};

const humanBytes = (n: number) =>
  n < 1024 ? `${n}B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`;

export function DeckPanel({ onClose }: { onClose: () => void }) {
  const project = useVE((s) => s.activeProject);
  const projectName = useVE((s) => s.projects.find((p) => p.id === s.activeProject)?.name ?? "");
  const busy = useVE((s) => s.deckBusy);
  const status = useVE((s) => s.deckStatus);
  const files = useVE((s) => s.deckFiles);
  const themeSource = useVE((s) => s.deckThemeSource);
  const error = useVE((s) => s.deckError);
  const generateDeck = useVE((s) => s.generateDeck);
  const loadDeckFiles = useVE((s) => s.loadDeckFiles);

  // 패널이 열리거나 프로젝트가 바뀌면 디스크의 지난 생성분을 불러온다 —
  // deckFiles는 메모리라 재오픈 시 비어서 다운로드 행이 사라지던 문제를 막는다.
  useEffect(() => {
    void loadDeckFiles();
  }, [project, loadDeckFiles]);

  const fileUrl = (f: string, dl = false) =>
    `/api/deck/file?id=${encodeURIComponent(project)}&f=${encodeURIComponent(f)}${dl ? "&dl=1" : ""}`;

  return (
    <div className="onb-backdrop" onClick={onClose}>
      <div className="onb-card deck-card" onClick={(e) => e.stopPropagation()}>
        <div className="approval-head">
          <b>📊 발표자료</b>
          <span className="dim">게임 기획서(GDD)를 발표용 슬라이드로 — HTML · PDF · PPTX</span>
          <button className="btn tiny approval-close" onClick={onClose}>
            ✕ 닫기
          </button>
        </div>

        <div className="deck-body">
          <div className="deck-target dim">
            대상 프로젝트: <b>{projectName || "(프로젝트를 먼저 선택하세요)"}</b>
          </div>

          <button className="btn primary deck-gen" disabled={busy || !project} onClick={() => void generateDeck()}>
            {busy ? "생성 중…" : files.length > 0 ? "다시 생성" : "발표자료 생성"}
          </button>

          {busy && (
            <div className="deck-status">
              <span className="deck-spinner" /> {status || "작업 중…"}
            </div>
          )}

          {error && <div className="deck-error">⚠️ {error}</div>}

          {files.length > 0 && (
            <div className="deck-files">
              <div className="deck-files-head dim">
                생성 완료
                {themeSource === "vault" ? " · 옵시디안 커스텀 테마 적용" : themeSource === "bundled" ? " · 기본 테마" : ""}
              </div>
              {files.map((f) => {
                const meta = FMT_LABEL[f.fmt] ?? { icon: "📁", name: f.fmt.toUpperCase(), hint: "" };
                return (
                  <div className="deck-file-row" key={f.fmt}>
                    <span className="deck-file-icon">{meta.icon}</span>
                    <span className="deck-file-name">
                      <b>{meta.name}</b> <span className="dim">{meta.hint}</span>
                    </span>
                    <span className="dim deck-file-size">{humanBytes(f.bytes)}</span>
                    {f.fmt === "html" && (
                      <a className="btn tiny" href={fileUrl(f.name)} target="_blank" rel="noreferrer">
                        미리보기
                      </a>
                    )}
                    <a className="btn tiny primary" href={fileUrl(f.name, true)}>
                      내려받기
                    </a>
                  </div>
                );
              })}
            </div>
          )}

          <div className="deck-note dim">
            디자인 규칙(색·폰트·레이아웃)은 옵시디안 <code>발표 디자인 / theme-game.css</code>에서 바꿀 수 있습니다.
            맨 위 <code>:root</code> 토큰만 고치면 다음 생성부터 반영됩니다. AI 티가 나지 않도록 슬라이드당 메시지 하나,
            강조는 최소한으로 구성됩니다.
          </div>
        </div>
      </div>
    </div>
  );
}
