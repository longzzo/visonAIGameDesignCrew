import { useRef, useState, useEffect, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import type { Group } from "three";
import { AGENTS, AGENT_MAP } from "../lib/agents";
import { useVE, type FeedMsg } from "../store";

/**
 * 3D 사무실 — 에이전트들이 실제로 걸어다니는 입체 사무실.
 * 2D 사무실과 같은 store 상태(agentStatus/feed/meetingMembers)를 공유한다:
 *   · 회의 소집(협업 세션·팀 리뷰) → 회의실 테이블로 걸어가 둘러앉음
 *   · 산출물 제출(draft/revision/summary → pm) → PM 책상 앞으로 걸어가 보고 후 복귀
 *   · PM 지시 → PM이 담당자 책상까지 걸어가 전달
 *   · 작업 중 → 자리에서 빠른 타이핑 바운스, 대기 → 느린 숨쉬기 봅잉
 */

type V3 = [number, number, number];

/* ── 배치 (x: 좌우, z: 카메라 방향 +) ───────────────────── */
const PM_DESK: V3 = [0, 0, -6];
const DESK_POS: Record<string, V3> = {
  pm: PM_DESK,
  qa: [3.1, 0, -6],
  // 기획층
  scenario: [-5.2, 0, -3.1],
  gameplay: [-2.6, 0, -3.1],
  systems: [0, 0, -3.1],
  uiux: [2.6, 0, -3.1],
  td: [5.2, 0, -3.1],
  balance: [-5.2, 0, -0.6],
  bm: [-2.6, 0, -0.6],
  scheduler: [0, 0, -0.6],
  marketing: [2.6, 0, -0.6],
  visual: [5.2, 0, -0.6],
  // 개발층 (구분선 아래)
  uarch: [-3.9, 0, 2.6],
  ugp: [-1.3, 0, 2.6],
  netcode: [1.3, 0, 2.6],
  techart: [3.9, 0, 2.6],
  edtool: [-2.6, 0, 4.9],
  review: [0, 0, 4.9],
  testeng: [2.6, 0, 4.9],
};
const MEETING_CENTER: V3 = [8.6, 0, 0.2];

/** 캐릭터 기본 위치 = 책상 뒤 (카메라 반대편) */
const homeOf = (id: string): V3 => {
  const d = DESK_POS[id] ?? [0, 0, 0];
  return [d[0], 0, d[2] - 0.95];
};
const meetingSeat = (i: number, n: number): V3 => {
  const ang = (i / Math.max(n, 1)) * Math.PI * 2 + Math.PI / 2;
  return [MEETING_CENTER[0] + Math.cos(ang) * 2.1, 0, MEETING_CENTER[2] + Math.sin(ang) * 2.1];
};
/** PM 책상 앞 보고 지점 — 동시에 여러 명이 와도 겹치지 않게 id 해시로 살짝 분산 */
const pmFront = (id: string): V3 => {
  const h = [...id].reduce((s, c) => s + c.charCodeAt(0), 0);
  return [PM_DESK[0] - 1.2 + (h % 5) * 0.6, 0, PM_DESK[2] + 1.7];
};

const REPORT_TTL = 7000;
const VISIT_TTL = 7000;

/** 프레임 루프에서 참조하는 이동 목표 (렌더마다 갱신되는 가변 참조) */
type Targets = Record<string, V3>;

/* ── 고양이 캐릭터 ───────────────────────────────────── */
function Cat({ id, targetsRef }: { id: string; targetsRef: React.MutableRefObject<Targets> }) {
  const a = AGENT_MAP[id];
  const ref = useRef<Group>(null);
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);
  const { agentStatus, livePeek } = useVE();
  const st = agentStatus[id] ?? "idle";
  const peek = livePeek[id] ?? "";
  const [walking, setWalking] = useState(false);

  useFrame((state, dt) => {
    const g = ref.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const target = targetsRef.current[id] ?? homeOf(id);
    const dx = target[0] - g.position.x;
    const dz = target[2] - g.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.08) {
      const speed = Math.min(2.6 * dt, dist);
      g.position.x += (dx / dist) * speed;
      g.position.z += (dz / dist) * speed;
      g.rotation.y = Math.atan2(dx, dz);
      g.position.y = Math.abs(Math.sin(t * 9 + phase)) * 0.09; // 걸음 통통
      if (!walking) setWalking(true);
    } else {
      // 자리: 작업 중이면 빠른 타이핑 바운스, 아니면 숨쉬기
      g.position.y = st === "running" ? Math.abs(Math.sin(t * 7 + phase)) * 0.06 : Math.sin(t * 1.6 + phase) * 0.025;
      // 회의석에선 테이블을, 자리에선 카메라(+z)를 본다
      const atMeeting = Math.hypot(g.position.x - MEETING_CENTER[0], g.position.z - MEETING_CENTER[2]) < 2.6;
      const face = atMeeting
        ? Math.atan2(MEETING_CENTER[0] - g.position.x, MEETING_CENTER[2] - g.position.z)
        : 0;
      g.rotation.y += (face - g.rotation.y) * Math.min(dt * 6, 1);
      if (walking) setWalking(false);
    }
  });

  const home = homeOf(id);
  const c = a?.color ?? "#8b7cf6";
  return (
    <group ref={ref} position={home}>
      {/* 몸통 */}
      <mesh castShadow position={[0, 0.34, 0]}>
        <capsuleGeometry args={[0.22, 0.3, 6, 12]} />
        <meshStandardMaterial color={c} />
      </mesh>
      {/* 머리 */}
      <mesh castShadow position={[0, 0.82, 0]}>
        <sphereGeometry args={[0.24, 20, 16]} />
        <meshStandardMaterial color={c} />
      </mesh>
      {/* 귀 */}
      <mesh castShadow position={[-0.13, 1.04, 0]} rotation={[0, 0, 0.3]}>
        <coneGeometry args={[0.08, 0.16, 8]} />
        <meshStandardMaterial color={c} />
      </mesh>
      <mesh castShadow position={[0.13, 1.04, 0]} rotation={[0, 0, -0.3]}>
        <coneGeometry args={[0.08, 0.16, 8]} />
        <meshStandardMaterial color={c} />
      </mesh>
      {/* 눈 (+z = 앞) */}
      <mesh position={[-0.08, 0.85, 0.2]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshStandardMaterial color="#1a1d24" />
      </mesh>
      <mesh position={[0.08, 0.85, 0.2]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshStandardMaterial color="#1a1d24" />
      </mesh>
      {/* 이름표 + 상태 */}
      <Html center position={[0, 1.5, 0]} distanceFactor={11} zIndexRange={[10, 0]}>
        <div className="o3d-label" style={{ borderColor: c }}>
          {st === "running" ? "⚡" : st === "done" ? "✅" : st === "error" ? "💢" : ""}
          {a?.emoji} {a?.name}
        </div>
      </Html>
      {/* 작업 중 실시간 말풍선 */}
      {st === "running" && peek && !walking && (
        <Html center position={[0, 2.1, 0]} distanceFactor={10} zIndexRange={[20, 0]}>
          <div className="o3d-bubble">…{peek.replace(/[#*>`]/g, "").replace(/\s+/g, " ").slice(-46)}</div>
        </Html>
      )}
    </group>
  );
}

/* ── 소품 ───────────────────────────────────────────── */
function Desk({ pos, big }: { pos: V3; big?: boolean }) {
  const w = big ? 2.1 : 1.5;
  return (
    <group position={pos}>
      <mesh castShadow receiveShadow position={[0, 0.42, 0]}>
        <boxGeometry args={[w, 0.08, 0.85]} />
        <meshStandardMaterial color="#5b4636" />
      </mesh>
      {[-w / 2 + 0.1, w / 2 - 0.1].map((x) => (
        <mesh key={x} castShadow position={[x, 0.2, 0]}>
          <boxGeometry args={[0.08, 0.42, 0.7]} />
          <meshStandardMaterial color="#4a3a2d" />
        </mesh>
      ))}
      {/* 모니터 (캐릭터 쪽을 본다) */}
      <mesh castShadow position={[0, 0.72, 0.08]} rotation={[0, Math.PI, 0]}>
        <boxGeometry args={[0.55, 0.36, 0.04]} />
        <meshStandardMaterial color="#141820" emissive="#2b3a55" emissiveIntensity={0.8} />
      </mesh>
      <mesh position={[0, 0.52, 0.08]}>
        <boxGeometry args={[0.08, 0.1, 0.04]} />
        <meshStandardMaterial color="#333a45" />
      </mesh>
    </group>
  );
}

function MeetingArea({ active }: { active: boolean }) {
  return (
    <group position={MEETING_CENTER}>
      <mesh receiveShadow position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[3.1, 40]} />
        <meshStandardMaterial color={active ? "#3b3560" : "#2c3040"} />
      </mesh>
      <mesh castShadow position={[0, 0.5, 0]}>
        <cylinderGeometry args={[1.45, 1.45, 0.09, 32]} />
        <meshStandardMaterial color="#6b5b8e" />
      </mesh>
      <mesh castShadow position={[0, 0.24, 0]}>
        <cylinderGeometry args={[0.18, 0.26, 0.42, 12]} />
        <meshStandardMaterial color="#4a4462" />
      </mesh>
      <Html center position={[0, 2.1, 0]} distanceFactor={13}>
        <div className={`o3d-room-label ${active ? "on" : ""}`}>{active ? "🗣 회의 중…" : "회의실"}</div>
      </Html>
    </group>
  );
}

/* ── 씬 ─────────────────────────────────────────────── */
function OfficeScene() {
  const { feed, meetingMembers } = useVE();
  const targetsRef = useRef<Targets>({});
  // TTL(보고 연출 종료) 반영용 틱
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1500);
    return () => clearInterval(t);
  }, []);

  // 이동 목표 계산 — 회의 > 보고 > PM 순회 > 자리
  const now = Date.now();
  let lastPmVisit: FeedMsg | undefined;
  const lastReport: Record<string, FeedMsg> = {};
  for (const m of feed) {
    if (m.from === "pm" && m.to && (m.kind === "instruction" || m.kind === "status")) lastPmVisit = m;
    if (m.to === "pm" && m.from && (m.kind === "draft" || m.kind === "revision" || m.kind === "summary")) lastReport[m.from] = m;
  }
  const targets: Targets = {};
  for (const a of AGENTS) {
    const mi = meetingMembers.indexOf(a.id);
    if (mi >= 0) {
      targets[a.id] = meetingSeat(mi, meetingMembers.length);
    } else if (a.id !== "pm" && lastReport[a.id] && now - lastReport[a.id].ts < REPORT_TTL) {
      targets[a.id] = pmFront(a.id);
    } else if (a.id === "pm" && lastPmVisit && now - lastPmVisit.ts < VISIT_TTL && DESK_POS[lastPmVisit.to!]) {
      const d = DESK_POS[lastPmVisit.to!];
      targets[a.id] = [d[0] - 1.1, 0, d[2] + 1.2];
    } else {
      targets[a.id] = homeOf(a.id);
    }
  }
  targetsRef.current = targets;

  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight position={[6, 12, 8]} intensity={1.1} castShadow shadow-mapSize={[1024, 1024]} />
      {/* 바닥 — 기획층 / 개발층 투톤 */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -2.6]}>
        <planeGeometry args={[30, 9.6]} />
        <meshStandardMaterial color="#262b36" />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 4.6]}>
        <planeGeometry args={[30, 4.9]} />
        <meshStandardMaterial color="#20303a" />
      </mesh>
      {/* 층 구분선 */}
      <mesh position={[0, 0.02, 1.7]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[30, 0.1]} />
        <meshStandardMaterial color="#38bdf8" transparent opacity={0.5} />
      </mesh>
      <Html center position={[-9.5, 0.6, 1.7]} distanceFactor={14}>
        <div className="o3d-room-label">🛠️ 개발팀 층</div>
      </Html>

      {AGENTS.map((a) => (
        <Desk key={`desk-${a.id}`} pos={DESK_POS[a.id]} big={a.id === "pm"} />
      ))}
      {AGENTS.map((a) => (
        <Cat key={a.id} id={a.id} targetsRef={targetsRef} />
      ))}
      <MeetingArea active={meetingMembers.length > 0} />

      <OrbitControls
        target={[2.4, 0.3, -0.5]}
        minDistance={5}
        maxDistance={30}
        maxPolarAngle={Math.PI / 2.15}
        enableDamping
      />
    </>
  );
}

export function Office3D() {
  return (
    <div className="office3d-wrap">
      <Canvas shadows dpr={[1, 1.75]} camera={{ position: [2.4, 11, 14.5], fov: 50 }}>
        <color attach="background" args={["#171b24"]} />
        <fog attach="fog" args={["#171b24", 26, 44]} />
        <OfficeScene />
      </Canvas>
      <div className="o3d-hint dim">🖱 드래그 회전 · 휠 줌 · 회의 소집/보고/지시가 실제 이동으로 보입니다</div>
    </div>
  );
}
