import { useRef, useState, useEffect, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { Group, Vector3 } from "three";
import { AGENTS, AGENT_MAP } from "../lib/agents";
import { useVE, type FeedMsg } from "../store";

/**
 * 3D 디지털 오피스 v3 — "도시 속 오픈 플로어" (Sample 추구미).
 *   · 로우폴리 도시 블록 위 단층 플레이트, 부서별 컬러 러그 존 + 다크 필 라벨
 *   · 흰 마네킹 캐릭터(얼굴 없음) — 이름·상태 필, 흰 말풍선, 회의실 집결
 *   · 낮/밤 테마(officeTheme: auto|day|night), 밤엔 창문·조명 발광
 *   · 2D와 같은 store 상태(agentStatus/feed/meetingMembers) 공유:
 *     회의 소집→회의실 집결 / 산출물 제출→대표실 앞 보고 / PM 지시→담당 책상 방문
 */

type V3 = [number, number, number];

/* ── 존 정의 — lib/zones 공유 (store의 소통 범위 판정과 동일 소스) ── */
import { ZONES, zoneOfAgent, AGENT_ZONE, type ZoneDef } from "../lib/zones";
export { ZONES, zoneOfAgent, type ZoneDef };

/* ── 좌석 배치 (x, z) — 단층 플레이트 ────────────────── */
const DESK_POS: Record<string, V3> = {
  // 대표실 (PM 단독 — 찾아오는 방)
  pm: [-12.5, 0, -9.6],
  // 기획 데스크
  scenario: [-12, 0, -1],
  gameplay: [-8.5, 0, -1],
  systems: [-5, 0, -1],
  uiux: [-12, 0, 2.2],
  balance: [-8.5, 0, 2.2],
  // 사업 데스크
  bm: [-12, 0, 8],
  scheduler: [-9.5, 0, 8],
  marketing: [-7, 0, 8],
  // 아트 스튜디오
  visual: [-2.5, 0, 8],
  // 개발 데스크
  td: [3.5, 0, -1],
  uarch: [7, 0, -1],
  ugp: [10.5, 0, -1],
  netcode: [3.5, 0, 2.2],
  techart: [7, 0, 2.2],
  edtool: [10.5, 0, 2.2],
  // 품질 검수
  qa: [9.2, 0, 8],
  review: [11.9, 0, 8],
  testeng: [14.6, 0, 8],
};
const MEETING_CENTER: V3 = [3.5, 0, -8.5];

/** 채용 직원(게스트) 책상 앞줄 기준선 — 부서별 [시작x, 간격x, z, 방향(+1 오른쪽)] */
const GUEST_ROW: Record<string, [number, number, number]> = {
  plan: [-15.5, 2.6, 4.6], //   기획 데스크 앞줄
  dev: [1, 2.6, 4.6], //        개발 데스크 앞줄
  biz: [-13.5, 2.6, 11], //     사업 데스크 앞줄
  art: [-4.2, 2.6, 11], //      아트 스튜디오 앞줄
  qa: [8.6, 2.6, 11], //        품질 검수 앞줄
};

/** 책상 위치 — 기본 로스터는 고정 좌석, 채용 직원은 부서 앞줄에 순서대로(자동 확장) */
const deskFor = (id: string): V3 => {
  if (DESK_POS[id]) return DESK_POS[id];
  const zone = AGENT_ZONE[id] ?? "plan";
  const peers = AGENTS.filter((a) => a.custom && (AGENT_ZONE[a.id] ?? "plan") === zone).map((a) => a.id);
  const [x0, dx, z] = GUEST_ROW[zone] ?? GUEST_ROW.plan;
  const i = Math.max(0, peers.indexOf(id));
  return [x0 + i * dx, 0, z];
};

/** 캐릭터 기본 위치 = 책상 뒤(카메라 반대편) */
const homeOf = (id: string): V3 => {
  const d = deskFor(id);
  return [d[0], 0, d[2] - 0.9];
};
/** 회의 좌석 — 긴 테이블 양쪽 + 양 끝 */
const MEET_SEATS: [number, number][] = [
  [-1.9, 1.35], [0, 1.35], [1.9, 1.35],
  [-1.9, -1.35], [0, -1.35], [1.9, -1.35],
  [-3.1, 0], [3.1, 0],
];
const meetingSeat = (i: number): V3 => {
  const [dx, dz] = MEET_SEATS[i % MEET_SEATS.length];
  return [MEETING_CENTER[0] + dx, 0, MEETING_CENTER[2] + dz];
};
/** 대표실 앞 보고 지점 — id 해시로 분산 */
const pmFront = (id: string): V3 => {
  const h = [...id].reduce((s, c) => s + c.charCodeAt(0), 0);
  return [-14 + (h % 5) * 0.8, 0, -4.6];
};

const REPORT_TTL = 7000;
const VISIT_TTL = 7000;

/* ── 휴게실 — 좌석·서있는 자리·2인 잡담 대본 (연출용, LLM 호출 없음) ── */
const LOUNGE_TABLE: V3 = [12.5, 0, -8.6];
const LOUNGE_SEATS: [number, number][] = [
  [11.6, -10.15], [12.5, -10.15], [13.4, -10.15], // 북쪽 소파
  [11.6, -7.05], [12.5, -7.05], [13.4, -7.05], // 남쪽 소파 (마주 보기)
];
/** 마주 보는 좌석 짝 (북i ↔ 남i) */
const LOUNGE_PAIRS: [number, number][] = [[0, 3], [1, 4], [2, 5]];
/** 커피머신 · 자판기 · 정수기 앞 */
const LOUNGE_STANDS: [number, number][] = [[16, -10.1], [16.2, -6.7], [10, -10.4]];
const seatV3 = (i: number): V3 => [LOUNGE_SEATS[i][0], 0, LOUNGE_SEATS[i][1]];
/** 번갈아 말하는 2인 대본 — 짝수 줄 = 먼저 자리 잡은 쪽 */
const CONVOS: string[][] = [
  ["어제 그 인디 게임 해보셨어요?", "네! 코어 루프가 진짜 탄탄하던데요", "우리 것도 그 정도는 가야죠 💪"],
  ["커피 내렸어요, 한 잔 하실래요? ☕", "감사합니다~ 오늘 유난히 길었네요", "그래도 기획이 착착 붙는 느낌이에요"],
  ["밸런스 표 숫자 보셨어요?", "성장 곡선이 좀 가파르긴 해요", "다음 회의 때 얘기해봐요"],
  ["아트 무드보드 나온 거 봤어요? 🎨", "색감 진짜 좋던데요", "그 톤이면 마케팅도 잘 풀릴 듯"],
  ["점심 뭐 드실 거예요?", "국밥이요. 고민할 힘도 아껴야죠 😄", "저도 따라갈래요"],
  ["QA에서 또 반려 받았어요 😅", "구체성 점수가 원래 짜요", "덕분에 문서가 좋아지긴 하죠"],
  ["신작 트레일러 보셨어요?", "연출은 좋은데 루프가 안 보이더라고요", "우리는 루프부터 보여줘요"],
  ["스트레칭 좀 하고 가요 🙆", "허리가 남아나질 않네요", "의자 탓이라고 해두죠"],
];
const BREAK_LINE_MS = 4200;
/** 걷는 시간 감안 — 도착 후쯤부터 대사 시작 */
const BREAK_WALK_GRACE = 6000;
type BreakInfo = { spot: V3; until: number; startedAt: number; partner?: string; convo?: number; role?: 0 | 1 };

/* ── 신입 환영 연출 — 채용 직후 동료들이 몰려와 축하한다 ── */
const WELCOME_LINES = ["환영합니다! 🎉", "잘 부탁드려요~ 👏", "커피는 휴게실에 있어요 ☕", "드디어 오셨군요! 🙌"];
/** 새 책상 주변 환영 인사 자리 (상대 좌표) */
const WELCOME_SPOTS: [number, number][] = [[-1.7, 0.5], [1.7, 0.5], [-0.9, 1.8], [0.9, 1.8]];
const CONFETTI_COLORS = ["#8b7cf6", "#e879f9", "#34d399", "#fbbf24", "#f87171", "#60a5fa", "#fb923c"];

/** 폭죽 — 책상 위로 색종이가 쏟아진다 (입사 축하·레벨업 공용) */
function Confetti({ pos, label = "🎉 신규 입사를 환영합니다!" }: { pos: V3; label?: string }) {
  const parts = useMemo(
    () =>
      Array.from({ length: 44 }, (_, i) => ({
        x: (Math.random() - 0.5) * 3.4,
        z: (Math.random() - 0.5) * 3,
        y: 2.2 + Math.random() * 3.2,
        speed: 0.9 + Math.random() * 1.3,
        spin: (Math.random() - 0.5) * 9,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      })),
    []
  );
  const refs = useRef<(Group | null)[]>([]);
  useFrame((_, dt) => {
    refs.current.forEach((g, i) => {
      if (!g) return;
      const p = parts[i];
      g.position.y -= p.speed * dt;
      g.rotation.x += p.spin * dt;
      g.rotation.z += p.spin * 0.7 * dt;
      if (g.position.y < 0.05) g.position.y = 2.2 + Math.random() * 3.2; // 다시 위에서
    });
  });
  return (
    <group position={pos}>
      {parts.map((p, i) => (
        <group key={i} ref={(el) => (refs.current[i] = el)} position={[p.x, p.y, p.z]}>
          <mesh>
            <boxGeometry args={[0.09, 0.012, 0.14]} />
            <meshStandardMaterial color={p.color} emissive={p.color} emissiveIntensity={0.35} />
          </mesh>
        </group>
      ))}
      <Html center position={[0, 3.2, 0]} distanceFactor={11} zIndexRange={[30, 0]}>
        <div className="o3d-welcome">{label}</div>
      </Html>
      <pointLight position={[0, 2.4, 0]} intensity={9} color="#ffd98a" distance={7} />
    </group>
  );
}

/** 대기 중 잡담 (샘플의 캐주얼 말풍선 — 연출용 고정 문구, LLM 호출 없음) */
const CHATTER: string[] = [
  "오 안녕하세요 😊",
  "커피 한 잔 하실래요? ☕",
  "어제 그 게임 해보셨어요?",
  "이번 기획 방향 좋던데요",
  "점심 뭐 먹지…",
  "밸런스 표 다시 봐야겠다",
  "레퍼런스 하나 찾았어요 👀",
  "오늘 날씨 좋네요",
  "빌드 잘 돌아가나?",
  "스트레칭 한 번 하고… 🙆",
];

/* ── 테마 팔레트 ─────────────────────────────────────── */
function paletteFor(mode: "day" | "night") {
  if (mode === "night") {
    // "밤이지만 사무실은 또렷하게" — 어두운 하늘/도시 + 충분한 실내광 (가독성 우선)
    return {
      bg: "#151a26", fogNear: 46, fogFar: 92, ambient: 0.68, dir: 0.5, dirColor: "#aabdf5",
      ground: "#232d27", road: "#2b303c", roadLine: "#4a5468", sidewalk: "#313848",
      plate: "#3a4150", plateEdge: "#2b303c",
      building: "#323b4e", buildingB: "#2a3344", winColor: "#ffd98a", winE: 0.9,
      deskTop: "#eef0f4", deskLeg: "#9aa3b5", monitor: "#131826", screenE: 1,
      chair: "#7a7ef0", wood: "#a37f52", glass: "#8fa5cc", glassOp: 0.18,
      tree: "#3a7350", trunk: "#5a4636", zoneLight: 26,
    };
  }
  return {
    bg: "#dfe9f2", fogNear: 46, fogFar: 95, ambient: 0.95, dir: 1.1, dirColor: "#ffffff",
    ground: "#a3bd94", road: "#707786", roadLine: "#e8eaee", sidewalk: "#c9d2da",
    plate: "#eff1f4", plateEdge: "#d7dce3",
    building: "#c9d4e1", buildingB: "#b7c4d4", winColor: "#93a9c0", winE: 0,
    deskTop: "#ffffff", deskLeg: "#c3c9d3", monitor: "#1b2230", screenE: 0.4,
    chair: "#7c7ff2", wood: "#c8a06a", glass: "#a9c0d8", glassOp: 0.22,
    tree: "#5a9a68", trunk: "#7a5c40", zoneLight: 0,
  };
}
type Pal = ReturnType<typeof paletteFor>;

/* ── 카메라 ─────────────────────────────────────────── */
const DEFAULT_CAM = { pos: [17, 15, 20] as V3, tgt: [0, 0, -0.5] as V3 };
const FOCUS: Record<string, { pos: V3; tgt: V3 }> = {
  all: DEFAULT_CAM,
  ceo: { pos: [-11.5, 7.5, -0.5], tgt: [-12.5, 0.6, -8.5] },
  plan: { pos: [-8.5, 8.5, 8.5], tgt: [-8.5, 0.4, 0.5] },
  dev: { pos: [7, 8.5, 8.5], tgt: [7, 0.4, 0.5] },
  biz: { pos: [-9.5, 7, 14.5], tgt: [-9.5, 0.4, 8] },
  art: { pos: [-1.5, 7, 14.5], tgt: [-1.5, 0.4, 8] },
  qa: { pos: [11.75, 7, 14.5], tgt: [11.75, 0.4, 8] },
  meet: { pos: [3.5, 8, -0.5], tgt: [3.5, 0.6, -8.5] },
  lounge: { pos: [13.4, 7.5, -1.4], tgt: [13.4, 0.5, -8.5] },
};

export type CamApi = {
  rotate?: (deg: number) => void;
  pan?: (dx: number, dz: number) => void;
  focus?: (key: string) => void;
  reset?: () => void;
};

type Targets = Record<string, V3>;
const setCursor = (c: string) => {
  document.body.style.cursor = c;
};

/* ── 마네킹 캐릭터 (샘플 스타일: 흰 피규어 + 이름 필) ── */
function Person({
  id,
  targetsRef,
  onSelect,
  selected,
  inMeeting,
  say,
}: {
  id: string;
  targetsRef: React.MutableRefObject<Targets>;
  onSelect: (id: string) => void;
  selected: boolean;
  inMeeting?: boolean;
  say?: string;
}) {
  const a = AGENT_MAP[id];
  const ref = useRef<Group>(null);
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);
  const st = useVE((s) => s.agentStatus[id] ?? "idle");
  const peek = useVE((s) => s.livePeek[id] ?? "");
  const [walking, setWalking] = useState(false);
  const speaking = !!inMeeting && st === "running";
  // 대기 중 잡담 — 가끔 캐주얼 말풍선 (연출용, 6초 표시)
  const [chatter, setChatter] = useState("");
  useEffect(() => {
    const t = setInterval(() => {
      if (Math.random() < 0.055) {
        setChatter(CHATTER[Math.floor(Math.random() * CHATTER.length)]);
        setTimeout(() => setChatter(""), 6000);
      }
    }, 12000);
    return () => clearInterval(t);
  }, []);
  const idleChat = st === "idle" && !inMeeting && !walking ? chatter : "";
  // say = 회의 발언 또는 휴게실 잡담 대사 (짧은 문장 — 앞에서부터 표시)
  const bubbleText = st === "running" && peek ? peek : say ? say : idleChat;

  useFrame((state, dt) => {
    const g = ref.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const target = targetsRef.current[id] ?? homeOf(id);
    const dx = target[0] - g.position.x;
    const dz = target[2] - g.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.08) {
      const speed = Math.min(2.7 * dt, dist);
      g.position.x += (dx / dist) * speed;
      g.position.z += (dz / dist) * speed;
      g.rotation.y = Math.atan2(dx, dz);
      g.position.y = Math.abs(Math.sin(t * 9 + phase)) * 0.08;
      if (!walking) setWalking(true);
    } else {
      g.position.y = st === "running" ? Math.abs(Math.sin(t * 7 + phase)) * 0.05 : Math.sin(t * 1.6 + phase) * 0.02;
      const atMeeting = Math.hypot(g.position.x - MEETING_CENTER[0], g.position.z - MEETING_CENTER[2]) < 3.6;
      const atLounge = Math.hypot(g.position.x - LOUNGE_TABLE[0], g.position.z - LOUNGE_TABLE[2]) < 3.2;
      const face = atMeeting
        ? Math.atan2(MEETING_CENTER[0] - g.position.x, MEETING_CENTER[2] - g.position.z)
        : atLounge
          ? Math.atan2(LOUNGE_TABLE[0] - g.position.x, LOUNGE_TABLE[2] - g.position.z)
          : 0;
      g.rotation.y += (face - g.rotation.y) * Math.min(dt * 6, 1);
      if (walking) setWalking(false);
    }
  });

  const home = homeOf(id);
  const c = a?.color ?? "#8b7cf6";
  const stLabel =
    st === "running" ? (inMeeting ? "회의 중" : "작업 중") : walking ? "이동 중" : st === "done" ? "완료" : st === "error" ? "오류" : "";
  const body = "#f4f5f7";
  return (
    <group
      ref={ref}
      position={home}
      onPointerOver={(e) => {
        e.stopPropagation();
        setCursor("pointer");
      }}
      onPointerOut={() => setCursor("auto")}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(id);
      }}
    >
      {/* 블롭 섀도 */}
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.28, 14]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.22} />
      </mesh>
      {selected && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.3, 0.4, 28]} />
          <meshBasicMaterial color={c} transparent opacity={0.9} />
        </mesh>
      )}
      {speaking && (
        <>
          <mesh position={[0, 0.018, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.42, 0.54, 30]} />
            <meshBasicMaterial color={c} transparent opacity={0.7} />
          </mesh>
          <pointLight position={[0, 1.4, 0.3]} intensity={6} color={c} distance={3} />
        </>
      )}
      {/* 몸통 (흰 마네킹) */}
      <mesh castShadow position={[0, 0.46, 0]}>
        <capsuleGeometry args={[0.2, 0.42, 6, 14]} />
        <meshStandardMaterial color={body} emissive={speaking ? c : "#000000"} emissiveIntensity={speaking ? 0.25 : 0} />
      </mesh>
      {/* 팔 */}
      <mesh position={[-0.26, 0.52, 0]} rotation={[0, 0, 0.18]}>
        <capsuleGeometry args={[0.06, 0.3, 4, 8]} />
        <meshStandardMaterial color={body} />
      </mesh>
      <mesh position={[0.26, 0.52, 0]} rotation={[0, 0, -0.18]}>
        <capsuleGeometry args={[0.06, 0.3, 4, 8]} />
        <meshStandardMaterial color={body} />
      </mesh>
      {/* 머리 (얼굴 없음) */}
      <mesh castShadow position={[0, 1.02, 0]}>
        <sphereGeometry args={[0.19, 20, 16]} />
        <meshStandardMaterial color={body} />
      </mesh>
      {/* 이름 필 */}
      <Html center position={[0, 1.55, 0]} distanceFactor={12} zIndexRange={[10, 0]}>
        <div className="o3d-pill" onClick={() => onSelect(id)}>
          <span className="o3d-dot" style={{ background: c }} />
          {a?.rank === "manager" && <span className="o3d-pill-rank">🎖️팀장</span>}
          {a?.rank === "junior" && <span className="o3d-pill-rank jr">🌱</span>}
          {a?.rank === "intern" && <span className="o3d-pill-rank jr">🐣</span>}
          {a?.name}
          {stLabel && <span className="o3d-pill-st">· {stLabel}</span>}
        </div>
      </Html>
      {/* 라이브 세션 창 (선택된 작업 중 에이전트 — 샘플의 맥 스타일 창) */}
      {selected && st === "running" && (
        <Html center position={[0, 2.9, 0]} distanceFactor={9} zIndexRange={[40, 0]}>
          <div className="o3d-session">
            <div className="o3d-session-head">
              <i className="tl r" />
              <i className="tl y" />
              <i className="tl g" />
              <span>{a?.name} — 라이브 세션</span>
            </div>
            <div className="o3d-session-body">{peek ? `…${peek.replace(/[#*>`]/g, "").slice(-220)}` : "작업을 시작하는 중…"}</div>
          </div>
        </Html>
      )}
      {/* 말풍선 (흰색) */}
      {bubbleText && !walking && (
        <Html center position={[0, 2.15, 0]} distanceFactor={11} zIndexRange={[20, 0]}>
          <div className={`o3d-bubble ${speaking ? "speaking" : ""}`}>
            {bubbleText.replace(/[#*>`]/g, "").replace(/\s+/g, " ").slice(say && !peek ? 0 : -46).slice(0, 64)}
          </div>
        </Html>
      )}
    </group>
  );
}

/* ── 사무실 관리인 — 플레이트를 순찰하다 대화가 쌓이면 정리한다 ── */
const JANITOR_PATH: [number, number][] = [
  [-1.5, 1.2], [5.5, 5.5], [13, 5], [8, -4.2], [-1.5, -4.6], [-9, -4.4], [-15, 4], [-6, 5.5],
];
function Janitor() {
  const ref = useRef<Group>(null);
  const wp = useRef(0);
  const busy = useVE((s) => s.janitorBusy);
  useFrame((state, dt) => {
    const g = ref.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const [tx, tz] = JANITOR_PATH[wp.current];
    const dx = tx - g.position.x;
    const dz = tz - g.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.15) {
      wp.current = (wp.current + 1) % JANITOR_PATH.length;
    } else {
      const speed = Math.min((busy ? 2.4 : 0.85) * dt, dist);
      g.position.x += (dx / dist) * speed;
      g.position.z += (dz / dist) * speed;
      g.rotation.y = Math.atan2(dx, dz);
    }
    g.position.y = Math.abs(Math.sin(t * (busy ? 9 : 5))) * 0.05;
  });
  const grey = "#c9ced8";
  return (
    <group ref={ref} position={[JANITOR_PATH[0][0], 0, JANITOR_PATH[0][1]]}>
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.26, 12]} />
        <meshBasicMaterial color="#000" transparent opacity={0.18} />
      </mesh>
      <mesh position={[0, 0.42, 0]}>
        <capsuleGeometry args={[0.18, 0.36, 6, 12]} />
        <meshStandardMaterial color={grey} />
      </mesh>
      <mesh position={[0, 0.94, 0]}>
        <sphereGeometry args={[0.165, 18, 14]} />
        <meshStandardMaterial color={grey} />
      </mesh>
      {/* 빗자루 */}
      <group position={[0.26, 0, 0.12]} rotation={[0.18, 0, -0.2]}>
        <mesh position={[0, 0.55, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 1.05, 6]} />
          <meshStandardMaterial color="#8a6a44" />
        </mesh>
        <mesh position={[0, 0.06, 0]}>
          <coneGeometry args={[0.09, 0.2, 8]} />
          <meshStandardMaterial color="#d9b06a" />
        </mesh>
      </group>
      <Html center position={[0, 1.42, 0]} distanceFactor={12} zIndexRange={[8, 0]}>
        <div className="o3d-pill">
          <span className="o3d-dot" style={{ background: "#9aa5b5" }} />
          🧹 관리인{busy && <span className="o3d-pill-st">· 정리 중</span>}
        </div>
      </Html>
      {busy && (
        <Html center position={[0, 2, 0]} distanceFactor={11} zIndexRange={[20, 0]}>
          <div className="o3d-bubble">대화가 길어져서 요약해 정리하고 있어요 🧹</div>
        </Html>
      )}
    </group>
  );
}

/* ── 인턴 빈자리 — 클릭하면 해당 인턴 스튜디오가 열린다 ── */
function InternSeat({ pos, label, emoji, dot, onOpen }: { pos: V3; label: string; emoji: string; dot: string; onOpen?: () => void }) {
  return (
    <group position={pos}>
      <Html center position={[0, 1.25, 0]} distanceFactor={13} zIndexRange={[9, 0]}>
        <div
          className="o3d-pill intern"
          onClick={(e) => {
            e.stopPropagation();
            onOpen?.();
          }}
          title="빈 자리 — 클릭하면 인턴에게 작업을 맡깁니다"
        >
          <span className="o3d-dot" style={{ background: dot }} />
          {emoji} {label} · 빈 자리
        </div>
      </Html>
    </group>
  );
}

/* ── 가구 ───────────────────────────────────────────── */
function Desk({ pos, P, seed }: { pos: V3; P: Pal; seed: number }) {
  return (
    <group position={pos}>
      <mesh castShadow position={[0, 0.44, 0]}>
        <boxGeometry args={[1.5, 0.06, 0.8]} />
        <meshStandardMaterial color={P.deskTop} />
      </mesh>
      {[-0.62, 0.62].map((x) => (
        <mesh key={x} position={[x, 0.21, 0]}>
          <boxGeometry args={[0.06, 0.42, 0.62]} />
          <meshStandardMaterial color={P.deskLeg} />
        </mesh>
      ))}
      {/* 모니터 — 캐릭터(-z) 쪽을 본다 */}
      <mesh castShadow position={[0, 0.74, 0.12]} rotation={[0, Math.PI, 0]}>
        <boxGeometry args={[0.56, 0.34, 0.04]} />
        <meshStandardMaterial color={P.monitor} emissive="#3b57a8" emissiveIntensity={P.screenE} />
      </mesh>
      <mesh position={[0, 0.52, 0.12]}>
        <boxGeometry args={[0.07, 0.1, 0.04]} />
        <meshStandardMaterial color={P.deskLeg} />
      </mesh>
      {/* 태스크 체어 (보라) */}
      <group position={[0, 0, -0.72]}>
        <mesh position={[0, 0.3, 0]}>
          <boxGeometry args={[0.42, 0.07, 0.42]} />
          <meshStandardMaterial color={P.chair} />
        </mesh>
        <mesh position={[0, 0.5, -0.19]}>
          <boxGeometry args={[0.42, 0.42, 0.06]} />
          <meshStandardMaterial color={P.chair} />
        </mesh>
        <mesh position={[0, 0.14, 0]}>
          <cylinderGeometry args={[0.035, 0.035, 0.3, 8]} />
          <meshStandardMaterial color="#3a4150" />
        </mesh>
      </group>
      {/* 소품 */}
      {seed % 3 === 0 && (
        <mesh position={[0.5, 0.51, -0.1]}>
          <cylinderGeometry args={[0.05, 0.04, 0.08, 10]} />
          <meshStandardMaterial color={seed % 2 ? "#d9822b" : "#e8e2d6"} />
        </mesh>
      )}
      {seed % 4 === 1 && (
        <mesh position={[-0.45, 0.485, -0.05]} rotation={[0, (seed % 7) * 0.25, 0]}>
          <boxGeometry args={[0.24, 0.015, 0.3]} />
          <meshStandardMaterial color="#dfe4ea" />
        </mesh>
      )}
    </group>
  );
}

function Plant({ pos, s = 1, P }: { pos: V3; s?: number; P: Pal }) {
  return (
    <group position={pos} scale={s}>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.2, 0.26, 0.4, 10]} />
        <meshStandardMaterial color="#9a6b45" />
      </mesh>
      <mesh position={[0, 0.62, 0]}>
        <sphereGeometry args={[0.32, 12, 10]} />
        <meshStandardMaterial color={P.tree} />
      </mesh>
    </group>
  );
}

/** 지표 대시보드 스탠드 (샘플의 보라 바 차트 스크린) */
function DashboardStand({ pos, P, bars = [0.5, 0.9, 0.65, 1.1, 0.8] }: { pos: V3; P: Pal; bars?: number[] }) {
  return (
    <group position={pos}>
      <mesh position={[0, 0.55, 0]}>
        <boxGeometry args={[0.1, 1.1, 0.1]} />
        <meshStandardMaterial color="#3a4150" />
      </mesh>
      <mesh position={[0, 1.5, 0]}>
        <boxGeometry args={[2.3, 1.3, 0.08]} />
        <meshStandardMaterial color="#141826" emissive="#1c2338" emissiveIntensity={0.6} />
      </mesh>
      {bars.map((h, i) => (
        <mesh key={i} position={[-0.8 + i * 0.4, 1.1 + h / 2, 0.05]}>
          <boxGeometry args={[0.22, h, 0.02]} />
          <meshStandardMaterial color="#8b7cf6" emissive="#8b7cf6" emissiveIntensity={0.5} />
        </mesh>
      ))}
    </group>
  );
}

/** 유리 벽 */
function Glass({ pos, size, P }: { pos: V3; size: V3; P: Pal }) {
  return (
    <mesh position={pos}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={P.glass} transparent opacity={P.glassOp} metalness={0.25} roughness={0.1} />
    </mesh>
  );
}

/* ── 존 러그 + 라벨 ─────────────────────────────────── */
function ZoneRug({ z, P, night }: { z: ZoneDef; P: Pal; night: boolean }) {
  const [cx, cz, w, d] = z.rug;
  return (
    <group>
      <mesh receiveShadow position={[cx, 0.012, cz]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={night ? z.rugNight : z.rugDay} />
      </mesh>
      <Html center position={[cx, 2.5, cz - d / 2 + 0.4]} distanceFactor={15} zIndexRange={[5, 0]}>
        <div className="o3d-zone">
          <span className="o3d-dot" style={{ background: z.dot }} />
          {z.label}
        </div>
      </Html>
      {night && <pointLight position={[cx, 3.4, cz]} intensity={P.zoneLight} color="#ffe2b8" distance={Math.max(w, d) + 3} />}
    </group>
  );
}

/* ── 대표실 (PM 전용 방 — 찾아오는 느낌) ─────────────── */
function CeoRoom({ P }: { P: Pal }) {
  const [cx, cz] = [-12.5, -8.5];
  return (
    <group>
      {/* 뒷벽 + 옆벽 */}
      <mesh position={[cx, 1.1, cz - 3.1]}>
        <boxGeometry args={[8, 2.2, 0.18]} />
        <meshStandardMaterial color="#2b3040" />
      </mesh>
      <mesh position={[cx - 4, 1.1, cz]}>
        <boxGeometry args={[0.18, 2.2, 6.3]} />
        <meshStandardMaterial color="#2b3040" />
      </mesh>
      {/* 앞 유리 (문 비움) */}
      <Glass pos={[cx - 2.2, 0.9, cz + 3.15]} size={[3.2, 1.8, 0.1]} P={P} />
      <Glass pos={[cx + 2.6, 0.9, cz + 3.15]} size={[2.6, 1.8, 0.1]} P={P} />
      <Glass pos={[cx + 3.95, 0.9, cz + 1]} size={[0.1, 1.8, 4.2]} P={P} />
      {/* 임원 책상 (wood) + 러그 소파 + 스탠드 */}
      <mesh position={[cx, 0.44, cz - 1.1]}>
        <boxGeometry args={[2.1, 0.08, 0.9]} />
        <meshStandardMaterial color={P.wood} />
      </mesh>
      <mesh position={[cx, 0.74, cz - 1]} rotation={[0, Math.PI, 0]}>
        <boxGeometry args={[0.56, 0.34, 0.04]} />
        <meshStandardMaterial color={P.monitor} emissive="#3b57a8" emissiveIntensity={P.screenE} />
      </mesh>
      <mesh position={[cx + 2.6, 0.32, cz + 1.4]}>
        <boxGeometry args={[1.5, 0.5, 0.7]} />
        <meshStandardMaterial color="#4a5068" />
      </mesh>
      <group position={[cx - 3.1, 0, cz + 1.8]}>
        <mesh position={[0, 0.7, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 1.4, 6]} />
          <meshStandardMaterial color="#5a6274" />
        </mesh>
        <mesh position={[0, 1.42, 0]}>
          <coneGeometry args={[0.22, 0.24, 12, 1, true]} />
          <meshStandardMaterial color="#e8b96a" emissive="#ffd98a" emissiveIntensity={0.8} />
        </mesh>
        <pointLight position={[0, 1.3, 0]} intensity={5} color="#ffe2b0" distance={4} />
      </group>
      <Plant pos={[cx + 3.2, 0, cz - 2.3]} s={1.1} P={P} />
    </group>
  );
}

/* ── 회의실 (유리방 + 우드 테이블) ───────────────────── */
function MeetingRoom({ P, active }: { P: Pal; active: boolean }) {
  const meetingMembers = useVE((s) => s.meetingMembers);
  const agentStatus = useVE((s) => s.agentStatus);
  const speakerId = meetingMembers.find((id) => agentStatus[id] === "running");
  const speaker = speakerId ? AGENT_MAP[speakerId] : null;
  const [cx, cz] = [MEETING_CENTER[0], MEETING_CENTER[2]];
  return (
    <group>
      {/* 유리 벽 (앞쪽 문 비움) */}
      <Glass pos={[cx, 0.9, cz - 3.15]} size={[9.2, 1.8, 0.1]} P={P} />
      <Glass pos={[cx - 4.65, 0.9, cz]} size={[0.1, 1.8, 6.3]} P={P} />
      <Glass pos={[cx + 4.65, 0.9, cz]} size={[0.1, 1.8, 6.3]} P={P} />
      <Glass pos={[cx - 3.1, 0.9, cz + 3.15]} size={[3, 1.8, 0.1]} P={P} />
      <Glass pos={[cx + 3.1, 0.9, cz + 3.15]} size={[3, 1.8, 0.1]} P={P} />
      {/* 우드 테이블 */}
      <mesh castShadow position={[cx, 0.44, cz]}>
        <boxGeometry args={[5.4, 0.09, 1.7]} />
        <meshStandardMaterial color={P.wood} />
      </mesh>
      {[-2.2, 2.2].map((dx) => (
        <mesh key={dx} position={[cx + dx, 0.22, cz]}>
          <boxGeometry args={[0.12, 0.44, 1.3]} />
          <meshStandardMaterial color="#8a6a44" />
        </mesh>
      ))}
      {/* 스크린 (회의 중 발광) */}
      <group position={[cx, 1.35, cz - 3.05]}>
        <mesh>
          <boxGeometry args={[3.2, 1.5, 0.06]} />
          <meshStandardMaterial
            color={active ? "#232c4e" : "#161b28"}
            emissive={active ? "#3f57b0" : "#1d2740"}
            emissiveIntensity={active ? 0.9 : 0.4}
          />
        </mesh>
        {[0.35, 0, -0.35].map((y, k) => (
          <mesh key={y} position={[-0.2 + (k % 2) * 0.2, y, 0.04]}>
            <planeGeometry args={[2 - (k % 3) * 0.45, 0.09]} />
            <meshStandardMaterial color={active ? "#aab6e6" : "#4a5470"} />
          </mesh>
        ))}
      </group>
      {/* 의자 8 */}
      {MEET_SEATS.map(([dx, dz], i) => (
        <group key={i} position={[cx + dx, 0, cz + dz * 0.62]}>
          <mesh position={[0, 0.27, 0]}>
            <boxGeometry args={[0.38, 0.06, 0.38]} />
            <meshStandardMaterial color={P.chair} />
          </mesh>
          <mesh position={[0, 0.13, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 0.26, 8]} />
            <meshStandardMaterial color="#3a4150" />
          </mesh>
        </group>
      ))}
      {/* 펜던트 조명 */}
      <mesh position={[cx, 2.6, cz]}>
        <cylinderGeometry args={[0.45, 0.56, 0.14, 20]} />
        <meshStandardMaterial color="#3a4150" emissive="#ffe6a8" emissiveIntensity={active ? 0.8 : 0.3} />
      </mesh>
      <pointLight position={[cx, 2.4, cz]} intensity={active ? 15 : 7} color="#ffe9c4" distance={9} />
      {active && speaker && (
        <Html center position={[cx, 2.35, cz - 2.9]} distanceFactor={13}>
          <div className="o3d-speaker-cap" style={{ borderColor: `${speaker.color}aa` }}>
            🗣 {speaker.emoji} {speaker.name} 발언 중
          </div>
        </Html>
      )}
    </group>
  );
}

/* ── 휴게실 (소파·커피머신·자판기·정수기 — 대기 직원들의 잡담 공간) ── */
function Sofa({ pos, facing, color }: { pos: V3; facing: 1 | -1; color: string }) {
  // facing 1 = +z(테이블) 방향으로 앉는다 → 등받이는 -z 쪽
  return (
    <group position={pos}>
      <mesh castShadow position={[0, 0.26, 0]}>
        <boxGeometry args={[3.3, 0.34, 0.95]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh castShadow position={[0, 0.62, -0.4 * facing]}>
        <boxGeometry args={[3.3, 0.55, 0.2]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {[-1.68, 1.68].map((x) => (
        <mesh key={x} position={[x, 0.42, 0]}>
          <boxGeometry args={[0.18, 0.5, 0.95]} />
          <meshStandardMaterial color={color} />
        </mesh>
      ))}
      {/* 쿠션 */}
      {[-0.9, 0.9].map((x) => (
        <mesh key={`c${x}`} position={[x, 0.48, -0.3 * facing]} rotation={[0.25 * facing, 0, 0]}>
          <boxGeometry args={[0.45, 0.4, 0.14]} />
          <meshStandardMaterial color="#f2e2c4" />
        </mesh>
      ))}
    </group>
  );
}

function Lounge({ P, night }: { P: Pal; night: boolean }) {
  const [cx, cz] = [LOUNGE_TABLE[0], LOUNGE_TABLE[2]];
  return (
    <group>
      {/* 원형 러그 + 마주 보는 소파 2 + 커피 테이블 */}
      <mesh position={[cx, 0.016, cz]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.7, 28]} />
        <meshStandardMaterial color={night ? "#5a4a36" : "#eddcc2"} />
      </mesh>
      <Sofa pos={[cx, 0, cz - 2.15]} facing={1} color="#e0955a" />
      <Sofa pos={[cx, 0, cz + 2.15]} facing={-1} color="#e0955a" />
      <group position={[cx, 0, cz]}>
        <mesh castShadow position={[0, 0.34, 0]}>
          <boxGeometry args={[1.5, 0.07, 0.8]} />
          <meshStandardMaterial color={P.wood} />
        </mesh>
        {[[-0.6, -0.28], [0.6, -0.28], [-0.6, 0.28], [0.6, 0.28]].map(([x, z], i) => (
          <mesh key={i} position={[x, 0.17, z]}>
            <cylinderGeometry args={[0.03, 0.03, 0.34, 6]} />
            <meshStandardMaterial color="#8a6a44" />
          </mesh>
        ))}
        {/* 머그 2개 */}
        <mesh position={[-0.3, 0.42, 0.1]}>
          <cylinderGeometry args={[0.05, 0.04, 0.09, 10]} />
          <meshStandardMaterial color="#d9822b" />
        </mesh>
        <mesh position={[0.35, 0.42, -0.12]}>
          <cylinderGeometry args={[0.05, 0.04, 0.09, 10]} />
          <meshStandardMaterial color="#7c9cd6" />
        </mesh>
      </group>
      {/* 커피 카운터 + 머신 (우하단) */}
      <group position={[16.9, 0, -10.3]}>
        <mesh castShadow position={[0, 0.45, 0]}>
          <boxGeometry args={[1.5, 0.9, 0.95]} />
          <meshStandardMaterial color="#3f4656" />
        </mesh>
        <mesh position={[-0.3, 1.13, 0]}>
          <boxGeometry args={[0.45, 0.46, 0.45]} />
          <meshStandardMaterial color="#22262f" emissive="#ff9c4a" emissiveIntensity={0.25} />
        </mesh>
        <mesh position={[0.4, 0.95, 0.1]}>
          <cylinderGeometry args={[0.05, 0.04, 0.1, 10]} />
          <meshStandardMaterial color="#e8e2d6" />
        </mesh>
        <pointLight position={[0, 1.6, 0.4]} intensity={night ? 4 : 1} color="#ffd9a8" distance={4} />
      </group>
      {/* 자판기 (우상단) — 밤에 발광 */}
      <group position={[17.15, 0, -6.5]}>
        <mesh castShadow position={[0, 1, 0]}>
          <boxGeometry args={[0.95, 2, 0.8]} />
          <meshStandardMaterial color="#c8455a" />
        </mesh>
        <mesh position={[-0.1, 1.25, -0.41]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[0.55, 1.15]} />
          <meshStandardMaterial color="#eaf2ff" emissive="#bcd6ff" emissiveIntensity={night ? 0.9 : 0.25} />
        </mesh>
        <mesh position={[0.32, 0.65, -0.41]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[0.18, 0.3]} />
          <meshStandardMaterial color="#20242c" />
        </mesh>
      </group>
      {/* 정수기 (좌하단) */}
      <group position={[9.5, 0, -10.9]}>
        <mesh position={[0, 0.5, 0]}>
          <boxGeometry args={[0.42, 1, 0.42]} />
          <meshStandardMaterial color="#e8ecf2" />
        </mesh>
        <mesh position={[0, 1.22, 0]}>
          <cylinderGeometry args={[0.16, 0.19, 0.42, 12]} />
          <meshStandardMaterial color="#7cb8e8" transparent opacity={0.75} />
        </mesh>
      </group>
      {/* 책꽂이 + 화분 + 스탠딩 사인 */}
      <group position={[17.3, 0, -8.4]}>
        <mesh castShadow position={[0, 0.8, 0]}>
          <boxGeometry args={[0.35, 1.6, 1.5]} />
          <meshStandardMaterial color="#8a6a44" />
        </mesh>
        {[0.45, 0.95, 1.35].map((y, r) =>
          [-0.45, -0.1, 0.28].map((z, i) => (
            <mesh key={`${r}-${i}`} position={[-0.05, y, z]}>
              <boxGeometry args={[0.22, 0.3, 0.22]} />
              <meshStandardMaterial color={["#d9822b", "#7c9cd6", "#5aa06a", "#c8455a"][(r + i) % 4]} />
            </mesh>
          ))
        )}
      </group>
      <Plant pos={[9.4, 0, -6.1]} s={1.15} P={P} />
      <pointLight position={[cx, 2.6, cz]} intensity={night ? 10 : 3} color="#ffdfb0" distance={8} />
    </group>
  );
}

/* ── 도시 (플레이트 밖) ─────────────────────────────── */
const BUILDINGS: [number, number, number, number, number][] = [
  // x, z, w(d), h, variant
  [-32, -18, 7, 13, 0],
  [-34, 2, 6, 18, 1],
  [-30, 22, 8, 9, 0],
  [31, -16, 7, 15, 1],
  [33, 6, 6, 10, 0],
  [29, 24, 8, 13, 1],
  [-8, -30, 9, 20, 0],
  [12, -32, 7, 12, 1],
  [-2, 32, 8, 11, 0],
  [18, 30, 6, 16, 1],
];
function Building({ x, z, w, h, v, P, seed }: { x: number; z: number; w: number; h: number; v: number; P: Pal; seed: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, h / 2 - 0.3, 0]}>
        <boxGeometry args={[w, h, w]} />
        <meshStandardMaterial color={v ? P.buildingB : P.building} />
      </mesh>
      {/* 창문 스트립 (전면/측면 3열) */}
      {[0, 1].map((face) =>
        [-w * 0.26, 0, w * 0.26].map((off, i) => (
          <mesh
            key={`${face}-${i}`}
            position={face ? [off, h / 2 - 0.3, w / 2 + 0.02] : [w / 2 + 0.02, h / 2 - 0.3, off]}
            rotation={face ? [0, 0, 0] : [0, Math.PI / 2, 0]}
          >
            <planeGeometry args={[w * 0.16, h * 0.82]} />
            <meshStandardMaterial
              color={P.winColor}
              emissive={P.winColor}
              emissiveIntensity={P.winE * ((seed + i + face) % 3 === 0 ? 0.25 : 1)}
            />
          </mesh>
        ))
      )}
    </group>
  );
}

function Tree({ pos, s = 1, P }: { pos: V3; s?: number; P: Pal }) {
  return (
    <group position={pos} scale={s}>
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.09, 0.13, 1, 6]} />
        <meshStandardMaterial color={P.trunk} />
      </mesh>
      <mesh position={[0, 1.25, 0]}>
        <sphereGeometry args={[0.62, 10, 8]} />
        <meshStandardMaterial color={P.tree} />
      </mesh>
    </group>
  );
}

function Car({ z, color, P }: { z: number; color: string; P: Pal }) {
  const ref = useRef<Group>(null);
  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    g.position.x = ((t * 4 + z * 7) % 76) - 38;
  });
  return (
    <group ref={ref} position={[0, 0, z]}>
      <mesh position={[0, 0.32, 0]}>
        <boxGeometry args={[1.5, 0.4, 0.75]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0.1, 0.62, 0]}>
        <boxGeometry args={[0.8, 0.32, 0.65]} />
        <meshStandardMaterial color="#d8e2ec" />
      </mesh>
      {[-0.5, 0.5].map((x) => (
        <mesh key={x} position={[x, 0.14, 0.3]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.14, 0.14, 0.66, 10]} />
          <meshStandardMaterial color="#20242c" />
        </mesh>
      ))}
      {P.winE > 0 && <pointLight position={[0.8, 0.35, 0]} intensity={2.5} color="#ffe9b0" distance={3} />}
    </group>
  );
}

function City({ P }: { P: Pal }) {
  return (
    <group>
      {/* 지면 */}
      <mesh position={[0, -0.34, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[220, 220]} />
        <meshStandardMaterial color={P.ground} />
      </mesh>
      {/* 도로 (가로 z=17.5 / 세로 x=-23) */}
      <mesh position={[0, -0.3, 17.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[220, 4]} />
        <meshStandardMaterial color={P.road} />
      </mesh>
      <mesh position={[-23, -0.3, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[4, 220]} />
        <meshStandardMaterial color={P.road} />
      </mesh>
      {/* 중앙선 */}
      {Array.from({ length: 16 }, (_, i) => (
        <mesh key={i} position={[-36 + i * 4.8, -0.29, 17.5]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1.6, 0.16]} />
          <meshStandardMaterial color={P.roadLine} />
        </mesh>
      ))}
      {/* 인도 (플레이트 둘레) */}
      <mesh position={[0, -0.315, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[42, 32]} />
        <meshStandardMaterial color={P.sidewalk} />
      </mesh>
      {/* 빌딩 + 나무 + 차 */}
      {BUILDINGS.map(([x, z, w, h, v], i) => (
        <Building key={i} x={x} z={z} w={w} h={h} v={v} P={P} seed={i} />
      ))}
      {(
        [
          [-20, -8], [-20, 8], [20, -6], [21, 10], [-14, 15.2], [8, 15.2], [16, 15.2], [-6, -15.5], [10, -15.5], [24, 2],
        ] as [number, number][]
      ).map(([x, z], i) => (
        <Tree key={i} pos={[x, -0.32, z]} s={0.9 + (i % 3) * 0.25} P={P} />
      ))}
      <Car z={16.6} color="#e05a5a" P={P} />
      <Car z={18.4} color="#3d6fb4" P={P} />
    </group>
  );
}

/* ── 오피스 플레이트 ────────────────────────────────── */
function Plate({ P, night }: { P: Pal; night: boolean }) {
  return (
    <group>
      <mesh receiveShadow position={[0, -0.15, 0]}>
        <boxGeometry args={[37, 0.3, 27]} />
        <meshStandardMaterial color={P.plate} />
      </mesh>
      <mesh position={[0, -0.31, 0]}>
        <boxGeometry args={[37.8, 0.3, 27.8]} />
        <meshStandardMaterial color={P.plateEdge} />
      </mesh>
      {ZONES.map((z) => (
        <ZoneRug key={z.id} z={z} P={P} night={night} />
      ))}
      {/* 센터 플랜터 + 사인 */}
      <group position={[-1.5, 0, 3.8]}>
        <mesh position={[0, 0.22, 0]}>
          <cylinderGeometry args={[1, 1.15, 0.44, 24]} />
          <meshStandardMaterial color="#aab3bf" />
        </mesh>
        <Tree pos={[0, 0.3, 0]} s={1.15} P={P} />
      </group>
      <group position={[-1.5, 0, -3.4]}>
        <mesh position={[0, 0.5, 0]}>
          <boxGeometry args={[2.6, 1, 0.4]} />
          <meshStandardMaterial color="#1c212d" />
        </mesh>
        <Html center position={[0, 0.55, 0.26]} distanceFactor={11}>
          <div className="o3d-sign">VISION ENGINE</div>
        </Html>
      </group>
      {/* 지표 대시보드 스탠드 */}
      <DashboardStand pos={[-5, 0, -4.8]} P={P} />
      <DashboardStand pos={[9.5, 0, -4.8]} P={P} bars={[0.9, 0.6, 1.1, 0.7, 1.2]} />
      {/* 화분 포인트 */}
      <Plant pos={[-16.8, 0, 3.5]} s={1.2} P={P} />
      <Plant pos={[16.8, 0, -3]} s={1.1} P={P} />
      <Plant pos={[16.8, 0, 11]} s={1} P={P} />
      <Plant pos={[-4.6, 0, 11]} s={0.9} P={P} />
    </group>
  );
}

/* ── 카메라 리그 ────────────────────────────────────── */
function CameraRig({ camApi }: { camApi: React.MutableRefObject<CamApi> }) {
  const controls = useRef<any>(null);
  const goal = useRef<{ pos: Vector3; tgt: Vector3 } | null>(null);
  const { camera } = useThree();

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c || !goal.current) return;
    const k = Math.min(dt * 3.4, 1);
    camera.position.lerp(goal.current.pos, k);
    c.target.lerp(goal.current.tgt, k);
    c.update();
    if (camera.position.distanceTo(goal.current.pos) < 0.06 && c.target.distanceTo(goal.current.tgt) < 0.06) {
      goal.current = null;
    }
  });

  useEffect(() => {
    const setGoal = (pos: V3, tgt: V3) => {
      goal.current = { pos: new Vector3(...pos), tgt: new Vector3(...tgt) };
    };
    camApi.current = {
      rotate: (deg) => {
        const c = controls.current;
        if (!c) return;
        const t = c.target;
        const p = camera.position;
        const a = (deg * Math.PI) / 180;
        const dx = p.x - t.x;
        const dz = p.z - t.z;
        setGoal(
          [t.x + dx * Math.cos(a) - dz * Math.sin(a), p.y, t.z + dx * Math.sin(a) + dz * Math.cos(a)],
          [t.x, t.y, t.z]
        );
      },
      pan: (dx, dz) => {
        const c = controls.current;
        if (!c) return;
        const p = camera.position;
        const t = c.target;
        let fx = t.x - p.x;
        let fz = t.z - p.z;
        const fl = Math.hypot(fx, fz) || 1;
        fx /= fl;
        fz /= fl;
        const mx = -fz * dx + fx * dz;
        const mz = fx * dx + fz * dz;
        setGoal([p.x + mx, p.y, p.z + mz], [t.x + mx, t.y, t.z + mz]);
      },
      focus: (key) => {
        const v = FOCUS[key];
        if (v) setGoal(v.pos, v.tgt);
      },
      reset: () => setGoal(DEFAULT_CAM.pos, DEFAULT_CAM.tgt),
    };
    if (import.meta.env.DEV) (window as any).__veCam = camApi.current;
  }, [camera, camApi]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={DEFAULT_CAM.tgt}
      minDistance={6}
      maxDistance={55}
      maxPolarAngle={Math.PI / 2.15}
      enablePan
      screenSpacePanning
      enableDamping
    />
  );
}

/* ── 씬 ─────────────────────────────────────────────── */
function OfficeScene({
  onSelect,
  selId,
  camApi,
  mode,
  onArtIntern,
  onProtoIntern,
}: {
  onSelect: (id: string) => void;
  selId: string | null;
  camApi: React.MutableRefObject<CamApi>;
  mode: "day" | "night";
  onArtIntern?: () => void;
  onProtoIntern?: () => void;
}) {
  // selector 구독 — 무관한 store 변경(헬스 폴링 등)으로 씬 전체가 리렌더되지 않게
  const feed = useVE((s) => s.feed);
  const meetingMembers = useVE((s) => s.meetingMembers);
  const welcomeAgent = useVE((s) => s.welcomeAgent);
  const levelUpAgent = useVE((s) => s.levelUpAgent);
  useVE((s) => s.rosterVersion); // 채용/퇴사 시 로스터 다시 그리기
  const P = useMemo(() => paletteFor(mode), [mode]);
  const night = mode === "night";
  const targetsRef = useRef<Targets>({});
  const breaksRef = useRef<Record<string, BreakInfo>>({});
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1500);
    return () => clearInterval(t);
  }, []);

  // 휴게실 스케줄러 — 한가한 직원을 가끔 소파(2인 잡담)나 커피머신 앞으로 보낸다
  useEffect(() => {
    const t = setInterval(() => {
      const s = useVE.getState();
      const br = breaksRef.current;
      const nowMs = Date.now();
      // 만료·업무 복귀 정리 (한쪽이 일하러 가면 파트너도 함께 복귀)
      for (const id of Object.keys(br)) {
        const busy = (s.agentStatus[id] ?? "idle") === "running" || s.meetingMembers.includes(id);
        if (br[id].until < nowMs || busy) {
          const p = br[id].partner;
          delete br[id];
          if (p && br[p]) delete br[p];
        }
      }
      if (s.orchRunning) return; // 회의 진행 중엔 놀러 가지 않는다
      const onBreak = Object.keys(br);
      if (onBreak.length >= 5 || Math.random() > 0.55) return;
      const idle = AGENTS.map((a) => a.id).filter(
        (id) => (s.agentStatus[id] ?? "idle") === "idle" && !s.meetingMembers.includes(id) && !br[id]
      );
      if (idle.length === 0) return;
      const pick = () => idle.splice(Math.floor(Math.random() * idle.length), 1)[0];
      const usedSpots = new Set(onBreak.map((id) => br[id].spot.join(",")));
      if (idle.length >= 2 && Math.random() < 0.62) {
        // 둘이 소파에 마주 앉아 잡담
        const pair = LOUNGE_PAIRS.find(
          ([a, b]) => !usedSpots.has(seatV3(a).join(",")) && !usedSpots.has(seatV3(b).join(","))
        );
        if (!pair) return;
        const a = pick();
        const b = pick();
        const convo = Math.floor(Math.random() * CONVOS.length);
        const until = nowMs + BREAK_WALK_GRACE + CONVOS[convo].length * BREAK_LINE_MS + 5000;
        br[a] = { spot: seatV3(pair[0]), until, startedAt: nowMs, partner: b, convo, role: 0 };
        br[b] = { spot: seatV3(pair[1]), until, startedAt: nowMs, partner: a, convo, role: 1 };
      } else {
        // 혼자 커피·자판기·정수기
        const free = LOUNGE_STANDS.map(([x, z]) => [x, 0, z] as V3).filter((v) => !usedSpots.has(v.join(",")));
        if (free.length === 0) return;
        br[pick()] = {
          spot: free[Math.floor(Math.random() * free.length)],
          until: nowMs + 13000 + Math.random() * 10000,
          startedAt: nowMs,
        };
      }
    }, 5000);
    return () => clearInterval(t);
  }, []);

  // 이동 목표 — 회의 > 보고 > PM 방문 > 자리
  const now = Date.now();
  let lastPmVisit: FeedMsg | undefined;
  const lastReport: Record<string, FeedMsg> = {};
  for (const m of feed) {
    if (m.from === "pm" && m.to && (m.kind === "instruction" || m.kind === "status")) lastPmVisit = m;
    if (m.to === "pm" && m.from && (m.kind === "draft" || m.kind === "revision" || m.kind === "summary")) lastReport[m.from] = m;
  }
  const meetingSay: Record<string, string> = {};
  if (meetingMembers.length > 0) {
    for (const m of feed) {
      if (m.from && meetingMembers.includes(m.from) && ["talk", "summary", "draft", "revision", "review"].includes(m.kind))
        meetingSay[m.from] = m.text;
    }
  }
  // 휴게실 잡담 대사 — 마주 앉은 둘이 번갈아 말한다 (걷는 시간만큼 지연 후 시작)
  const breakSay: Record<string, string> = {};
  for (const [id, b] of Object.entries(breaksRef.current)) {
    if (b.partner && b.convo !== undefined) {
      const li = Math.floor((now - b.startedAt - BREAK_WALK_GRACE) / BREAK_LINE_MS);
      const lines = CONVOS[b.convo];
      if (li >= 0 && li < lines.length && li % 2 === (b.role ?? 0)) breakSay[id] = lines[li];
    }
  }
  // 신입 환영 — 같은 부서 동료(부족하면 아무나) 최대 4명이 새 책상 앞으로 모여 인사한다
  let greeters: string[] = [];
  const welcomeSay: Record<string, string> = {};
  let welcomeDesk: V3 | null = null;
  if (welcomeAgent && AGENT_MAP[welcomeAgent]) {
    welcomeDesk = deskFor(welcomeAgent);
    const zone = AGENT_ZONE[welcomeAgent] ?? "plan";
    const same = AGENTS.filter((a) => a.id !== welcomeAgent && (AGENT_ZONE[a.id] ?? "") === zone).map((a) => a.id);
    const others = AGENTS.filter((a) => a.id !== welcomeAgent && !same.includes(a.id)).map((a) => a.id);
    greeters = [...same, ...others].filter((id) => !meetingMembers.includes(id)).slice(0, 4);
    greeters.forEach((id, i) => {
      welcomeSay[id] = WELCOME_LINES[i % WELCOME_LINES.length];
    });
  }
  const targets: Targets = {};
  for (const a of AGENTS) {
    const mi = meetingMembers.indexOf(a.id);
    const br = breaksRef.current[a.id];
    const wi = greeters.indexOf(a.id);
    if (mi >= 0) {
      targets[a.id] = meetingSeat(mi);
    } else if (welcomeDesk && wi >= 0) {
      const [dx, dz] = WELCOME_SPOTS[wi % WELCOME_SPOTS.length];
      targets[a.id] = [welcomeDesk[0] + dx, 0, welcomeDesk[2] + dz];
    } else if (a.id !== "pm" && lastReport[a.id] && now - lastReport[a.id].ts < REPORT_TTL) {
      targets[a.id] = pmFront(a.id);
    } else if (a.id === "pm" && lastPmVisit && now - lastPmVisit.ts < VISIT_TTL && AGENT_MAP[lastPmVisit.to!]) {
      const d = deskFor(lastPmVisit.to!);
      targets[a.id] = [d[0] - 1.1, 0, d[2] + 1.2];
    } else if (br && now < br.until) {
      targets[a.id] = br.spot;
    } else {
      targets[a.id] = homeOf(a.id);
    }
  }
  targetsRef.current = targets;

  return (
    <>
      <color attach="background" args={[P.bg]} />
      <fog attach="fog" args={[P.bg, P.fogNear, P.fogFar]} />
      <ambientLight intensity={P.ambient} />
      <directionalLight position={[22, 32, 16]} intensity={P.dir} color={P.dirColor} />

      <City P={P} />
      <Plate P={P} night={night} />
      <CeoRoom P={P} />
      <MeetingRoom P={P} active={meetingMembers.length > 0} />
      <Lounge P={P} night={night} />

      {AGENTS.map((a) => (
        <Desk key={`d-${a.id}`} pos={deskFor(a.id)} P={P} seed={[...a.id].reduce((s, ch) => s + ch.charCodeAt(0), 0)} />
      ))}
      {/* 인턴 빈자리 — 아트 인턴(SD)·개발 인턴(프로토타입) */}
      <Desk pos={[0.2, 0, 8]} P={P} seed={3} />
      <InternSeat pos={[0.2, 0, 8]} label="아트 인턴" emoji="🖌️" dot="#e879f9" onOpen={onArtIntern} />
      <Desk pos={[12.9, 0, -1]} P={P} seed={5} />
      <InternSeat pos={[12.9, 0, -1]} label="개발 인턴" emoji="🧑‍💻" dot="#34d399" onOpen={onProtoIntern} />
      <Janitor />
      {AGENTS.map((a) => (
        <Person
          key={a.id}
          id={a.id}
          targetsRef={targetsRef}
          onSelect={onSelect}
          selected={selId === a.id}
          inMeeting={meetingMembers.includes(a.id)}
          say={
            meetingMembers.includes(a.id)
              ? meetingSay[a.id]
              : levelUpAgent?.id === a.id
                ? `✨ 레벨 업! Lv.${levelUpAgent.level} — 회고 중…`
                : welcomeSay[a.id] ?? breakSay[a.id]
          }
        />
      ))}
      {/* 신입 환영 폭죽 — 새 책상 위 */}
      {welcomeAgent && welcomeDesk && <Confetti key={welcomeAgent} pos={welcomeDesk} />}
      {/* 레벨업 폭죽 — 성장한 직원 책상 위 */}
      {levelUpAgent && !welcomeAgent && (
        <Confetti
          key={`lv-${levelUpAgent.id}-${levelUpAgent.level}`}
          pos={deskFor(levelUpAgent.id)}
          label={`✨ ${AGENT_MAP[levelUpAgent.id]?.name ?? levelUpAgent.id} — Lv.${levelUpAgent.level} 달성!`}
        />
      )}

      <CameraRig camApi={camApi} />
    </>
  );
}

/* ── 직원 팝업 (하단 중앙 카드 — 샘플 스타일) ─────────── */
function AgentPopup({ id, onClose, onDevTask }: { id: string; onClose: () => void; onDevTask?: (id: string) => void }) {
  const a = AGENT_MAP[id];
  const { agentStatus, livePeek } = useVE();
  if (!a) return null;
  const st = agentStatus[id] ?? "idle";
  const peek = livePeek[id] ?? "";
  const z = zoneOfAgent(id);
  const stLabel: Record<string, string> = { idle: "대기", running: "작업 중", done: "완료", error: "오류" };
  return (
    <div className="o3d-card" style={{ borderColor: `${a.color}55` }}>
      <div className="o3d-card-ava" style={{ background: `${a.color}22`, borderColor: `${a.color}66` }}>
        {a.emoji}
      </div>
      <div className="o3d-card-main">
        <div className="o3d-card-name">
          {a.name}
          <span className={`o3d-card-st s-${st}`}>● {stLabel[st]}</span>
        </div>
        <div className="o3d-card-sub dim">
          <span className="o3d-dot" style={{ background: z.dot }} /> {z.label} · {a.role}
        </div>
        {st === "running" && peek && <div className="o3d-card-peek">…{peek.replace(/[#*>`]/g, "").slice(-80)}</div>}
      </div>
      <div className="o3d-card-actions">
        <button className="o3d-pop-btn primary" onClick={() => useVE.getState().selectAgent(id)}>
          💬 채팅
        </button>
        {a.phase === "dev" && onDevTask && (
          <button
            className="o3d-pop-btn"
            onClick={() => {
              onDevTask(id);
              onClose();
            }}
          >
            ▶ 작업
          </button>
        )}
        <button className="o3d-pop-btn" onClick={() => useVE.getState().openProfile(id)}>
          프로필
        </button>
        <button className="o3d-pop-btn x" onClick={onClose}>
          ✕
        </button>
      </div>
    </div>
  );
}

/* ── 캔버스 우하단 카메라 컨트롤 ─────────────────────── */
function ControlsOverlay({ camApi }: { camApi: React.MutableRefObject<CamApi> }) {
  const call = (fn: keyof CamApi, ...args: any[]) => (camApi.current[fn] as any)?.(...args);
  return (
    <div className="o3d-ctl">
      <div className="o3d-ctl-group">
        <button className="o3d-cbtn ic" onClick={() => call("rotate", -45)} title="왼쪽으로 돌리기">
          ⟲
        </button>
        <button className="o3d-cbtn ic" onClick={() => call("pan", -3, 0)} title="왼쪽으로 이동">
          ◀
        </button>
        <button className="o3d-cbtn ic" onClick={() => call("reset")} title="전체 보기">
          ⌂
        </button>
        <button className="o3d-cbtn ic" onClick={() => call("pan", 3, 0)} title="오른쪽으로 이동">
          ▶
        </button>
        <button className="o3d-cbtn ic" onClick={() => call("rotate", 45)} title="오른쪽으로 돌리기">
          ⟳
        </button>
      </div>
    </div>
  );
}

export function Office3D({
  camRef,
  onDevTask,
  onArtIntern,
  onProtoIntern,
}: {
  camRef?: React.MutableRefObject<CamApi>;
  onDevTask?: (id: string) => void;
  onArtIntern?: () => void;
  onProtoIntern?: () => void;
}) {
  const [selId, setSelId] = useState<string | null>(null);
  const innerRef = useRef<CamApi>({});
  const camApi = camRef ?? innerRef;
  const officeTheme = useVE((s) => s.officeTheme);
  // 테마: day/night 직접 선택 외에는 시간 기반 자동
  const [, retick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => retick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  // 창이 백그라운드(가려짐)면 브라우저가 ResizeObserver 콜백을 스로틀해
  // Canvas가 크기(기본 300×150)를 못 재고 씬이 검게 남는다 — resize를 쏴서 측정을 강제
  useEffect(() => {
    const kick = () => window.dispatchEvent(new Event("resize"));
    const t1 = setTimeout(kick, 400);
    const t2 = setTimeout(kick, 2000);
    document.addEventListener("visibilitychange", kick);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      document.removeEventListener("visibilitychange", kick);
    };
  }, []);
  const hour = new Date().getHours();
  const mode: "day" | "night" =
    officeTheme === "day" ? "day" : officeTheme === "night" ? "night" : hour >= 7 && hour < 18 ? "day" : "night";

  return (
    <div className="office3d-wrap studio">
      <Canvas dpr={[1, 1.5]} camera={{ position: DEFAULT_CAM.pos, fov: 46 }}>
        <OfficeScene
          onSelect={setSelId}
          selId={selId}
          camApi={camApi}
          mode={mode}
          onArtIntern={onArtIntern}
          onProtoIntern={onProtoIntern}
        />
      </Canvas>
      <ControlsOverlay camApi={camApi} />
      {selId && <AgentPopup id={selId} onClose={() => setSelId(null)} onDevTask={onDevTask} />}
    </div>
  );
}
