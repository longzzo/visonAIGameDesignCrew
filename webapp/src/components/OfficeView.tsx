import { useEffect, useRef, useState } from "react";
import { AGENTS, AGENT_MAP, SPECIALISTS } from "../lib/agents";
import { DecisionOverlay } from "./DecisionOverlay";
import { uiPrompt } from "../lib/dialog";
import { AgentSprite } from "./AgentSprite";
import { Office3D, ZONES, zoneOfAgent, type CamApi } from "./Office3D";
import { DevTaskPanel } from "./DevTaskPanel";
import { HireModal } from "./HireModal";
import { PrototypeStudio } from "./PrototypeStudio";
import { WorkstreamBoard } from "./WorkstreamBoard";
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

function Desk({ agentId, big, onDevTask }: { agentId: string; big?: boolean; onDevTask?: (id: string) => void }) {
  const { agentStatus, cards, feed, selectAgent, livePeek, openProfile, meetingMembers } = useVE();
  const a = AGENT_MAP[agentId];
  const st = agentStatus[agentId] ?? "idle";
  const phase = cards[agentId]?.phase;
  const inMeeting = meetingMembers.includes(agentId);

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
      className={`desk st-${st} ${big ? "big" : ""} ${inMeeting ? "away" : ""}`}
      data-agent={agentId}
      onClick={() => selectAgent(agentId)}
      title={inMeeting ? `${a.name} — 회의실에서 회의 중` : `${a.name} — 클릭하면 대화`}
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
      {onDevTask && (
        <button
          className="desk-devtask"
          onClick={(e) => {
            e.stopPropagation();
            onDevTask(agentId);
          }}
          title="개발 작업 — MCP 도구로 실제 파일에 관여"
        >
          ▶
        </button>
      )}
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
      <div className={`desk-status ds-${st}`}>{inMeeting ? "회의실에 있음 🚶" : statusLabel(st, phase)}</div>
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

/** 회의실 — 협업 세션·팀 리뷰 중일 때 참가자들이 실제로 걸어와 모이는 구역 */
function MeetingRoom() {
  const { meetingMembers, feed } = useVE();
  const active = meetingMembers.length > 0;
  const n = meetingMembers.length;
  // 각 참가자의 최근 발언 (옆에 붙어 대화하는 느낌)
  const lastSay: Record<string, string> = {};
  for (const m of feed) if (m.from && meetingMembers.includes(m.from)) lastSay[m.from] = m.text;
  return (
    <div className={`meeting-room ${active ? "active" : ""}`} data-meeting="room" title="회의실">
      {/* 원탁 둘레로 참가자가 둘러앉는다 */}
      {active &&
        meetingMembers.map((id, i) => {
          const a = AGENT_MAP[id];
          const ang = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
          const rx = 108;
          const ry = 66;
          const left = 50 + (Math.cos(ang) * rx) / 2.4;
          const top = 50 + (Math.sin(ang) * ry) / 2.4;
          const say = lastSay[id];
          return (
            <div key={id} className="mtg-seat" style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${i * 0.12}s` }}>
              {say && <div className="mtg-bubble">{say.replace(/[#*>`]/g, "").replace(/\s+/g, " ").slice(0, 40)}</div>}
              <div className="mtg-seat-av" style={{ borderColor: (a?.color ?? "#8b7cf6") + "aa" }}>
                <AgentSprite id={id} size={30} />
              </div>
              <span className="mtg-seat-name">{a?.name?.split(" ")[0]}</span>
            </div>
          );
        })}
      <span className="meeting-table">🟫</span>
      <div className="meeting-label">{active ? `🗣 회의 중 · ${n}명` : "회의실 (대기)"}</div>
    </div>
  );
}

/** 회의실로 걸어가는 참가자 하나 — 자리 이동은 CSS transition으로 부드럽게 처리 */
function MeetingWalker({ agentId, atMeeting, seat }: { agentId: string; atMeeting: boolean; seat: number }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const a = AGENT_MAP[agentId];

  useEffect(() => {
    const room = document.querySelector(".office-room");
    if (!room) return;
    const rr = room.getBoundingClientRect();
    if (atMeeting) {
      const table = room.querySelector('[data-meeting="room"]');
      if (!table) return;
      const tr = table.getBoundingClientRect();
      const seats: [number, number][] = [
        [-46, -4],
        [-14, -4],
        [18, -4],
        [50, -4],
        [-30, 20],
        [34, 20],
      ];
      const [ox, oy] = seats[seat % seats.length];
      setPos({ left: tr.left - rr.left + tr.width / 2 - 15 + ox, top: tr.top - rr.top + oy });
    } else {
      const desk = room.querySelector(`[data-agent="${agentId}"]`);
      if (!desk) {
        setPos(null);
        return;
      }
      const dr = desk.getBoundingClientRect();
      setPos({ left: dr.left - rr.left + dr.width / 2 - 15, top: dr.top - rr.top + 30 });
    }
  }, [agentId, atMeeting, seat]);

  if (!pos) return null;
  return (
    <div
      className="meeting-walker"
      style={{ left: pos.left, top: pos.top }}
      title={`${a.name} — ${atMeeting ? "회의 중" : "자리로 복귀 중"}`}
    >
      <AgentSprite id={agentId} size={28} />
    </div>
  );
}

/** meetingMembers 변화를 감지해 각 참가자의 등장(걸어오기)·퇴장(걸어가기)을 관리 */
function MeetingWalkers() {
  const { meetingMembers } = useVE();
  const [atMeeting, setAtMeeting] = useState<Record<string, boolean>>({});
  const key = meetingMembers.join(",");

  useEffect(() => {
    setAtMeeting((prev) => {
      const next = { ...prev };
      for (const id of meetingMembers) next[id] = true;
      for (const id of Object.keys(prev)) if (!meetingMembers.includes(id)) next[id] = false;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const leaving = Object.entries(atMeeting).filter(([, at]) => !at);
    if (leaving.length === 0) return;
    const t = setTimeout(() => {
      setAtMeeting((prev) => {
        const next = { ...prev };
        for (const id of Object.keys(next)) if (!next[id]) delete next[id];
        return next;
      });
    }, 1200);
    return () => clearTimeout(t);
  }, [atMeeting]);

  const ids = Object.keys(atMeeting);
  if (ids.length === 0) return null;
  return (
    <>
      {ids.map((id, i) => (
        <MeetingWalker key={id} agentId={id} atMeeting={atMeeting[id]} seat={i} />
      ))}
    </>
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

/** 개발 인턴 미니 책상 — 선임 개발자(td) 바로 아래, 클릭하면 프로토타입 스튜디오 */
function DevInternDesk({ onOpen }: { onOpen: () => void }) {
  const { protoBusy, protoPhase } = useVE();
  return (
    <div
      className={`desk intern ${protoBusy ? "st-running" : "st-done"}`}
      onClick={onOpen}
      title="개발 인턴 — 클릭하면 프로토타입 스튜디오"
    >
      {protoBusy && protoPhase && <div className="speech">{protoPhase.slice(0, 40)}</div>}
      <div className="office-avatar" style={{ background: "#38bdf826", borderColor: "#38bdf855" }}>
        <span className="intern-face">🧑‍💻</span>
        {protoBusy ? <span className="zzz work">⚡</span> : <span className="zzz ok">✅</span>}
      </div>
      <div className="nameplate" style={{ borderColor: "#38bdf855" }}>
        개발 인턴
      </div>
      <div className={`desk-status ${protoBusy ? "ds-running" : "ds-idle"}`}>{protoBusy ? "만드는 중…" : "대기 중"}</div>
    </div>
  );
}

/** 파티션 부서 — 역할별로 실제 벽으로 구분된 사무 공간 */
function Dept({ title, hint, accent, children }: { title: string; hint?: string; accent?: string; children: React.ReactNode }) {
  return (
    <div className="office-dept" style={accent ? { borderColor: accent + "55" } : undefined}>
      <div className="dept-label" style={accent ? { color: accent } : undefined}>
        {title}
        {hint && <span className="dept-hint dim"> {hint}</span>}
      </div>
      <div className="dept-desks">{children}</div>
    </div>
  );
}

/**
 * 코드 개발자 + 인턴 2인 1조 — 실제 코드에 관여하는 개발자에게 인턴을 붙여
 * 서로 검증(개발 회의: 구현→리뷰→검증)을 자주 하게 한다.
 * ▶ 버튼은 단독 작업, 🤝 버튼은 인턴과 함께 교차 검증 회의를 연다.
 */
function CodeDevPair({ agentId, onTask, onMeeting }: { agentId: string; onTask: (id: string) => void; onMeeting: (id: string) => void }) {
  const a = AGENT_MAP[agentId];
  const { agentStatus } = useVE();
  const st = agentStatus[agentId] ?? "idle";
  return (
    <div className="code-pair">
      <Desk agentId={agentId} onDevTask={onTask} />
      <div className="pair-intern" title={`${a?.name}의 인턴 — 함께 검증`}>
        <div className="pair-intern-av" style={{ borderColor: (a?.color ?? "#8b7cf6") + "66" }}>
          🧑‍🎓
        </div>
        <span className="pair-intern-tag">인턴</span>
      </div>
      <button
        className="pair-meeting-btn"
        onClick={() => onMeeting(agentId)}
        title="개발 회의 — 구현 → 코드 리뷰어 검토 → 테스트 검증으로 인턴과 교차 확인"
      >
        🤝 검증
      </button>
      {st === "running" && <span className="pair-busy">⚡</span>}
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
    reviewExistingPlan,
    planReviewBusy,
    planReviewPhase,
    meetingMembers,
    openDocViewer,
    setArtStudioOpen,
    agentStatus,
    selectAgent,
    openProfile,
    setOrchRequest,
    startOrch,
    stopOrch,
    cards,
    selected,
    toggleSelected,
  } = useVE();
  useVE((s) => s.rosterVersion); // 채용/퇴사 시 로스터 다시 그리기
  const [hireOpen, setHireOpen] = useState(false);
  const projectName = projects.find((p) => p.id === activeProject)?.name ?? "";
  // 말풍선 TTL 갱신용 틱
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const [protoStudioOpen, setProtoStudioOpen] = useState(false);
  const [devTaskAgent, setDevTaskAgent] = useState<string | null>(null);
  const [devTaskInit, setDevTaskInit] = useState<{ task?: string; meeting?: boolean }>({});
  const openDevTask = (id: string) => {
    setDevTaskInit({});
    setDevTaskAgent(id);
  };
  const startUnityReview = () => {
    setDevTaskInit({
      task:
        "unity-project 도구로 등록된 기존 유니티 프로젝트를 훑어봐라. Assets/Scripts 위주로 주요 스크립트를 읽고, " +
        "아키텍처·코드 품질·성능·구조 관점에서 보완점을 찾아 우선순위와 함께 정리해라. 파일을 직접 읽어 근거를 대라.",
      meeting: true,
    });
    setDevTaskAgent("td");
  };
  const [floor, setFloor] = useState<"plan" | "dev" | "meeting">(() => {
    try {
      const f = localStorage.getItem("ve-office-floor");
      if (f === "plan" || f === "dev" || f === "meeting") return f;
    } catch {
      /* noop */
    }
    return "plan";
  });
  const goFloor = (f: "plan" | "dev" | "meeting") => {
    try {
      localStorage.setItem("ve-office-floor", f);
    } catch {
      /* noop */
    }
    setFloor(f);
  };
  const openMeeting = (id: string) => {
    setDevTaskInit({ meeting: true });
    setDevTaskAgent(id);
  }; // 인턴 검증 회의 = 개발 작업 패널(회의 모드)

  /* ── 3D 스튜디오 상태 (존 탭 · 로스터 · 커맨드바 · 보드) ── */
  const camRef = useRef<CamApi>({});
  const [zone, setZone] = useState("all");
  const [rosterOpen, setRosterOpen] = useState(true);
  const [boardOpen, setBoardOpen] = useState(false);
  const [cmd, setCmd] = useState("");
  const focusZone = (id: string) => {
    setZone(id);
    camRef.current.focus?.(id);
  };
  const submitCmd = () => {
    const t = cmd.trim();
    if (!t || orchRunning) return;
    setOrchRequest(t);
    setCmd("");
    void startOrch();
  };

  // 회의가 시작되면(참가자 모임) 자동으로 회의실로 시선 이동 — 모이는 모습을 보여준다
  const prevMeetingCount = useRef(0);
  useEffect(() => {
    if (meetingMembers.length > 0 && prevMeetingCount.current === 0) {
      if (mode3d) focusZone("meet");
      else goFloor("meeting");
    }
    prevMeetingCount.current = meetingMembers.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingMembers.length]);
  const [mode3d, setMode3d] = useState<boolean>(() => {
    try {
      // 기본 = 3D 스튜디오 (명시적으로 2D를 고른 적 있을 때만 2D)
      return localStorage.getItem("ve-office-mode") !== "2d";
    } catch {
      return true;
    }
  });
  const toggleMode3d = () => {
    setMode3d((v) => {
      try {
        localStorage.setItem("ve-office-mode", v ? "2d" : "3d");
      } catch {
        /* noop */
      }
      return !v;
    });
  };

  const row1 = ["scenario", "gameplay", "systems", "uiux"];
  const row2 = ["balance", "bm", "scheduler", "marketing"];

  const bgUrl = themeImage(officeTheme, officeBg?.ts);

  const onNewBg = () => {
    void uiPrompt("아트 인턴에게 어떤 사무실 배경을 그리게 할까요?", {
      message: "아트 디렉터가 지금 만드는 게임의 분위기를 반영해 프롬프트를 쓰고, 인턴이 그립니다.",
      defaultValue: officeBg?.request || "지금 만드는 게임의 분위기가 느껴지는 아늑한 게임 스튜디오 사무실",
      confirmLabel: "🖌️ 그리기",
    }).then((req) => {
      if (req?.trim()) void generateOfficeBg(req.trim());
    });
  };

  /* ── 3D 풀스크린 스튜디오 (Sample 추구미 — 도시 오피스 위 유리 패널) ── */
  if (mode3d) {
    const cardVals = Object.values(cards);
    const doneCount = cardVals.filter((c) => c.state === "done").length;
    return (
      <section className="office-studio">
        <Office3D
          camRef={camRef}
          onDevTask={openDevTask}
          onArtIntern={() => setArtStudioOpen(true)}
          onProtoIntern={() => setProtoStudioOpen(true)}
        />

        {/* 상단 — 존 탭 + 액션 */}
        <div className="os-top">
          <div className="os-zones glass">
            <button className={`os-zone ${zone === "all" ? "on" : ""}`} onClick={() => focusZone("all")}>
              <span className="o3d-dot" style={{ background: "#9aa5b5" }} />
              전체
            </button>
            {ZONES.map((z) => (
              <button key={z.id} className={`os-zone ${zone === z.id ? "on" : ""}`} onClick={() => focusZone(z.id)}>
                <span className="o3d-dot" style={{ background: z.dot }} />
                {z.label}
                {z.id === "meet" && meetingMembers.length > 0 && <i className="os-badge">{meetingMembers.length}</i>}
              </button>
            ))}
          </div>
          <div className="os-actions glass">
            <span className="os-clock dim">
              {new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })}
            </span>
            {orchRunning && <span className="office-live">● 진행 중</span>}
            <button className="os-abtn" onClick={() => setBoardOpen(true)} title="라이브 프로세스 — 전사 워크스트림 현황">
              📋 보드
            </button>
            <button className="os-abtn" onClick={() => openDocViewer("gdd")} title="마스터 GDD를 큰 화면으로">
              📄 GDD
            </button>
            <button className="os-abtn" onClick={() => openDocViewer("reports")} title="보고서함">
              📑{reports.length > 0 ? ` ${reports.length}` : ""}
            </button>
            <button className="os-abtn" onClick={() => openDocViewer("art")} title="아트 보관함">
              🖼️
            </button>
            <button className="os-abtn" onClick={() => setArtStudioOpen(true)} title="아트 인턴 — 컨셉 아트 생성">
              🖌️
            </button>
            <button
              className="os-abtn"
              onClick={() => setProtoStudioOpen(true)}
              title="시뮬레이터 — 개발 인턴의 플레이 가능한 그레이박스·와이어프레임 프로토타입"
            >
              🕹️
            </button>
            <button
              className="os-abtn"
              onClick={() => void dailyBriefing()}
              disabled={briefingBusy || orchRunning}
              title="PM 오늘의 브리핑 — 현황·추천 작업·리스크"
            >
              {briefingBusy ? "…" : "☀️"}
            </button>
            <button
              className="os-abtn"
              onClick={() => void reviewExistingPlan()}
              disabled={planReviewBusy || orchRunning}
              title="기존 기획 팀 리뷰 — PM 분배로 전원 학습·평가"
            >
              {planReviewBusy ? "…" : "📥"}
            </button>
            <button className="os-abtn" onClick={startUnityReview} title="유니티 프로젝트 리뷰 (개발 회의)">
              🎮
            </button>
            <button
              className="os-abtn"
              onClick={() => setOfficeTheme(officeTheme === "day" ? "night" : officeTheme === "night" ? "auto" : "day")}
              title={`테마: ${officeTheme === "day" ? "낮" : officeTheme === "night" ? "밤" : "자동(시간)"} — 클릭해 전환`}
            >
              {officeTheme === "day" ? "☀" : officeTheme === "night" ? "🌙" : "🌗"}
            </button>
            <button className="os-abtn" onClick={toggleMode3d} title="2D 사무실로 전환">
              🟦 2D
            </button>
          </div>
        </div>

        {/* 좌측 — 인력 현황 로스터 */}
        <div className={`os-left glass ${rosterOpen ? "" : "closed"}`}>
          <button className="os-roster-head" onClick={() => setRosterOpen((v) => !v)}>
            👥 인력 배치{" "}
            <span className="dim">
              투입 {SPECIALISTS.filter((s) => selected[s.id]).length}/{SPECIALISTS.length}
            </span>
            <i className="os-fold">{rosterOpen ? "▾" : "▸"}</i>
          </button>
          {rosterOpen && (
            <div className="os-roster">
              {AGENTS.map((a) => {
                const st = agentStatus[a.id] ?? "idle";
                const meeting = meetingMembers.includes(a.id);
                const deployable = SPECIALISTS.some((s) => s.id === a.id);
                return (
                  <div key={a.id} className="os-agent" onClick={() => selectAgent(a.id)} title={`${a.role} — 클릭하면 1:1 대화`}>
                    {deployable ? (
                      <input
                        type="checkbox"
                        className="os-agent-chk"
                        checked={selected[a.id] ?? false}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleSelected(a.id)}
                        title="인력 배치 — 회의(오케스트레이션) 투입 여부"
                        disabled={orchRunning}
                      />
                    ) : (
                      <span className="os-agent-chk ph" />
                    )}
                    <span className="o3d-dot" style={{ background: a.color }} />
                    <span className="os-agent-name">{a.name}</span>
                    <span className={`os-agent-st s-${meeting ? "running" : st}`}>
                      {meeting ? "회의" : st === "running" ? "작업" : st === "done" ? "완료" : st === "error" ? "오류" : "대기"}
                    </span>
                    <span className="os-agent-zone dim">{zoneOfAgent(a.id).label.replace(" 데스크", "").replace(" 스튜디오", "")}</span>
                    <button
                      className="os-agent-cfg"
                      onClick={(e) => {
                        e.stopPropagation();
                        openProfile(a.id);
                      }}
                      title="프로필·모델 설정"
                    >
                      ⚙
                    </button>
                  </div>
                );
              })}
              <button className="os-hire" onClick={() => setHireOpen(true)} title="새 전문가를 채용해 팀에 합류시킵니다">
                ➕ 직원 채용
              </button>
            </div>
          )}
        </div>

        {/* 하단 — 지시 커맨드바 */}
        <div className="os-bottom">
          {(officeBgPhase || planReviewPhase) && <div className="os-phase glass dim">{officeBgPhase || planReviewPhase}</div>}
          <div className="os-cmd glass">
            <span className="os-cmd-ctx dim">{projectName || "프로젝트"} → 🎯 PM</span>
            <input
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitCmd();
              }}
              placeholder="임무를 입력하세요 — PM이 분석해 담당자에게 배정합니다"
              disabled={orchRunning}
            />
            {orchRunning ? (
              <>
                <span className="os-cmd-prog dim">
                  {doneCount}/{cardVals.length || "…"} 완료
                </span>
                <button className="btn small danger" onClick={stopOrch}>
                  ⏹ 중단
                </button>
              </>
            ) : (
              <button className="btn small primary" onClick={submitCmd} disabled={!cmd.trim()}>
                지시
              </button>
            )}
          </div>
          {!orchRunning && (
            <div className="os-chips">
              {[
                "핵심 루프를 3단계로 정리하고 GDD에 반영해줘",
                "겨울 시즌 이벤트 기획 — 시스템·밸런스·아트까지",
                "경쟁작 리서치해서 차별점 한 장으로 정리해줘",
              ].map((c) => (
                <button key={c} className="os-chip glass" onClick={() => setCmd(c)}>
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>

        <DecisionOverlay />
        {hireOpen && <HireModal onClose={() => setHireOpen(false)} />}
        {boardOpen && <WorkstreamBoard onClose={() => setBoardOpen(false)} />}
        {protoStudioOpen && <PrototypeStudio onClose={() => setProtoStudioOpen(false)} />}
        {devTaskAgent && (
          <DevTaskPanel
            agentId={devTaskAgent}
            initialTask={devTaskInit.task}
            autoMeeting={devTaskInit.meeting}
            onClose={() => {
              setDevTaskAgent(null);
              setDevTaskInit({});
            }}
          />
        )}
      </section>
    );
  }

  return (
    <section className="office-view">
      <div className="office-header">
        <span className="office-sign">🏢 Vision Engine 스튜디오</span>
        <span className="office-project">{projectName}</span>
        {orchRunning && <span className="office-live">● 회의 진행 중</span>}
        <button
          className={`btn small ${mode3d ? "primary" : ""}`}
          onClick={toggleMode3d}
          title="3D 사무실 — 에이전트가 실제로 걸어다니며 보고·회의하는 입체 뷰"
        >
          {mode3d ? "🟦 2D 사무실" : "🧊 3D 사무실"}
        </button>
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
        <button
          className="btn small"
          onClick={() => void reviewExistingPlan()}
          disabled={planReviewBusy || orchRunning}
          title="PM이 기존 기획(GDD) 전체를 읽고 역할별 브리핑을 넘겨, 각자 학습 후 보완점·평가를 회의실에서 취합합니다"
        >
          {planReviewBusy ? (
            <>
              <span className="spinner" /> 팀 리뷰…
            </>
          ) : (
            "📥 기존 기획 리뷰"
          )}
        </button>
        <span className="office-doc-tabs">
          <button className="btn small" onClick={() => openDocViewer("gdd")} title="마스터 GDD를 큰 화면으로">
            📄 GDD
          </button>
          <button className="btn small" onClick={() => openDocViewer("reports")} title="보고서함을 큰 화면으로">
            📋 보고서{reports.length > 0 ? ` ${reports.length}` : ""}
          </button>
          <button className="btn small" onClick={() => openDocViewer("art")} title="아트 보관함을 큰 화면으로">
            🖼️ 아트
          </button>
        </span>
      </div>
      {officeBgPhase && <div className="office-bg-phase dim">{officeBgPhase}</div>}
      {planReviewPhase && <div className="office-bg-phase dim">{planReviewPhase}</div>}
      {!mode3d && (
        <div className="floor-nav">
          <button className={`floor-btn ${floor === "plan" ? "on" : ""}`} onClick={() => goFloor("plan")}>
            🏢 1F 기획팀
          </button>
          <button className={`floor-btn ${floor === "dev" ? "on" : ""}`} onClick={() => goFloor("dev")}>
            🛠️ 2F 개발팀
          </button>
          <button className={`floor-btn ${floor === "meeting" ? "on" : ""}`} onClick={() => goFloor("meeting")}>
            🗣️ 회의실
            {meetingMembers.length > 0 && <span className="floor-badge">{meetingMembers.length}</span>}
          </button>
        </div>
      )}
      {mode3d ? (
        <Office3D />
      ) : (
      <div className={`office-room ${bgUrl ? "has-bg" : ""}`} style={bgUrl ? { backgroundImage: `url("${bgUrl}")` } : undefined}>
        <div className="office-wall">
          <div className="office-window" title={new Date().getHours() >= 6 && new Date().getHours() < 18 ? "낮" : "밤"}>
            <span className="celestial">{new Date().getHours() >= 6 && new Date().getHours() < 18 ? "☀️" : "🌙"}</span>
            <span className="cloud c1" />
            <span className="cloud c2" />
            <span className="cloud c3" />
          </div>
          <button className="gdd-board" onClick={() => openDocViewer("gdd")} title="GDD를 큰 화면으로 보기">
            📄 마스터 GDD 보드
            <span className="dim">{gddMtime ? `갱신 ${new Date(gddMtime).toLocaleTimeString("ko-KR", { hour12: false })}` : "대기"}</span>
          </button>
          <div className="office-clock" title="현재 시각">
            🕐 {new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })}
          </div>
          <span className="office-plant p1">🪴</span>
          <span className="office-plant p2">🌿</span>
        </div>

        {floor === "plan" && (
          <div className="office-depts">
            <Dept title="🎯 PM실" hint="총괄·품질" accent="#8b7cf6">
              <Desk agentId="pm" big />
              <Desk agentId="qa" />
            </Dept>
            <Dept title="📝 기획 파트" hint="세계관·플레이·시스템·UX" accent="#60a5fa">
              {row1.map((id) => (
                <Desk key={id} agentId={id} />
              ))}
            </Dept>
            <Dept title="📊 사업 파트" hint="밸런스·수익·마케팅·일정" accent="#fbbf24">
              {row2.map((id) => (
                <Desk key={id} agentId={id} />
              ))}
            </Dept>
            <Dept title="🎨 아트 파트" hint="아트 디렉터 + 인턴" accent="#e879f9">
              <Desk agentId="visual" />
              <InternDesk onOpen={() => setArtStudioOpen(true)} />
            </Dept>
          </div>
        )}

        {floor === "dev" && (
          <div className="office-depts">
            <div className="dev-toolbar">
              <button className="btn small" onClick={startUnityReview} title="등록한 기존 유니티 프로젝트를 개발팀이 직접 읽고 리뷰·보완점을 뽑습니다 (MCP 🔌에서 프로젝트 경로 등록)">
                🎮 유니티 프로젝트 리뷰
              </button>
            </div>
            <Dept title="🛠️ 선임 개발실" hint="아키텍처 + 개발 인턴" accent="#38bdf8">
              <Desk agentId="td" onDevTask={openDevTask} />
              <DevInternDesk onOpen={() => setProtoStudioOpen(true)} />
            </Dept>
            <Dept title="💻 구현 파트 — 2인 1조로 서로 검증" hint="각 개발자에 인턴 페어" accent="#a78bfa">
              {["uarch", "ugp", "netcode", "techart", "edtool"].map((id) => (
                <CodeDevPair key={id} agentId={id} onTask={openDevTask} onMeeting={openMeeting} />
              ))}
            </Dept>
            <Dept title="🔍 검증 파트" hint="코드 리뷰 · 테스트" accent="#f43f5e">
              {["review", "testeng"].map((id) => (
                <Desk key={id} agentId={id} onDevTask={openDevTask} />
              ))}
            </Dept>
          </div>
        )}

        {floor === "meeting" && (
          <div className="office-depts meeting-floor">
            <MeetingRoom />
            <div className="meeting-help dim">
              협업 세션·기존 기획 리뷰·개발 회의가 시작되면 참가자들이 이 회의실로 모입니다.
              <br />
              오케스트레이션 뷰의 🤝 협업 세션, 사무실 상단 📥 기존 기획 리뷰, 개발 데스크의 🤝 검증에서 시작하세요.
            </div>
          </div>
        )}

        <div className="office-floor" />
        {floor === "plan" && <PmWalker />}
        {floor === "meeting" && <MeetingWalkers />}
      </div>
      )}
      <div className="office-hint dim">
        {floor === "plan"
          ? "1층 기획팀 — 캐릭터 클릭 → 1:1 대화 · ⚙ → 프로필 · 🖌️ 아트 인턴 → 컨셉 아트"
          : floor === "dev"
            ? "2층 개발팀 — ▶ 단독 작업 · 🤝 검증(인턴과 교차) · 🧑‍💻 개발 인턴 → 프로토타입"
            : "회의실 — 회의가 시작되면 참가자가 모입니다"}
      </div>

      {protoStudioOpen && <PrototypeStudio onClose={() => setProtoStudioOpen(false)} />}
      {devTaskAgent && (
        <DevTaskPanel
          agentId={devTaskAgent}
          initialTask={devTaskInit.task}
          autoMeeting={devTaskInit.meeting}
          onClose={() => {
            setDevTaskAgent(null);
            setDevTaskInit({});
          }}
        />
      )}
    </section>
  );
}
