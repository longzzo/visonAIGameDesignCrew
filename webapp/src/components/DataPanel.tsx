import { useEffect, useMemo, useState } from "react";
import { useVE } from "../store";
import { listKitFiles, saveKitFiles, kitFileUrl, type KitFile } from "../lib/kit";
import { uiAlert } from "../lib/dialog";

/**
 * 데이터 탭 — 게임 데이터 파일(JSON/CSV)만 모아 보고 편집한다.
 * 방치형(idle)처럼 데이터 주도 게임의 밸런스·경제·성장 테이블을 코드와 분리해 관리하는 용도.
 * 파일 실체는 개발 착수 킷의 kit/data|balance/… 에 저장된다.
 */
const isData = (p: string) => /\.(json|csv)$/i.test(p);

export function DataPanel() {
  const { activeProject, buildDevKit, devKitBusy, devKitPhase } = useVE();
  const [files, setFiles] = useState<KitFile[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [jsonErr, setJsonErr] = useState("");

  const dataFiles = useMemo(() => files.filter((f) => isData(f.path)).sort((a, b) => a.path.localeCompare(b.path)), [files]);

  const load = async () => {
    if (!activeProject) return;
    setLoading(true);
    const all = await listKitFiles(activeProject);
    setFiles(all);
    setLoading(false);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject]);

  const open = async (path: string) => {
    if (dirty && !confirm("저장하지 않은 변경이 있습니다. 버릴까요?")) return;
    setSel(path);
    setDirty(false);
    setJsonErr("");
    try {
      const r = await fetch(kitFileUrl(activeProject, path));
      setContent(await r.text());
    } catch {
      setContent("(불러오기 실패)");
    }
  };

  const onEdit = (v: string) => {
    setContent(v);
    setDirty(true);
    if (sel && sel.endsWith(".json")) {
      try {
        JSON.parse(v);
        setJsonErr("");
      } catch (e: any) {
        setJsonErr(String(e?.message ?? e));
      }
    }
  };

  const save = async () => {
    if (!sel) return;
    if (sel.endsWith(".json") && jsonErr) {
      void uiAlert("JSON 형식 오류가 있어 저장할 수 없습니다:\n" + jsonErr);
      return;
    }
    setSaving(true);
    try {
      await saveKitFiles(activeProject, [{ path: sel, content }]);
      setDirty(false);
      await load();
    } catch (e: any) {
      void uiAlert("저장 실패: " + String(e?.message ?? e));
    }
    setSaving(false);
  };

  const newJson = async () => {
    const name = prompt("새 데이터 파일 이름 (예: enemies.json, upgrades.json)", "data.json");
    if (!name) return;
    const path = name.includes("/") ? name : `data/${name}`;
    const template = name.endsWith(".csv") ? "id,name,value\n" : "[\n  \n]\n";
    await saveKitFiles(activeProject, [{ path, content: template }]);
    await load();
    void open(path);
  };

  return (
    <section className="data-view">
      <div className="data-head">
        <div>
          <b>🧮 게임 데이터</b>
          <span className="dim"> — JSON/CSV로 분리된 밸런스·경제·콘텐츠 테이블 ({dataFiles.length}개)</span>
        </div>
        <div className="data-head-actions">
          <button className="btn small" onClick={() => void newJson()} title="빈 데이터 파일 생성">
            ＋ 새 파일
          </button>
          <button
            className="btn small"
            onClick={() => void buildDevKit()}
            disabled={devKitBusy}
            title="밸런스 디자이너가 현재 기획을 근거로 데이터 테이블(CSV) 등을 생성합니다"
          >
            {devKitBusy ? "생성 중…" : "🤖 데이터 생성 (개발 킷)"}
          </button>
        </div>
      </div>
      {devKitBusy && devKitPhase && <div className="data-phase dim">{devKitPhase}</div>}

      <div className="data-body">
        <div className="data-list">
          {loading && <div className="empty-hint">불러오는 중…</div>}
          {!loading && dataFiles.length === 0 && (
            <div className="empty-hint" style={{ fontSize: 12.5 }}>
              데이터 파일이 없습니다.
              <br />
              <b>＋ 새 파일</b>로 직접 만들거나,
              <br />
              <b>🤖 데이터 생성</b>으로 팀에게 맡기세요.
            </div>
          )}
          {dataFiles.map((f) => (
            <button key={f.path} className={`data-file ${sel === f.path ? "on" : ""}`} onClick={() => void open(f.path)}>
              <span className="data-file-ico">{f.path.endsWith(".json") ? "🔧" : "📊"}</span>
              <span className="data-file-name">{f.path.replace(/^data\//, "")}</span>
              <span className="data-file-size dim">{(f.size / 1024).toFixed(1)}KB</span>
            </button>
          ))}
        </div>

        <div className="data-editor">
          {!sel ? (
            <div className="empty-hint">왼쪽에서 파일을 선택하면 여기서 편집할 수 있습니다.</div>
          ) : (
            <>
              <div className="data-editor-head">
                <code>{sel}</code>
                {jsonErr && <span className="data-json-err">⚠️ JSON 오류: {jsonErr.slice(0, 60)}</span>}
                <a className="btn tiny" href={kitFileUrl(activeProject, sel)} target="_blank" rel="noreferrer" style={{ marginLeft: "auto" }}>
                  ↗ 열기
                </a>
                <button className="btn tiny primary" onClick={() => void save()} disabled={saving || !dirty || !!jsonErr}>
                  {saving ? "저장…" : dirty ? "💾 저장" : "저장됨"}
                </button>
              </div>
              <textarea
                className="data-textarea"
                value={content}
                onChange={(e) => onEdit(e.target.value)}
                spellCheck={false}
              />
            </>
          )}
        </div>
      </div>
    </section>
  );
}
