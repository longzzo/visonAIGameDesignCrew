import { useEffect, useMemo, useState } from "react";
// (📈 차트 렌더러는 아래 CsvChart — 외부 라이브러리 없이 SVG로 그린다)
import { useVE } from "../store";
import { listKitFiles, saveKitFiles, kitFileUrl, type KitFile } from "../lib/kit";
import { uiAlert } from "../lib/dialog";

/**
 * 데이터 탭 — 게임 데이터 파일(JSON/CSV)만 모아 보고 편집한다.
 * 방치형(idle)처럼 데이터 주도 게임의 밸런스·경제·성장 테이블을 코드와 분리해 관리하는 용도.
 * 파일 실체는 개발 착수 킷의 kit/data|balance/… 에 저장된다.
 */
const isData = (p: string) => /\.(json|csv)$/i.test(p);

/* ── 📈 CSV 차트 — 수치가 한눈에 보이게 (외부 라이브러리 없음) ── */

const CHART_COLORS = ["#8b7cf6", "#4dc3a3", "#e6a23c", "#e06c75", "#56b6c2", "#c678dd", "#98c379", "#d19a66"];

function parseCsv(text: string): string[][] {
  // 간단 파서 — 따옴표 셀("a,b") 지원, 우리 데이터엔 충분
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const out: string[] = [];
      let cur = "";
      let q = false;
      for (const ch of line) {
        if (ch === '"') q = !q;
        else if (ch === "," && !q) {
          out.push(cur);
          cur = "";
        } else cur += ch;
      }
      out.push(cur);
      return out.map((c) => c.trim());
    });
}

const asNum = (s: string): number | null => {
  const n = Number(String(s).replace(/[,%\s]/g, ""));
  return Number.isFinite(n) && s !== "" ? n : null;
};

interface Series {
  name: string;
  points: { x: number; y: number }[];
}

/** CSV → 시리즈 추출. 레벨/카테고리 구조(level+category+값)를 감지하면 계열별 곡선, 아니면 숫자 열별 곡선 */
function csvToSeries(rows: string[][]): { series: Series[]; xLabel: string } {
  if (rows.length < 3) return { series: [], xLabel: "" };
  const header = rows[0];
  const body = rows.slice(1);
  const numeric = header.map((_, c) => body.filter((r) => asNum(r[c] ?? "") !== null).length >= body.length * 0.7);
  const levelCol = header.findIndex((h, c) => numeric[c] && /^(level|lv|레벨|day|일차|n)$/i.test(h.trim()));
  const catCol = header.findIndex(
    (h, c) =>
      !numeric[c] &&
      /category|계열|분류|이름|name/i.test(h) &&
      new Set(body.map((r) => r[c])).size >= 2 &&
      new Set(body.map((r) => r[c])).size <= 8
  );
  if (levelCol >= 0 && catCol >= 0) {
    const valueCol = header.findIndex((_, c) => numeric[c] && c !== levelCol);
    if (valueCol >= 0) {
      const byCat = new Map<string, { x: number; y: number }[]>();
      for (const r of body) {
        const x = asNum(r[levelCol] ?? "");
        const y = asNum(r[valueCol] ?? "");
        if (x === null || y === null) continue;
        const k = r[catCol] || "?";
        if (!byCat.has(k)) byCat.set(k, []);
        byCat.get(k)!.push({ x, y });
      }
      return {
        series: [...byCat.entries()].map(([name, points]) => ({ name: `${name} · ${header[valueCol]}`, points: points.sort((a, b) => a.x - b.x) })),
        xLabel: header[levelCol],
      };
    }
  }
  // 폴백: 숫자 열 각각을 행 순서대로
  const series: Series[] = [];
  header.forEach((h, c) => {
    if (!numeric[c] || /^id$/i.test(h)) return;
    const points = body.map((r, i) => ({ x: i + 1, y: asNum(r[c] ?? "") })).filter((p): p is { x: number; y: number } => p.y !== null);
    if (points.length >= 2 && new Set(points.map((p) => p.y)).size > 1) series.push({ name: h, points });
  });
  return { series: series.slice(0, 8), xLabel: "행" };
}

function CsvChart({ content }: { content: string }) {
  const { series, xLabel } = useMemo(() => csvToSeries(parseCsv(content)), [content]);
  if (series.length === 0) return <div className="empty-hint">차트로 그릴 숫자 열이 없습니다 — ✏️ 편집으로 전환하세요.</div>;
  const W = 640;
  const H = 320;
  const PAD = { l: 52, r: 14, t: 16, b: 34 };
  const xs = series.flatMap((s) => s.points.map((p) => p.x));
  const ys = series.flatMap((s) => s.points.map((p) => p.y));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(...ys) * 1.08 || 1;
  const px = (x: number) => PAD.l + ((x - xMin) / Math.max(1e-9, xMax - xMin)) * (W - PAD.l - PAD.r);
  const py = (y: number) => H - PAD.b - ((y - yMin) / Math.max(1e-9, yMax - yMin)) * (H - PAD.t - PAD.b);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => yMin + t * (yMax - yMin));
  const fmt = (n: number) => (Math.abs(n) >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n * 10) / 10));
  return (
    <div className="data-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={py(t)} y2={py(t)} className="chart-grid" />
            <text x={PAD.l - 6} y={py(t) + 4} className="chart-tick" textAnchor="end">
              {fmt(t)}
            </text>
          </g>
        ))}
        {series.map((s, si) => {
          const color = CHART_COLORS[si % CHART_COLORS.length];
          const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ");
          return (
            <g key={s.name}>
              <path d={d} fill="none" stroke={color} strokeWidth={2.2} />
              {s.points.map((p, i) => (
                <circle key={i} cx={px(p.x)} cy={py(p.y)} r={3.2} fill={color}>
                  <title>{`${s.name} — ${xLabel} ${p.x}: ${p.y}`}</title>
                </circle>
              ))}
              {series.length <= 4 &&
                s.points.length <= 8 &&
                s.points.map((p, i) => (
                  <text key={`t${i}`} x={px(p.x)} y={py(p.y) - 7} className="chart-val" textAnchor="middle">
                    {fmt(p.y)}
                  </text>
                ))}
            </g>
          );
        })}
        <text x={(W + PAD.l - PAD.r) / 2} y={H - 8} className="chart-tick" textAnchor="middle">
          {xLabel}
        </text>
      </svg>
      <div className="chart-legend">
        {series.map((s, si) => (
          <span key={s.name} className="chart-legend-item">
            <i style={{ background: CHART_COLORS[si % CHART_COLORS.length] }} /> {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 파일명으로 용도를 추정해 짧은 설명을 붙인다 (방치형 등 데이터 주도 게임 이해용) */
function describeFile(path: string): string {
  const n = path.toLowerCase();
  if (/stat|스탯/.test(n)) return "캐릭터·유닛의 기본 능력치 테이블 (HP·공격력 등)";
  if (/growth|curve|성장|곡선/.test(n)) return "레벨·시간에 따른 성장/증가 곡선 — 방치형 수익 곡선의 핵심";
  if (/boss|difficult|난이도/.test(n)) return "구간별 난이도·보스 스펙 테이블";
  if (/econom|cost|price|gold|경제|비용|가격/.test(n)) return "재화·비용·가격 등 경제 상수 (인플레이션 관리)";
  if (/upgrade|skill|업그레이드|스킬/.test(n)) return "업그레이드·스킬 트리 데이터 (효과·비용·해금 조건)";
  if (/enem|monster|적|몬스터/.test(n)) return "적/몬스터 정의 (스탯·드랍·출현)";
  if (/item|드랍|아이템/.test(n)) return "아이템·드랍 테이블";
  if (/decay|risk|리스크/.test(n)) return "감쇠·리스크 시나리오 (밸런스 검증용)";
  if (/asset|manifest|에셋/.test(n)) return "필요 에셋 목록 (씬별·우선순위·SD프롬프트)";
  if (/reward|보상/.test(n)) return "보상·드랍률 테이블";
  return path.endsWith(".json") ? "JSON 데이터 파일 — 배열/객체 구조" : "CSV 테이블 — 첫 행이 헤더";
}

export function DataPanel() {
  const { activeProject, buildDevKit, buildBalanceSheet, devKitBusy, devKitPhase } = useVE();
  const [files, setFiles] = useState<KitFile[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [jsonErr, setJsonErr] = useState("");
  // 📈 CSV는 기본 차트로 — 수치가 한눈에 (오너 요청)
  const [viewMode, setViewMode] = useState<"chart" | "edit">("chart");

  const dataFiles = useMemo(() => files.filter((f) => isData(f.path)).sort((a, b) => a.path.localeCompare(b.path)), [files]);

  const load = async () => {
    if (!activeProject) return;
    setLoading(true);
    const all = await listKitFiles(activeProject);
    setFiles(all);
    setLoading(false);
  };
  useEffect(() => {
    // devKitBusy가 false로 돌아온 직후에도 다시 로드 — 생성 완료된 파일이 목록에 바로 보이게 (버그 수정)
    if (!devKitBusy) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject, devKitBusy]);

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
            className="btn small primary"
            onClick={() => void buildBalanceSheet()}
            disabled={devKitBusy}
            title="밸런스 디자이너가 기획의 확정 수치를 근거로 밸런싱 시트(CSV)+근거 README만 생성합니다 — 개발 킷 전체보다 빠름"
          >
            {devKitBusy ? "생성 중…" : "⚖️ 밸런스 시트 생성"}
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
              <div className="data-file-top">
                <span className="data-file-ico">{f.path.endsWith(".json") ? "🔧" : "📊"}</span>
                <span className="data-file-name">{f.path.replace(/^data\//, "")}</span>
                <span className="data-file-size dim">{(f.size / 1024).toFixed(1)}KB</span>
              </div>
              <div className="data-file-desc">{describeFile(f.path)}</div>
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
                {sel.endsWith(".csv") && (
                  <button
                    className={`btn tiny ${viewMode === "chart" ? "primary" : ""}`}
                    style={{ marginLeft: "auto" }}
                    onClick={() => setViewMode(viewMode === "chart" ? "edit" : "chart")}
                    title="수치를 곡선으로 한눈에 / 원본 편집 전환"
                  >
                    {viewMode === "chart" ? "✏️ 편집" : "📈 차트"}
                  </button>
                )}
                <a
                  className="btn tiny"
                  href={kitFileUrl(activeProject, sel)}
                  target="_blank"
                  rel="noreferrer"
                  style={sel.endsWith(".csv") ? undefined : { marginLeft: "auto" }}
                >
                  ↗ 열기
                </a>
                <button className="btn tiny primary" onClick={() => void save()} disabled={saving || !dirty || !!jsonErr}>
                  {saving ? "저장…" : dirty ? "💾 저장" : "저장됨"}
                </button>
              </div>
              {sel.endsWith(".csv") && viewMode === "chart" ? (
                <CsvChart content={content} />
              ) : (
                <textarea
                  className="data-textarea"
                  value={content}
                  onChange={(e) => onEdit(e.target.value)}
                  spellCheck={false}
                />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
