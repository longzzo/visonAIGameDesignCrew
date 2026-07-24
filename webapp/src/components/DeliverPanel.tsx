/**
 * 📦 납품물 — projects/<id>/deliverables/ 의 실제 산출물을 VE 안에서 바로 본다.
 *
 * 오너 피드백 2026-07-23: "deliver 쓰는데 파일을 계속 들어가는 것도 번잡스럽다".
 * 이전엔 이 폴더를 다루는 코드가 없어 탐색기로 D:\...\projects\pmrixgw33\deliverables 를
 * 매번 파고들어야 했다. 이제 목록·미리보기·내려받기 + 탐색기 열기를 한 화면에서.
 */
import { useEffect } from "react";
import { useVE } from "../store";

const EXT_ICON: Record<string, string> = {
  png: "🖼️", jpg: "🖼️", jpeg: "🖼️", gif: "🖼️", webp: "🖼️", svg: "🖼️",
  pdf: "📄", pptx: "📊", xlsx: "📗", docx: "📘",
  zip: "🗜️", md: "📝", txt: "📝", json: "🧾", csv: "🧾", mp4: "🎬",
};
const PREVIEWABLE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "md", "txt", "json", "csv"]);

const humanBytes = (n: number) =>
  n < 1024 ? `${n}B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`;

const humanDate = (ms: number) => {
  const d = new Date(ms);
  const now = Date.now();
  const days = Math.floor((now - ms) / 86_400_000);
  if (days === 0) return `오늘 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (days === 1) return "어제";
  if (days < 30) return `${days}일 전`;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
};

export function DeliverPanel({ onClose }: { onClose: () => void }) {
  const project = useVE((s) => s.activeProject);
  const projectName = useVE((s) => s.projects.find((p) => p.id === s.activeProject)?.name ?? "");
  const files = useVE((s) => s.deliverFiles);
  const busy = useVE((s) => s.deliverBusy);
  const dir = useVE((s) => s.deliverDir);
  const loadDeliverables = useVE((s) => s.loadDeliverables);
  const openDeliverFolder = useVE((s) => s.openDeliverFolder);

  // 패널이 열리거나 프로젝트가 바뀌면 목록을 새로 읽는다
  useEffect(() => {
    void loadDeliverables();
  }, [project, loadDeliverables]);

  const fileUrl = (rel: string, dl = false) =>
    `/api/deliverables/file?id=${encodeURIComponent(project)}&f=${encodeURIComponent(rel)}${dl ? "&dl=1" : ""}`;

  // 하위 폴더(발표/ 등)별로 묶어 보여준다 — 루트가 먼저
  const groups = new Map<string, typeof files>();
  for (const f of files) {
    const k = f.folder || "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(f);
  }
  const groupKeys = [...groups.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));

  return (
    <div className="onb-backdrop" onClick={onClose}>
      <div className="onb-card deliver-card" onClick={(e) => e.stopPropagation()}>
        <div className="approval-head">
          <b>📦 납품물</b>
          <span className="dim">{projectName || "(프로젝트를 먼저 선택하세요)"} — 킷·아트·문서 산출물</span>
          <button className="btn tiny approval-close" onClick={onClose}>
            ✕ 닫기
          </button>
        </div>

        <div className="deliver-body">
          <div className="deliver-toolbar">
            <button className="btn tiny" onClick={() => void loadDeliverables()} disabled={busy}>
              {busy ? "읽는 중…" : "↻ 새로고침"}
            </button>
            <button className="btn tiny primary" onClick={() => void openDeliverFolder()} disabled={!project}>
              📂 탐색기로 열기
            </button>
            <span className="dim deliver-count">{files.length}개 파일</span>
          </div>

          {!busy && files.length === 0 && (
            <div className="deliver-empty dim">
              아직 납품물이 없습니다. 산출물을 <code>deliverables</code> 폴더에 넣으면 여기 바로 뜹니다.
              <br />
              <span className="deliver-path">{dir}</span>
            </div>
          )}

          {groupKeys.map((g) => (
            <div className="deliver-group" key={g || "_root"}>
              {g && <div className="deliver-group-head dim">📁 {g}</div>}
              {groups.get(g)!.map((f) => (
                <div className="deliver-row" key={f.rel}>
                  <span className="deliver-icon">{EXT_ICON[f.ext] ?? "📁"}</span>
                  <span className="deliver-name" title={f.rel}>
                    {f.name}
                  </span>
                  <span className="dim deliver-meta">
                    {humanBytes(f.bytes)} · {humanDate(f.mtime)}
                  </span>
                  {PREVIEWABLE.has(f.ext) && (
                    <a className="btn tiny" href={fileUrl(f.rel)} target="_blank" rel="noreferrer">
                      보기
                    </a>
                  )}
                  <a className="btn tiny primary" href={fileUrl(f.rel, true)}>
                    내려받기
                  </a>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
