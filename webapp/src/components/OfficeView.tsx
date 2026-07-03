import { useEffect, useState } from "react";
import { AGENT_MAP } from "../lib/agents";
import { AgentSprite } from "./AgentSprite";
import { ArtStudio } from "./ArtStudio";
import { DocViewer } from "./DocViewer";
import { useVE, type FeedMsg } from "../store";

/**
 * 보이는 사무실 v1 — 8명의 에이전트가 책상에 앉아 일하는 모습.
 * 상태(대기/작업/완료/오류)가 캐릭터 애니메이션으로, 최근 발언이 말풍선으로 보인다.
 * 오케스트레이션 이벤트 스트림(feed)을 그대로 시각 레이어에 연결한 것.
 */

const BUBBLE_TTL = 3 * 60 * 1000; // 말풍선 유지 시간 3분

/** 사무실 배경 테마 — 아트 인턴(로컬 SD)이 그린 픽셀아트. "auto"는 시간대로 주/야 전환 */
const BG_THEMES: { id: string; label: string; img?: string }[] = [
  { id: "auto", label: "🕐 자동 (낮/밤)" },
  { id: "day", label: "☀️ 주간 스튜디오", img: "/office/bg-day.png" },
  { id: "night", label: "🌌 야간 스튜디오", img: "/office/bg-night.png" },
  { id: "cat", label: "🐾 고양이 카페", img: "/office/bg-cat.png" },
  { id: "none", label: "◻ 배경 없음" },
];

function themeImage(theme: string, customTs?: number): string | undefined {
  if (theme === "custom" && customTs) return `/office/custom.png?v=${customTs}`;
  const t = theme === "auto" ? (new Date().getHours() >= 6 && new Date().getHours() < 18 ? "day" : "night") : theme;
  return BG_THEMES.find((b) => b.id === t)?.img;
}

function statusLabel(status: string, phase?: string): string {
  if (status === "running") return phase ?? "작업 중…";
  if (status === "done") return "작업 완료";
  if (status === "error") return "문제 발생";
  return "대기 중";
}

function Desk({ agentId, big }: { agentId: string; big?: boolean }) {
  const { agentStatus, cards, feed, selectAgent, livePeek, openProfile } = useVE();
  const a = AGENT_MAP[agentId];
  const st = agentStatus[agentId] ?? "idle";
  const phase = cards[agentId]?.phase;

  // 이 에이전트의 최근 발언 (지시/초안/검토/수정/통합)
  let last: FeedMsg | undefined;
  for (const m of feed) if (m.from === agentId) last = m;
  const fresh = last && Date.now() - last.ts < BUBBLE_TTL;
  const peek = livePeek[agentId] ?? "";
  const showBubble = st === "running" || fresh;
  // 작업 중이면 실시간 부분 응답(livePeek)을 우선 표시 — 타이핑하는 느낌
  const bubbleText =
    st === "running" && peek
      ? "…" + peek.replace(/[#*>`]/g, "").replace(/\s+/g, " ").slice(-70)
      : st === "running" && !fresh
        ? "…"
        : last
          ? last.text.replace(/[#*>`]/g, "").replace(/\s+/g, " ").slice(0, 90) + (last.text.length > 90 ? "…" : "")
          : "";

  return (
    <div
      className={`desk st-${st} ${big ? "big" : ""}`}
      data-agent={agentId}
      onClick={() => selectAgent(agentId)}
      title={`${a.name} — 클릭하면 대화`}
    >
      {showBubble && bubbleText && (
        <div className="speech" style={{ borderColor: a.color + "66" }}>
          {bubbleText}
        </div>
      )}
      <button
        className="desk-profile"
        onClick={(e) => {
          e.stopPropagation();
          openProfile(agentId);
        }}
        title="프로필 — 모델/API 설정"
      >
        ⚙
      </button>
      <div className="office-avatar" style={{ background: a.color + "26", borderColor: a.color + "88" }}>
        <AgentSprite id={agentId} size={big ? 52 : 42} />
        {st === "running" && <span className="zzz work">⚡</span>}
        {st === "idle" && <span className="zzz">💤</span>}
        {st === "done" && <span className="zzz ok">✅</span>}
        {st === "error" && <span className="zzz err">💢</span>}
      </div>
      <div className="desk-table">
        <span className="monitor">🖥️</span>
        {st === "running" && (
          <span className="typing">
            <i />
            <i />
            <i />
          </span>
        )}
      </div>
      <div className="nameplate" style={{ borderColor: a.color + "55" }}>
        {a.name}
      </div>
      <div className={`desk-status ds-${st}`}>{statusLabel(st, phase)}</div>
    </div>
  );
}

/**
 * PM 이동 연출 — PM이 최근 지시를 내린 책상 옆으로 걸어가는 미니 스프라이트.
 * 지시 후 8초 동안 대상 책상 옆에 나타났다가 사라진다.
 */
const WALK_TTL = 8000;

function PmWalker() {
  const { feed } = useVE();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // 최근 PM→담당자 지시 찾기
  let target: FeedMsg | undefined;
  for (const m of feed) {
    if (m.from === "pm" && m.to && (m.kind === "instruction" || m.kind === "status")) target = m;
  }
  const active = target && Date.now() - target.ts < WALK_TTL;

  useEffect(() => {
    if (!active || !target?.to) {
      setPos(null);
      return;
    }
    const room = document.querySelector(".office-room");
    const desk = room?.querySelector(`[data-agent="${target.to}"]`);
    if (!room || !desk) {
      setPos(null);
      return;
    }
    const rr = room.getBoundingClientRect();
    const dr = desk.getBoundingClientRect();
    setPos({ left: dr.left - rr.left - 26, top: dr.top - rr.top + 34 });
    const t = setTimeout(() => setPos(null), WALK_TTL - (Date.now() - target.ts));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, active]);

  if (!pos) return null;
  return (
    <div className="pm-walker" style={{ left: pos.left, top: pos.top }} title="PM이 지시를 전달하러 왔습니다">
      <AgentSprite id="pm" size={30} />
      <span className="pm-walker-note">지시 전달!</span>
    </div>
  );
}

/** 아트 인턴 미니 책상 — 아트 디렉터 바로 아래, 클릭하면 아트 스튜디오 */
function InternDesk({ onOpen }: { onOpen: () => void }) {
  const { artBusy, artStatus, artPhase, officeBgBusy, officeBgPhase } = useVE();
  const connected = artStatus?.connected === true;
  const busy = artBusy || officeBgBusy;
  const phase = artBusy ? artPhase : officeBgPhase;
  return (
    <div
      className={`desk intern ${busy ? "st-running" : connected ? "st-done" : "st-idle"}`}
      onClick={onOpen}
      title={connected ? "아트 인턴 — 클릭하면 아트 스튜디오" : "아트 인턴 (Stable Diffusion 미연결) — 클릭해서 설치 안내 보기"}
    >
      {busy && phase && <div className="speech">{phase.slice(0, 40)}</div>}
      <div className="office-avatar" style={{ background: "#e879f926", borderColor: "#e879f955" }}>
        <span className="intern-face">🖌️</span>
        {busy ? <span className="zzz work">⚡</span> : connected ? <span className="zzz ok">✅</span> : <span className="zzz">💤</span>}
      </div>
      <div className="nameplate" style={{ borderColor: "#e879f955" }}>
        아트 인턴
      </div>
      <div className={`desk-status ${busy ? "ds-running" : "ds-idle"}`}>
        {busy ? "그리는 중…" : connected ? "SD 대기 중" : "SD 미연결"}
      </div>
    </div>
  );
}

export function OfficeView() {
  const {
    projects,
    activeProject,
    gddMtime,
    orchRunning,
    reports,
    officeTheme,
    setOfficeTheme,
    officeBg,
    officeBgBusy,
    officeBgPhase,
    generateOfficeBg,
    artStatus,
    dailyBriefing,
    briefingBusy,
  } = useVE();
  const projectName = projects.find((p) => p.id === activeProject)?.name ?? "";
  // 말풍선 TTL 갱신용 틱
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const [docViewer, setDocViewer] = useState<null | "gdd" | "reports">(null);
  const [studioOpen, setStudioOpen] = useState(false);

  const row1 = ["scenario", "gameplay", "systems", "uiux", "td"];
  const row2 = ["balance", "bm", "scheduler", "marketing"];

  const bgUrl = themeImage(officeTheme, officeBg?.ts);

  const onNewBg = () => {
    const req = window.prompt(
      "아트 인턴에게 어떤 사무실 배경을 그리게 할까요?\n(아트 디렉터가 지금 만드는 게임의 분위기를 반영해 프롬프트를 쓰고, 인턴이 그립니다)",
      officeBg?.request || "지금 만드는 게임의 분위기가 느껴지는 아늑한 게임 스튜디오 사무실"
    );
    if (req?.trim()) void generateOfficeBg(req.trim());
  };

  return (
    <section className="office-view">
      <div className="office-header">
        <span className="office-sign">🏢 Vision Engine 스튜디오</span>
        <span className="office-project">{projectName}</span>
        {orchRunning && <span className="office-live">● 회의 진행 중</span>}
        <select
          className="model-select mini office-theme"
          value={officeTheme}
          onChange={(e) => setOfficeTheme(e.target.value)}
          title="사무실 배경 테마 — 아트 인턴이 그린 픽셀아트"
        >
          {BG_THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
          {officeBg && <option value="custom">🖼️ 커스텀 (인턴 신작)</option>}
        </select>
        {artStatus?.connected && (
          <button
            className="btn small"
            onClick={onNewBg}
            disabled={officeBgBusy}
            title="아트 인턴에게 새 사무실 배경을 그리게 합니다 (아트 디렉터가 게임 분위기 반영)"
          >
            {officeBgBusy ? (
              <>
                <span className="spinner" /> 그리는 중…
              </>
            ) : (
              "🖌️ 새 배경"
            )}
          </button>
        )}
        <button
          className="btn small"
          onClick={() => void dailyBriefing()}
          disabled={briefingBusy || orchRunning}
          title="PM이 현황·오늘 추천 작업·리스크를 정리해 대화방으로 보고합니다 — 매일 아침 한 번"
        >
          {briefingBusy ? (
            <>
              <span className="spinner" /> 브리핑…
            </>
          ) : (
            "☀️ 오늘의 브리핑"
          )}
        </button>
        <span className="office-doc-tabs">
          <button className="btn small" onClick={() => setDocViewer("gdd")} title="마스터 GDD를 큰 화면으로">
            📄 GDD
          </button>
          <button className="btn small" onClick={() => setDocViewer("reports")} title="보고서함을 큰 화면으로">
            📋 보고서{reports.length > 0 ? ` ${reports.length}` : ""}
          </button>
        </span>
      </div>
      {officeBgPhase && <div className="office-bg-phase dim">{officeBgPhase}</div>}
      <div className={`office-room ${bgUrl ? "has-bg" : ""}`} style={bgUrl ? { backgroundImage: `url("${bgUrl}")` } : undefined}>
        <div className="office-wall">
          <div className="office-window" title={new Date().getHours() >= 6 && new Date().getHours() < 18 ? "낮" : "밤"}>
            <span className="celestial">{new Date().getHours() >= 6 && new Date().getHours() < 18 ? "☀️" : "🌙"}</span>
            <span className="cloud c1" />
            <span className="cloud c2" />
            <span className="cloud c3" />
          </div>
          <button className="gdd-board" onClick={() => setDocViewer("gdd")} title="GDD를 큰 화면으로 보기">
            📄 마스터 GDD 보드
            <span className="dim">{gddMtime ? `갱신 ${new Date(gddMtime).toLocaleTimeString("ko-KR", { hour12: false })}` : "대기"}</span>
          </button>
          <div className="office-clock" title="현재 시각">
            🕐 {new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })}
          </div>
          <span className="office-plant p1">🪴</span>
          <span className="office-plant p2">🌿</span>
        </div>
        <div className="office-row pm-row">
          <Desk agentId="pm" big />
        </div>
        <div className="office-row">
          {row1.map((id) => (
            <Desk key={id} agentId={id} />
          ))}
        </div>
        <div className="office-row">
          {row2.map((id) => (
            <Desk key={id} agentId={id} />
          ))}
          <div className="art-corner">
            <Desk agentId="visual" />
            <InternDesk onOpen={() => setStudioOpen(true)} />
          </div>
        </div>
        <div className="office-floor" />
        <PmWalker />
      </div>
      <div className="office-hint dim">
        캐릭터 클릭 → 1:1 대화 · ⚙ → 프로필(모델 교체) · 🖌️ 아트 인턴 → 컨셉 아트 · 상단 테마 셀렉터 → 사무실 배경
      </div>

      {docViewer && <DocViewer tab={docViewer} onTab={setDocViewer} onClose={() => setDocViewer(null)} />}
      {studioOpen && <ArtStudio onClose={() => setStudioOpen(false)} />}
    </section>
  );
}
