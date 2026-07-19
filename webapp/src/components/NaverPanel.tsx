import { useEffect, useState } from "react";
import {
  getNaverStatus,
  naverSearch,
  naverTrend,
  saveNaverCaps,
  saveNaverKey,
  stripNaverHtml,
  NAVER_SERVICE_LABEL,
  type NaverItem,
  type NaverService,
  type NaverStatus,
  type TrendGroup,
} from "../lib/naver";
import { useVE } from "../store";

/** 검색어 트렌드 꺾은선 — 외부 라이브러리 없이 SVG로 (데이터 탭 CSV 차트와 같은 방식) */
function TrendChart({ groups }: { groups: TrendGroup[] }) {
  const W = 620;
  const H = 200;
  const P = { l: 34, r: 12, t: 12, b: 26 };
  const periods = groups[0]?.data.map((d) => d.period) ?? [];
  if (periods.length < 2) return <div className="dim">그래프를 그리기엔 구간이 부족합니다.</div>;
  const max = Math.max(...groups.flatMap((g) => g.data.map((d) => d.ratio)), 1);
  const colors = ["#8b7cf6", "#34d399", "#fbbf24", "#38bdf8", "#f43f5e"];
  const x = (i: number) => P.l + (i / (periods.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b);

  return (
    <div className="naver-chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="검색어 트렌드">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={P.l} x2={W - P.r} y1={y(max * f)} y2={y(max * f)} stroke="currentColor" opacity="0.14" />
            <text x={4} y={y(max * f) + 4} fontSize="10" fill="currentColor" opacity="0.55">
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {groups.map((g, gi) => (
          <polyline
            key={g.title}
            fill="none"
            stroke={colors[gi % colors.length]}
            strokeWidth="2"
            points={g.data.map((d, i) => `${x(i)},${y(d.ratio)}`).join(" ")}
          />
        ))}
        <text x={P.l} y={H - 8} fontSize="10" fill="currentColor" opacity="0.6">
          {periods[0]}
        </text>
        <text x={W - P.r} y={H - 8} fontSize="10" fill="currentColor" opacity="0.6" textAnchor="end">
          {periods[periods.length - 1]}
        </text>
      </svg>
      <div className="naver-legend">
        {groups.map((g, gi) => (
          <span key={g.title}>
            <i style={{ background: colors[gi % colors.length] }} /> {g.title}
          </span>
        ))}
      </div>
      <div className="dim naver-note">※ 값은 기간 내 최대 검색량을 100으로 둔 상대 지수입니다 (절대 검색 횟수가 아닙니다).</div>
    </div>
  );
}

/**
 * 🔎 네이버 리서치 — 오너가 직접 국내 검색을 돌리고, 쓸 만한 결과만 보고서로 보낸다.
 * 키 등록·사용량/한도 관리도 여기서 한다. 한도를 넘기면 회의 리서치는 자동으로 웹 검색으로 넘어간다.
 */
export function NaverPanel({ onClose }: { onClose: () => void }) {
  const { activeProject, saveReportFromText } = useVE();
  const [st, setSt] = useState<NaverStatus | null>(null);
  const [tab, setTab] = useState<"search" | "trend" | "key">("search");
  const [q, setQ] = useState("");
  const [type, setType] = useState<NaverService>("blog");
  const [items, setItems] = useState<NaverItem[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // 트렌드
  const [kw, setKw] = useState("생존 게임, 방치형 RPG");
  const [groups, setGroups] = useState<TrendGroup[]>([]);

  const refresh = () => void getNaverStatus().then((s) => setSt(s));
  useEffect(refresh, []);
  useEffect(() => {
    if (st && !st.configured) setTab("key");
  }, [st?.configured]);

  const runSearch = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setMsg("");
    setItems([]);
    setPicked({});
    const r = await naverSearch(type, q.trim(), { display: 20, sort: "sim" });
    setBusy(false);
    refresh();
    if (r.needKey) {
      setMsg("키가 등록되지 않았습니다 — 🔑 탭에서 등록하세요.");
      setTab("key");
      return;
    }
    if (r.exhausted) {
      setMsg(`⚠️ ${r.error} — 회의 리서치는 자동으로 웹 검색으로 넘어갑니다.`);
      return;
    }
    if (!r.ok) {
      setMsg(`검색 실패: ${r.error ?? "알 수 없는 오류"}`);
      return;
    }
    setItems(r.items);
    if (r.items.length === 0) setMsg("결과가 없습니다.");
  };

  const runTrend = async () => {
    const names = kw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5);
    if (names.length === 0) return;
    setBusy(true);
    setMsg("");
    setGroups([]);
    const end = new Date();
    const start = new Date(end.getTime() - 365 * 24 * 3600 * 1000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const r = await naverTrend({
      startDate: iso(start),
      endDate: iso(end),
      timeUnit: "month",
      keywordGroups: names.map((n) => ({ groupName: n, keywords: [n] })),
    });
    setBusy(false);
    refresh();
    if (r.exhausted) setMsg(`⚠️ ${r.error}`);
    else if (!r.ok) setMsg(`트렌드 실패: ${r.error ?? "알 수 없는 오류"}`);
    else setGroups(r.results);
  };

  /** 고른 결과만 보고서함으로 — 회의 근거로 쓰라고 링크까지 남긴다 */
  const sendToReports = async () => {
    const chosen = items.filter((it) => picked[it.link]);
    if (chosen.length === 0 || !activeProject) return;
    const md = [
      `# 🔎 네이버 ${NAVER_SERVICE_LABEL[type]} 리서치 — "${q.trim()}"`,
      ``,
      `> 오너가 직접 검색해 고른 ${chosen.length}건입니다. 회의에서 인용할 때 링크를 함께 남기세요.`,
      ``,
      ...chosen.map((it) => {
        const t = stripNaverHtml(it.title);
        const d = stripNaverHtml(it.description ?? "");
        return `- **${t}**${d ? `\n  ${d}` : ""}\n  ${it.link}`;
      }),
    ].join("\n");
    setBusy(true);
    try {
      await saveReportFromText(`네이버 리서치 — ${q.trim().slice(0, 30)}`, md);
      setMsg(`✅ 보고서함에 ${chosen.length}건을 저장했습니다.`);
      setPicked({});
    } catch (e: any) {
      setMsg(`저장 실패: ${String(e?.message ?? e).slice(0, 80)}`);
    } finally {
      setBusy(false);
    }
  };

  const pct = (v: number, cap: number) => Math.min(100, Math.round((v / Math.max(1, cap)) * 100));

  return (
    <div className="onb-backdrop" onClick={onClose}>
      <div className="onb-card naver-card" onClick={(e) => e.stopPropagation()}>
        <div className="approval-head">
          <b>🔎 네이버 리서치</b>
          <span className="dim">국내 시장 조사는 네이버가 강합니다 — 블로그·카페·지식iN·뉴스·트렌드</span>
          <button className="btn tiny approval-close" onClick={onClose}>
            ✕ 닫기
          </button>
        </div>

        <div className="naver-tabs">
          <button className={tab === "search" ? "on" : ""} onClick={() => setTab("search")}>
            🔍 검색
          </button>
          <button className={tab === "trend" ? "on" : ""} onClick={() => setTab("trend")}>
            📈 검색어 트렌드
          </button>
          <button className={tab === "key" ? "on" : ""} onClick={() => setTab("key")}>
            🔑 키·한도
          </button>
        </div>

        {st && st.configured && (
          <div className="naver-usage dim">
            오늘 {st.usage.daily.toLocaleString()}/{st.caps.daily.toLocaleString()}회 ({pct(st.usage.daily, st.caps.daily)}%) ·
            이달 {st.usage.monthly.toLocaleString()}/{st.caps.monthly.toLocaleString()}회 · 트렌드{" "}
            {st.usage.trendMonthly.toLocaleString()}/{st.caps.trendMonthly.toLocaleString()}회
            {st.exhausted && <b className="naver-exhausted"> · ⚠️ {st.exhausted} — 회의는 웹 검색으로 폴백합니다</b>}
          </div>
        )}

        {msg && <div className="naver-msg">{msg}</div>}

        {tab === "search" && (
          <>
            <div className="naver-row">
              <select value={type} onChange={(e) => setType(e.target.value as NaverService)}>
                {(Object.keys(NAVER_SERVICE_LABEL) as NaverService[]).map((t) => (
                  <option key={t} value={t}>
                    {NAVER_SERVICE_LABEL[t]}
                  </option>
                ))}
              </select>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="예: 방치형 RPG 이탈률 / 인디 게임 스팀 출시 후기"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runSearch();
                }}
              />
              <button className="btn small primary" onClick={() => void runSearch()} disabled={busy || !q.trim()}>
                {busy ? "…" : "검색"}
              </button>
            </div>

            {items.length > 0 && (
              <>
                <div className="naver-actions">
                  <span className="dim">{items.length}건 · 쓸 만한 것을 골라 보고서함으로 보내세요</span>
                  <button
                    className="btn small"
                    disabled={busy || Object.values(picked).filter(Boolean).length === 0}
                    onClick={() => void sendToReports()}
                  >
                    📋 선택한 {Object.values(picked).filter(Boolean).length}건 보고서로
                  </button>
                </div>
                <div className="naver-results">
                  {items.map((it) => (
                    <label key={it.link} className={`naver-item ${picked[it.link] ? "on" : ""}`}>
                      <input
                        type="checkbox"
                        checked={!!picked[it.link]}
                        onChange={(e) => setPicked((p) => ({ ...p, [it.link]: e.target.checked }))}
                      />
                      <span className="naver-item-body">
                        {type === "image" && it.thumbnail && <img src={it.thumbnail} alt="" loading="lazy" />}
                        <b>{stripNaverHtml(it.title)}</b>
                        {it.description && <span className="dim">{stripNaverHtml(it.description)}</span>}
                        <a href={it.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                          {it.link.slice(0, 72)}
                        </a>
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {tab === "trend" && (
          <>
            <div className="naver-row">
              <input
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                placeholder="쉼표로 최대 5개 — 예: 생존 게임, 방치형 RPG, 로그라이크"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runTrend();
                }}
              />
              <button className="btn small primary" onClick={() => void runTrend()} disabled={busy}>
                {busy ? "…" : "최근 1년 조회"}
              </button>
            </div>
            {groups.length > 0 && <TrendChart groups={groups} />}
          </>
        )}

        {tab === "key" && <NaverKeyForm configured={!!st?.configured} caps={st?.caps} onSaved={refresh} />}
      </div>
    </div>
  );
}

/** 키 입력은 오너 본인이 한다 — 저장 후 값은 서버에만 남고 화면으로 되돌아오지 않는다 */
function NaverKeyForm({
  configured,
  caps,
  onSaved,
}: {
  configured: boolean;
  caps?: NaverStatus["caps"];
  onSaved: () => void;
}) {
  const [daily, setDaily] = useState(String(caps?.daily ?? 20000));
  const [monthly, setMonthly] = useState(String(caps?.monthly ?? 700000));
  const [note, setNote] = useState("");
  // 키 입력은 오너가 이 앱에서 직접 한다 (Brave 키와 같은 방식) — 값은 서버로만 가고 화면에 남지 않는다
  const [cid, setCid] = useState("");
  const [csec, setCsec] = useState("");
  const [saving, setSaving] = useState(false);
  const [keyNote, setKeyNote] = useState("");

  const submitKey = async () => {
    if (!cid.trim() || !csec.trim()) return;
    setSaving(true);
    setKeyNote("");
    try {
      await saveNaverKey(cid.trim(), csec.trim());
      setCid("");
      setCsec(""); // 입력값은 즉시 비운다 — 화면에 자격증명을 남기지 않는다
      setKeyNote("✅ 등록했습니다. 🔍 검색 탭에서 바로 쓸 수 있습니다.");
      onSaved();
    } catch (e: any) {
      setKeyNote(`실패: ${String(e?.message ?? e).slice(0, 100)}`);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (caps) {
      setDaily(String(caps.daily));
      setMonthly(String(caps.monthly));
    }
  }, [caps?.daily, caps?.monthly]);

  return (
    <div className="naver-key">
      <div className={`naver-key-state ${configured ? "ok" : ""}`}>
        {configured ? "✅ 키가 등록되어 있습니다" : "⚠️ 키가 등록되지 않았습니다"}
      </div>
      <div className="naver-steps dim">
        <a href="https://developers.naver.com/apps/#/list" target="_blank" rel="noreferrer">
          네이버 개발자센터 → 내 애플리케이션
        </a>
        에서 <b>Client ID</b>와 <b>Client Secret</b>을 복사해 아래에 붙여넣으세요. 값은 이 PC의{" "}
        <code>config/naver.json</code>에만 저장되고(git 제외), 화면으로 다시 나오지 않습니다.
      </div>
      <div className="naver-keyrow">
        <label>
          Client ID
          <input
            value={cid}
            onChange={(e) => setCid(e.target.value)}
            placeholder="예: AbCdEf1234…"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label>
          Client Secret
          <input
            type="password"
            value={csec}
            onChange={(e) => setCsec(e.target.value)}
            placeholder="••••••••••"
            autoComplete="off"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitKey();
            }}
          />
        </label>
        <button className="btn small primary" onClick={() => void submitKey()} disabled={saving || !cid.trim() || !csec.trim()}>
          {saving ? "저장 중…" : "🔑 등록"}
        </button>
      </div>
      {keyNote && <div className="naver-msg">{keyNote}</div>}

      <div className="naver-caps">
        <b>안전 한도</b>
        <span className="dim">무료 한도(일 25,000 / 월 775,000)보다 낮게 잡아 초과를 막습니다. 도달하면 웹 검색으로 자동 전환됩니다.</span>
        <div className="naver-row">
          <label>
            일<input value={daily} onChange={(e) => setDaily(e.target.value)} inputMode="numeric" />
          </label>
          <label>
            월<input value={monthly} onChange={(e) => setMonthly(e.target.value)} inputMode="numeric" />
          </label>
          <button
            className="btn small"
            onClick={() => {
              void saveNaverCaps({ daily: Number(daily) || undefined, monthly: Number(monthly) || undefined })
                .then(() => {
                  setNote("✅ 한도를 저장했습니다.");
                  onSaved();
                })
                .catch((e) => setNote(`실패: ${String(e?.message ?? e).slice(0, 60)}`));
            }}
          >
            한도 저장
          </button>
        </div>
        {note && <div className="dim">{note}</div>}
      </div>
    </div>
  );
}
