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
      {/* 블롭 섀도 (실시간 그림자 대신 — 저사양에서도 60fps) */}
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.3, 14]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.32} />
      </mesh>
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
      {/* 꼬리 */}
      <mesh castShadow position={[0, 0.28, -0.26]} rotation={[0.9, 0, 0]}>
        <coneGeometry args={[0.06, 0.34, 8]} />
        <meshStandardMaterial color={c} />
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
function Desk({ pos, big, seed }: { pos: V3; big?: boolean; seed: number }) {
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
      {/* 책상 소품 — 자리마다 다른 조합 (커피잔 / 서류 / 스탠드) */}
      {seed % 3 !== 0 && (
        <group position={[w * 0.32, 0.5, -0.12]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.055, 0.045, 0.09, 10]} />
            <meshStandardMaterial color={seed % 2 ? "#d9822b" : "#e8e2d6"} />
          </mesh>
        </group>
      )}
      {seed % 2 === 0 && (
        <mesh castShadow position={[-w * 0.3, 0.475, -0.05]} rotation={[0, (seed % 7) * 0.2, 0]}>
          <boxGeometry args={[0.26, 0.015, 0.34]} />
          <meshStandardMaterial color="#e6e9ee" />
        </mesh>
      )}
      {seed % 4 === 1 && (
        <group position={[-w * 0.38, 0.6, 0.1]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.02, 0.02, 0.26, 6]} />
            <meshStandardMaterial color="#666f7c" />
          </mesh>
          <mesh position={[0.06, 0.12, 0]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshStandardMaterial color="#ffe9a8" emissive="#ffdd77" emissiveIntensity={0.9} />
          </mesh>
        </group>
      )}
    </group>
  );
}

/** 화분 */
function Plant({ pos, s = 1 }: { pos: V3; s?: number }) {
  return (
    <group position={pos} scale={s}>
      <mesh castShadow position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.22, 0.28, 0.44, 10]} />
        <meshStandardMaterial color="#8a5535" />
      </mesh>
      <mesh castShadow position={[0, 0.62, 0]}>
        <sphereGeometry args={[0.34, 12, 10]} />
        <meshStandardMaterial color="#3f7d4e" />
      </mesh>
      <mesh castShadow position={[0.14, 0.86, 0.06]}>
        <sphereGeometry args={[0.2, 10, 8]} />
        <meshStandardMaterial color="#4d9660" />
      </mesh>
    </group>
  );
}

/** 벽시계 — +z를 바라보는 평면 구성, 실제 시간으로 바늘이 돈다 */
function WallClock({ pos }: { pos: V3 }) {
  const hour = useRef<Group>(null);
  const min = useRef<Group>(null);
  useFrame(() => {
    const d = new Date();
    const m = d.getMinutes() + d.getSeconds() / 60;
    const h = (d.getHours() % 12) + m / 60;
    if (min.current) min.current.rotation.z = -(m / 60) * Math.PI * 2;
    if (hour.current) hour.current.rotation.z = -(h / 12) * Math.PI * 2;
  });
  return (
    <group position={pos}>
      <mesh>
        <circleGeometry args={[0.5, 24]} />
        <meshStandardMaterial color="#e8e6df" />
      </mesh>
      <mesh position={[0, 0, 0.01]}>
        <torusGeometry args={[0.5, 0.05, 8, 24]} />
        <meshStandardMaterial color="#3b4252" />
      </mesh>
      <group ref={hour} position={[0, 0, 0.02]}>
        <mesh position={[0, 0.13, 0]}>
          <boxGeometry args={[0.05, 0.26, 0.02]} />
          <meshStandardMaterial color="#2b303b" />
        </mesh>
      </group>
      <group ref={min} position={[0, 0, 0.03]}>
        <mesh position={[0, 0.19, 0]}>
          <boxGeometry args={[0.03, 0.38, 0.02]} />
          <meshStandardMaterial color="#2b303b" />
        </mesh>
      </group>
    </group>
  );
}

/** 낮은 파티션 벽 하나 */
function Partition({ pos, size, color = "#3a4560", opacity = 0.55 }: { pos: V3; size: [number, number, number]; color?: string; opacity?: number }) {
  return (
    <mesh position={pos} castShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} transparent opacity={opacity} />
    </mesh>
  );
}

/** 부서 파티션 + PM 임원실 — 역할별 공간을 실제 벽으로 나눈다 */
function Partitions() {
  return (
    <group>
      {/* ── PM 임원실 (뒤쪽 별도 공간, 찾아오는 느낌) ── */}
      {/* 바닥 단(플랫폼) */}
      <mesh receiveShadow position={[1.55, 0.03, -6.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[6.6, 3.4]} />
        <meshStandardMaterial color="#2d2740" />
      </mesh>
      {/* 좌·우 유리 벽 (앞은 트여 있어 걸어 들어감) */}
      <Partition pos={[-1.9, 0.65, -6.4]} size={[0.12, 1.3, 3.2]} color="#5b4d86" opacity={0.4} />
      <Partition pos={[5.0, 0.65, -6.4]} size={[0.12, 1.3, 3.2]} color="#5b4d86" opacity={0.4} />
      {/* 앞 벽 일부 (가운데 입구 비움) */}
      <Partition pos={[-0.9, 0.65, -4.85]} size={[1.8, 1.3, 0.12]} color="#5b4d86" opacity={0.4} />
      <Partition pos={[4.0, 0.65, -4.85]} size={[1.8, 1.3, 0.12]} color="#5b4d86" opacity={0.4} />
      <Html center position={[1.55, 1.75, -6.3]} distanceFactor={13}>
        <div className="o3d-room-label on">🎯 임원실 (PM·QA)</div>
      </Html>

      {/* ── 기획팀 부서 파티션 (낮은 칸막이) ── */}
      {/* 기획/사업 파트 사이 세로 칸막이 */}
      <Partition pos={[-6.4, 0.45, -1.85]} size={[0.1, 0.9, 3.6]} />
      <Partition pos={[6.4, 0.45, -1.85]} size={[0.1, 0.9, 3.6]} />
      {/* row1과 row2 사이 낮은 칸막이 */}
      <Partition pos={[0, 0.32, -1.85]} size={[13, 0.64, 0.1]} opacity={0.35} />

      {/* ── 개발팀 부서 파티션 ── */}
      <Partition pos={[-5.4, 0.45, 3.75]} size={[0.1, 0.9, 3.4]} color="#4a3f6e" />
      <Partition pos={[5.4, 0.45, 3.75]} size={[0.1, 0.9, 3.4]} color="#4a3f6e" />
      <Partition pos={[0, 0.3, 3.75]} size={[11, 0.6, 0.1]} color="#4a3f6e" opacity={0.35} />
    </group>
  );
}

/** 사무실 데코 — 벽·야경 창문·책장·GDD 보드·화분 */
function Decor() {
  const bookColors = ["#e05a5a", "#3d6fb4", "#3ba55d", "#d9822b", "#8b7cf6", "#e879f9", "#fbbf24", "#38bdf8"];
  return (
    <group>
      {/* 뒷벽 */}
      <mesh receiveShadow position={[0, 2.2, -8.3]}>
        <boxGeometry args={[31, 4.6, 0.3]} />
        <meshStandardMaterial color="#242a38" />
      </mesh>
      {/* 야경 창문 3개 + 달 */}
      {[-8.5, -1.5, 9.5].map((x, i) => (
        <group key={x} position={[x, 2.35, -8.12]}>
          <mesh>
            <boxGeometry args={[3.6, 2.3, 0.06]} />
            <meshStandardMaterial color="#151c30" emissive="#1d2a4d" emissiveIntensity={0.65} />
          </mesh>
          {/* 창틀 */}
          <mesh position={[0, 0, 0.04]}>
            <boxGeometry args={[3.7, 0.09, 0.05]} />
            <meshStandardMaterial color="#3a4356" />
          </mesh>
          <mesh position={[0, 0, 0.04]} rotation={[0, 0, Math.PI / 2]}>
            <boxGeometry args={[2.4, 0.09, 0.05]} />
            <meshStandardMaterial color="#3a4356" />
          </mesh>
          {i === 1 && (
            <mesh position={[0.9, 0.55, 0.02]}>
              <circleGeometry args={[0.34, 20]} />
              <meshStandardMaterial color="#f2ecd8" emissive="#efe6c2" emissiveIntensity={1.2} />
            </mesh>
          )}
          {/* 먼 도시 불빛 */}
          {Array.from({ length: 7 }, (_, k) => (
            <mesh key={k} position={[-1.4 + k * 0.45, -0.55 - (k % 3) * 0.14, 0.02]}>
              <planeGeometry args={[0.1, 0.28 + (k % 2) * 0.16]} />
              <meshStandardMaterial color="#2c3a5e" emissive="#4a5f96" emissiveIntensity={0.8} />
            </mesh>
          ))}
        </group>
      ))}
      {/* 마스터 GDD 보드 */}
      <group position={[4.6, 2.2, -8.1]}>
        <mesh>
          <boxGeometry args={[2.9, 1.7, 0.08]} />
          <meshStandardMaterial color="#f0efe9" />
        </mesh>
        <mesh position={[0, 0, -0.01]}>
          <boxGeometry args={[3.05, 1.85, 0.06]} />
          <meshStandardMaterial color="#5b4636" />
        </mesh>
        {[0.45, 0.15, -0.15, -0.45].map((y, k) => (
          <mesh key={y} position={[-0.25 + (k % 2) * 0.2, y, 0.05]}>
            <planeGeometry args={[1.8 - (k % 3) * 0.4, 0.09]} />
            <meshStandardMaterial color={k === 0 ? "#3b4252" : "#9aa5b1"} />
          </mesh>
        ))}
        <Html center position={[0, 1.15, 0]} distanceFactor={13}>
          <div className="o3d-room-label">📋 마스터 GDD 보드</div>
        </Html>
      </group>
      {/* 벽시계 */}
      <WallClock pos={[-4.8, 3.3, -8.1]} />
      {/* 책장 */}
      <group position={[-12.6, 0, -7.5]}>
        <mesh castShadow position={[0, 1.15, 0]}>
          <boxGeometry args={[2.4, 2.3, 0.6]} />
          <meshStandardMaterial color="#4a3a2d" />
        </mesh>
        {[1.86, 1.28, 0.7].map((y, row) => (
          <group key={y}>
            <mesh position={[0, y - 0.32, 0.02]}>
              <boxGeometry args={[2.2, 0.05, 0.55]} />
              <meshStandardMaterial color="#5b4636" />
            </mesh>
            {Array.from({ length: 6 }, (_, k) => (
              <mesh key={k} castShadow position={[-0.85 + k * 0.34, y, 0.1]}>
                <boxGeometry args={[0.16, 0.46 - (k % 2) * 0.07, 0.34]} />
                <meshStandardMaterial color={bookColors[(row * 3 + k) % bookColors.length]} />
              </mesh>
            ))}
          </group>
        ))}
      </group>
      {/* 화분들 */}
      <Plant pos={[-12.8, 0, 5.6]} s={1.25} />
      <Plant pos={[13, 0, -7.3]} s={1.1} />
      <Plant pos={[13.2, 0, 5.8]} />
      <Plant pos={[-7.9, 0, -6.1]} s={0.8} />
      {/* 은은한 보조광 */}
      <pointLight position={[8.6, 3.4, 0.2]} intensity={14} color="#b9a6ff" distance={9} />
      <pointLight position={[-8, 3.2, -5]} intensity={10} color="#ffd9a0" distance={9} />
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
      <ambientLight intensity={0.7} />
      <directionalLight position={[6, 12, 8]} intensity={1.05} />
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
        <div className="o3d-room-label">🛠️ 개발팀 구역</div>
      </Html>
      <Html center position={[-9.5, 0.6, -2.6]} distanceFactor={14}>
        <div className="o3d-room-label">📝 기획팀 구역</div>
      </Html>

      <Decor />
      <Partitions />
      {AGENTS.map((a) => (
        <Desk
          key={`desk-${a.id}`}
          pos={DESK_POS[a.id]}
          big={a.id === "pm"}
          seed={[...a.id].reduce((s, ch) => s + ch.charCodeAt(0), 0)}
        />
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
      <Canvas dpr={[1, 1.5]} camera={{ position: [2.4, 11, 14.5], fov: 50 }}>
        <color attach="background" args={["#171b24"]} />
        <fog attach="fog" args={["#171b24", 26, 44]} />
        <OfficeScene />
      </Canvas>
      <div className="o3d-hint dim">🖱 드래그 회전 · 휠 줌 · 회의 소집/보고/지시가 실제 이동으로 보입니다</div>
    </div>
  );
}
