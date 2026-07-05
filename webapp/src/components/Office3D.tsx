import { useRef, useState, useEffect, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { Group, Vector3 } from "three";
import { AGENTS, AGENT_MAP } from "../lib/agents";
import { useVE, type FeedMsg } from "../store";

/**
 * 3D 사무실 — 에이전트들이 실제로 걸어다니는 입체 2층 사무실.
 * 2D 사무실과 같은 store 상태(agentStatus/feed/meetingMembers)를 공유한다:
 *   · 회의 소집(협업 세션·팀 리뷰) → 별도 회의실 테이블로 걸어가 둘러앉음
 *   · 산출물 제출(draft/revision/summary → pm) → PM 임원실 앞으로 걸어가 보고 후 복귀
 *   · PM 지시 → PM이 담당자 책상까지 걸어가 전달
 *   · 작업 중 → 자리에서 빠른 타이핑 바운스, 대기 → 느린 숨쉬기 봅잉
 * 공간 구성:
 *   · 1F(y=0)   기획팀 + PM 임원실(뒤쪽 유리방 — 찾아오는 느낌)
 *   · 2F(y=H)   개발팀(개발 phase) — 실제 위층 슬래브 위, 앞면 트인 컷어웨이
 *   · 회의실     건물 오른쪽 별도 유리방(테이블·프로젝터·러그·조명)
 */

type V3 = [number, number, number];

/* ── 층 높이 & 배치 (x: 좌우, z: 카메라 방향 +, y: 위) ─────────── */
const FLOOR_H = 4.4; // 2F 바닥 높이
const DESK_POS: Record<string, V3> = {
  // ── 1F 임원실(뒤쪽 별도 방) ──
  pm: [-1.1, 0, -4.9],
  qa: [1.3, 0, -4.9],
  // ── 1F 기획팀 (2열) ──
  scenario: [-6, 0, -2.2],
  gameplay: [-3, 0, -2.2],
  systems: [0, 0, -2.2],
  uiux: [3, 0, -2.2],
  visual: [6, 0, -2.2],
  balance: [-6, 0, 1.0],
  bm: [-3, 0, 1.0],
  td: [0, 0, 1.0],
  scheduler: [3, 0, 1.0],
  marketing: [6, 0, 1.0],
  // ── 2F 개발팀 (위층 슬래브 위) ──
  uarch: [-5.4, FLOOR_H, -2.2],
  ugp: [-1.8, FLOOR_H, -2.2],
  netcode: [1.8, FLOOR_H, -2.2],
  techart: [5.4, FLOOR_H, -2.2],
  edtool: [-3.6, FLOOR_H, 1.0],
  review: [0, FLOOR_H, 1.0],
  testeng: [3.6, FLOOR_H, 1.0],
};
const PM_DESK = DESK_POS.pm;
const MEETING_CENTER: V3 = [12.6, 0, 0];

/** 캐릭터 기본 위치 = 책상 뒤 (카메라 반대편), 층 높이 포함 */
const homeOf = (id: string): V3 => {
  const d = DESK_POS[id] ?? [0, 0, 0];
  return [d[0], d[1], d[2] - 0.95];
};
const meetingSeat = (i: number, n: number): V3 => {
  const ang = (i / Math.max(n, 1)) * Math.PI * 2 + Math.PI / 2;
  return [MEETING_CENTER[0] + Math.cos(ang) * 2.1, 0, MEETING_CENTER[2] + Math.sin(ang) * 2.1];
};
/** PM 임원실 앞 보고 지점 — 동시에 여러 명이 와도 겹치지 않게 id 해시로 살짝 분산 */
const pmFront = (id: string): V3 => {
  const h = [...id].reduce((s, c) => s + c.charCodeAt(0), 0);
  return [PM_DESK[0] - 1 + (h % 5) * 0.6, 0, -3.2];
};

const REPORT_TTL = 7000;
const VISIT_TTL = 7000;

/* ── 카메라 프리셋(층 이동) ─────────────────────────── */
const DEFAULT_CAM = { pos: [7, 5.6, 19.5] as V3, tgt: [1, 2.4, -1.4] as V3 };
const FOCUS: Record<string, { pos: V3; tgt: V3 }> = {
  all: DEFAULT_CAM,
  "1f": { pos: [2.5, 4.4, 12], tgt: [0, 0.5, -1.6] },
  "2f": { pos: [2.5, 8.6, 12], tgt: [0, FLOOR_H + 0.4, -1.0] },
  meeting: { pos: [12.6, 5.4, 10], tgt: [12.6, 0.7, 0] },
};

/** 프레임 루프에서 참조하는 이동 목표 (렌더마다 갱신되는 가변 참조) */
type Targets = Record<string, V3>;

const setCursor = (c: string) => {
  document.body.style.cursor = c;
};

/* ── 고양이 캐릭터 ───────────────────────────────────── */
function Cat({
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
  const baseY = useRef<number>(homeOf(id)[1]);
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);
  const { agentStatus, livePeek } = useVE();
  const st = agentStatus[id] ?? "idle";
  const peek = livePeek[id] ?? "";
  const [walking, setWalking] = useState(false);
  const speaking = !!inMeeting && st === "running";
  // 회의 중엔 마지막 발언을 계속 말풍선으로 (2D 연출과 동일), 실시간 스트리밍이 있으면 그걸 우선
  const bubbleText = st === "running" && peek ? peek : inMeeting ? say ?? "" : "";

  useFrame((state, dt) => {
    const g = ref.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const target = targetsRef.current[id] ?? homeOf(id);
    const dx = target[0] - g.position.x;
    const dz = target[2] - g.position.z;
    const dist = Math.hypot(dx, dz);
    // 층 높이(baseY)는 항상 목표 y로 부드럽게 수렴 — 층 이동 시 자연스레 오르내림
    baseY.current += (target[1] - baseY.current) * Math.min(dt * 2.6, 1);
    if (dist > 0.08) {
      const speed = Math.min(2.6 * dt, dist);
      g.position.x += (dx / dist) * speed;
      g.position.z += (dz / dist) * speed;
      g.rotation.y = Math.atan2(dx, dz);
      g.position.y = baseY.current + Math.abs(Math.sin(t * 9 + phase)) * 0.09; // 걸음 통통
      if (!walking) setWalking(true);
    } else {
      const bounce = st === "running" ? Math.abs(Math.sin(t * 7 + phase)) * 0.06 : Math.sin(t * 1.6 + phase) * 0.025;
      g.position.y = baseY.current + bounce;
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
      {/* 블롭 섀도 (실시간 그림자 대신 — 저사양에서도 60fps) */}
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.3, 14]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.32} />
      </mesh>
      {/* 선택 하이라이트 링 */}
      {selected && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.33, 0.42, 28]} />
          <meshBasicMaterial color={c} transparent opacity={0.9} />
        </mesh>
      )}
      {/* 발언자 강조 — 바닥 링 + 스포트라이트 */}
      {speaking && (
        <>
          <mesh position={[0, 0.018, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.44, 0.56, 30]} />
            <meshBasicMaterial color={c} transparent opacity={0.75} />
          </mesh>
          <pointLight position={[0, 1.5, 0.3]} intensity={7} color={c} distance={3.2} />
        </>
      )}
      {/* 몸통 */}
      <mesh castShadow position={[0, 0.34, 0]}>
        <capsuleGeometry args={[0.22, 0.3, 6, 12]} />
        <meshStandardMaterial
          color={c}
          emissive={selected || speaking ? c : "#000000"}
          emissiveIntensity={speaking ? 0.5 : selected ? 0.35 : 0}
        />
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
      {/* 발언 중 마커 */}
      {speaking && !walking && (
        <Html center position={[0, 1.82, 0]} distanceFactor={10} zIndexRange={[30, 0]}>
          <div className="o3d-speak">🗣</div>
        </Html>
      )}
      {/* 이름표 + 상태 */}
      <Html center position={[0, 1.5, 0]} distanceFactor={11} zIndexRange={[10, 0]}>
        <div className={`o3d-label ${speaking ? "speaking" : ""}`} style={{ borderColor: c }}>
          {st === "running" ? "⚡" : st === "done" ? "✅" : st === "error" ? "💢" : ""}
          {a?.emoji} {a?.name}
        </div>
      </Html>
      {/* 말풍선 — 회의 발언(지속) / 작업 실시간 미리보기 */}
      {bubbleText && !walking && (
        <Html center position={[0, 2.1, 0]} distanceFactor={10} zIndexRange={[20, 0]}>
          <div className={`o3d-bubble ${speaking ? "speaking" : ""}`} style={speaking ? { borderColor: `${c}aa` } : undefined}>
            …{bubbleText.replace(/[#*>`]/g, "").replace(/\s+/g, " ").slice(inMeeting && !peek ? 0 : -46).slice(0, 60)}
          </div>
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

/** 유리 벽 하나 (반투명) */
function Glass({ pos, size, color = "#5b6f9e", opacity = 0.22 }: { pos: V3; size: V3; color?: string; opacity?: number }) {
  return (
    <mesh position={pos}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} transparent opacity={opacity} metalness={0.3} roughness={0.1} />
    </mesh>
  );
}

/* ── 건물 골격: 1F/2F 슬래브 · 뒷벽 · 기둥 · 난간 · 계단 ─────── */
function Building() {
  return (
    <group>
      {/* 1F 바닥 (기획/임원실 투톤) */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -1.3]}>
        <planeGeometry args={[16.4, 9.6]} />
        <meshStandardMaterial color="#262b36" />
      </mesh>
      {/* 임원실 카펫 */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0.1, 0.015, -4.8]}>
        <planeGeometry args={[6.8, 2.4]} />
        <meshStandardMaterial color="#2d2740" />
      </mesh>

      {/* 2F 슬래브(두께 있는 박스 — 아래면이 1F 천장) */}
      <mesh receiveShadow position={[0, FLOOR_H - 0.1, -1.3]}>
        <boxGeometry args={[16.4, 0.2, 9.6]} />
        <meshStandardMaterial color="#20303a" />
      </mesh>
      {/* 2F 개발/검증 투톤 러그 */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_H + 0.006, 1.0]}>
        <planeGeometry args={[13, 3.0]} />
        <meshStandardMaterial color="#24303f" />
      </mesh>

      {/* 뒷벽 (두 층을 관통) */}
      <mesh receiveShadow position={[0, FLOOR_H / 2 + 1.2, -6.15]}>
        <boxGeometry args={[16.8, FLOOR_H + 3.2, 0.3]} />
        <meshStandardMaterial color="#242a38" />
      </mesh>
      {/* 좌우 옆벽 (얇게, 뒤쪽만) */}
      {[-8.15, 8.15].map((x) => (
        <mesh key={x} position={[x, FLOOR_H / 2 + 1.2, -3.6]}>
          <boxGeometry args={[0.24, FLOOR_H + 3.2, 5.4]} />
          <meshStandardMaterial color="#222836" />
        </mesh>
      ))}

      {/* 코너 기둥 4개 */}
      {[
        [-7.9, -6.0],
        [7.9, -6.0],
        [-7.9, 3.2],
        [7.9, 3.2],
      ].map(([x, z], i) => (
        <mesh key={i} castShadow position={[x, FLOOR_H / 2 + 1.3, z]}>
          <boxGeometry args={[0.34, FLOOR_H + 3.4, 0.34]} />
          <meshStandardMaterial color="#39404f" />
        </mesh>
      ))}

      {/* 2F 앞 유리 난간 (컷어웨이 앞면, 낮게) */}
      <Glass pos={[0, FLOOR_H + 0.42, 3.2]} size={[16, 0.84, 0.08]} />
      {[-8, 8].map((x) => (
        <Glass key={x} pos={[x, FLOOR_H + 0.42, -1.3]} size={[0.08, 0.84, 9]} />
      ))}

      {/* 계단 — 1F(앞) → 2F(뒤) 왼쪽에 오르는 층계 */}
      <group position={[-6.9, 0, 0]}>
        {Array.from({ length: 9 }, (_, i) => (
          <mesh key={i} castShadow position={[0, (i + 1) * (FLOOR_H / 9) - FLOOR_H / 18, 2.4 - i * 0.42]}>
            <boxGeometry args={[1.7, FLOOR_H / 9, 0.5]} />
            <meshStandardMaterial color={i % 2 ? "#3a4356" : "#434c60"} />
          </mesh>
        ))}
        {/* 계단 난간 */}
        <Glass pos={[0.9, FLOOR_H / 2 + 0.4, 0.3]} size={[0.06, FLOOR_H + 0.8, 4.2]} opacity={0.16} />
      </group>

      {/* 층 사인 */}
      <Html center position={[-7.4, 0.9, 3.0]} distanceFactor={15}>
        <div className="o3d-floor-sign">1F · 기획층</div>
      </Html>
      <Html center position={[-7.4, FLOOR_H + 0.9, 3.0]} distanceFactor={15}>
        <div className="o3d-floor-sign dev">2F · 개발층</div>
      </Html>
    </group>
  );
}

/** PM 임원실 유리방 (뒤쪽 별도 공간 — 찾아오는 느낌) */
function ExecRoom() {
  return (
    <group>
      {/* 좌·우 유리 벽 */}
      <Glass pos={[-3.4, 0.7, -4.8]} size={[0.12, 1.4, 2.4]} color="#6a5aa0" opacity={0.28} />
      <Glass pos={[3.4, 0.7, -4.8]} size={[0.12, 1.4, 2.4]} color="#6a5aa0" opacity={0.28} />
      {/* 앞 유리 벽 (가운데 문 비움) */}
      <Glass pos={[-2.2, 0.7, -3.6]} size={[2.4, 1.4, 0.12]} color="#6a5aa0" opacity={0.28} />
      <Glass pos={[2.2, 0.7, -3.6]} size={[2.4, 1.4, 0.12]} color="#6a5aa0" opacity={0.28} />
      {/* 문틀 */}
      {[-0.95, 0.95].map((x) => (
        <mesh key={x} position={[x, 0.7, -3.6]}>
          <boxGeometry args={[0.08, 1.4, 0.16]} />
          <meshStandardMaterial color="#8b7cf6" emissive="#6a5aa0" emissiveIntensity={0.4} />
        </mesh>
      ))}
      {/* 임원 명패 */}
      <Html center position={[0, 1.7, -4.9]} distanceFactor={13}>
        <div className="o3d-room-label on">🎯 임원실 · PM / QA</div>
      </Html>
    </group>
  );
}

/** 별도 회의실 — 건물 오른쪽 유리방 (테이블·의자·프로젝터·러그·조명) */
function MeetingRoom({ active }: { active: boolean }) {
  const { meetingMembers, agentStatus } = useVE();
  const speakerId = meetingMembers.find((id) => agentStatus[id] === "running");
  const speaker = speakerId ? AGENT_MAP[speakerId] : null;
  const [cx, , cz] = MEETING_CENTER;
  const chairs = Array.from({ length: 8 }, (_, i) => {
    const ang = (i / 8) * Math.PI * 2;
    return [cx + Math.cos(ang) * 2.55, 0, cz + Math.sin(ang) * 2.55] as V3;
  });
  return (
    <group>
      {/* 방 바닥 + 러그 */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.004, cz]}>
        <planeGeometry args={[6.4, 6.8]} />
        <meshStandardMaterial color="#242a38" />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.012, cz]}>
        <circleGeometry args={[2.9, 40]} />
        <meshStandardMaterial color={active ? "#3b3560" : "#2c3040"} />
      </mesh>

      {/* 뒷벽(오른쪽) + 위/아래 유리벽 + 앞 유리(문 비움) */}
      <mesh position={[cx + 3.2, 1.2, cz]}>
        <boxGeometry args={[0.2, 2.4, 6.8]} />
        <meshStandardMaterial color="#242a38" />
      </mesh>
      <Glass pos={[cx, 0.95, cz - 3.3]} size={[6.4, 1.9, 0.12]} />
      <Glass pos={[cx, 0.95, cz + 3.3]} size={[6.4, 1.9, 0.12]} />
      <Glass pos={[cx - 3.2, 0.95, cz - 2.1]} size={[0.12, 1.9, 2.6]} />
      <Glass pos={[cx - 3.2, 0.95, cz + 2.1]} size={[0.12, 1.9, 2.6]} />

      {/* 건물↔회의실 연결 복도 */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[9.5, 0.006, 0]}>
        <planeGeometry args={[3.2, 2.4]} />
        <meshStandardMaterial color="#2a3040" />
      </mesh>

      {/* 프로젝터 스크린 (뒷벽, -x 방향을 본다) */}
      <group position={[cx + 3.08, 1.4, cz]} rotation={[0, -Math.PI / 2, 0]}>
        <mesh>
          <planeGeometry args={[3.4, 1.7]} />
          <meshStandardMaterial
            color={active ? "#2b3a6b" : "#161b28"}
            emissive={active ? "#3f57b0" : "#1d2740"}
            emissiveIntensity={active ? 1.0 : 0.5}
          />
        </mesh>
        {[0.4, 0.05, -0.35].map((y, k) => (
          <mesh key={y} position={[-0.2 + (k % 2) * 0.2, y, 0.02]}>
            <planeGeometry args={[2.2 - (k % 3) * 0.5, 0.09]} />
            <meshStandardMaterial color={active ? "#aab6e6" : "#4a5470"} />
          </mesh>
        ))}
      </group>

      {/* 원탁 */}
      <mesh castShadow position={[cx, 0.5, cz]}>
        <cylinderGeometry args={[1.5, 1.5, 0.09, 32]} />
        <meshStandardMaterial color="#6b5b8e" />
      </mesh>
      <mesh castShadow position={[cx, 0.24, cz]}>
        <cylinderGeometry args={[0.2, 0.28, 0.42, 12]} />
        <meshStandardMaterial color="#4a4462" />
      </mesh>

      {/* 의자 8개 */}
      {chairs.map((p, i) => (
        <group key={i} position={p}>
          <mesh castShadow position={[0, 0.26, 0]}>
            <boxGeometry args={[0.4, 0.08, 0.4]} />
            <meshStandardMaterial color="#3c4658" />
          </mesh>
          <mesh castShadow position={[0, 0.12, 0]}>
            <cylinderGeometry args={[0.04, 0.04, 0.24, 8]} />
            <meshStandardMaterial color="#2b303b" />
          </mesh>
        </group>
      ))}

      {/* 천장 펜던트 조명 */}
      <mesh position={[cx, 2.5, cz]}>
        <cylinderGeometry args={[0.5, 0.62, 0.16, 20]} />
        <meshStandardMaterial color="#3a4356" emissive="#ffe6a8" emissiveIntensity={active ? 0.7 : 0.3} />
      </mesh>
      <pointLight position={[cx, 2.3, cz]} intensity={active ? 16 : 9} color="#ffe9c4" distance={8} />

      {/* 프로젝터 위 현재 발언자 캡션 */}
      {active && speaker && (
        <Html center position={[cx + 2.9, 2.5, cz]} distanceFactor={13}>
          <div className="o3d-speaker-cap" style={{ borderColor: `${speaker.color}aa` }}>
            🗣 {speaker.emoji} {speaker.name} 발언 중
          </div>
        </Html>
      )}
      <Plant pos={[cx - 2.6, 0, cz - 2.6]} s={0.95} />
      <Html center position={[cx, 2.9, cz]} distanceFactor={14}>
        <div className={`o3d-room-label ${active ? "on" : ""}`}>
          {active ? `🗣 회의 중 · ${meetingMembers.length}명` : "🗣 회의실"}
        </div>
      </Html>
    </group>
  );
}

/** 사무실 데코 — 야경 창문·책장·GDD 보드·화분·벽시계 */
function Decor() {
  const bookColors = ["#e05a5a", "#3d6fb4", "#3ba55d", "#d9822b", "#8b7cf6", "#e879f9", "#fbbf24", "#38bdf8"];
  return (
    <group>
      {/* 야경 창문 3개(뒷벽 상단, 2F 높이) + 달 */}
      {[-5.5, 0.5, 6].map((x, i) => (
        <group key={x} position={[x, FLOOR_H + 1.7, -5.98]}>
          <mesh>
            <boxGeometry args={[3.2, 1.9, 0.06]} />
            <meshStandardMaterial color="#151c30" emissive="#1d2a4d" emissiveIntensity={0.65} />
          </mesh>
          <mesh position={[0, 0, 0.04]}>
            <boxGeometry args={[3.3, 0.08, 0.05]} />
            <meshStandardMaterial color="#3a4356" />
          </mesh>
          <mesh position={[0, 0, 0.04]} rotation={[0, 0, Math.PI / 2]}>
            <boxGeometry args={[2.0, 0.08, 0.05]} />
            <meshStandardMaterial color="#3a4356" />
          </mesh>
          {i === 1 && (
            <mesh position={[0.8, 0.5, 0.02]}>
              <circleGeometry args={[0.3, 20]} />
              <meshStandardMaterial color="#f2ecd8" emissive="#efe6c2" emissiveIntensity={1.2} />
            </mesh>
          )}
          {Array.from({ length: 6 }, (_, k) => (
            <mesh key={k} position={[-1.2 + k * 0.45, -0.45 - (k % 3) * 0.12, 0.02]}>
              <planeGeometry args={[0.1, 0.24 + (k % 2) * 0.14]} />
              <meshStandardMaterial color="#2c3a5e" emissive="#4a5f96" emissiveIntensity={0.8} />
            </mesh>
          ))}
        </group>
      ))}

      {/* 1F 마스터 GDD 보드 */}
      <group position={[5.2, 1.5, -5.98]}>
        <mesh>
          <boxGeometry args={[2.6, 1.5, 0.08]} />
          <meshStandardMaterial color="#f0efe9" />
        </mesh>
        <mesh position={[0, 0, -0.01]}>
          <boxGeometry args={[2.75, 1.65, 0.06]} />
          <meshStandardMaterial color="#5b4636" />
        </mesh>
        {[0.4, 0.12, -0.15, -0.42].map((y, k) => (
          <mesh key={y} position={[-0.2 + (k % 2) * 0.2, y, 0.05]}>
            <planeGeometry args={[1.6 - (k % 3) * 0.4, 0.08]} />
            <meshStandardMaterial color={k === 0 ? "#3b4252" : "#9aa5b1"} />
          </mesh>
        ))}
        <Html center position={[0, 1.0, 0]} distanceFactor={13}>
          <div className="o3d-room-label">📋 마스터 GDD</div>
        </Html>
      </group>

      {/* 벽시계 (1F) */}
      <WallClock pos={[-4.6, 2.1, -5.98]} />

      {/* 책장 (1F 좌측벽) */}
      <group position={[-7.7, 0, -4.6]} rotation={[0, Math.PI / 2, 0]}>
        <mesh castShadow position={[0, 1.15, 0]}>
          <boxGeometry args={[2.4, 2.3, 0.5]} />
          <meshStandardMaterial color="#4a3a2d" />
        </mesh>
        {[1.86, 1.28, 0.7].map((y, row) => (
          <group key={y}>
            <mesh position={[0, y - 0.32, 0.02]}>
              <boxGeometry args={[2.2, 0.05, 0.46]} />
              <meshStandardMaterial color="#5b4636" />
            </mesh>
            {Array.from({ length: 6 }, (_, k) => (
              <mesh key={k} castShadow position={[-0.85 + k * 0.34, y, 0.08]}>
                <boxGeometry args={[0.16, 0.46 - (k % 2) * 0.07, 0.3]} />
                <meshStandardMaterial color={bookColors[(row * 3 + k) % bookColors.length]} />
              </mesh>
            ))}
          </group>
        ))}
      </group>

      {/* 화분들 (양 층) */}
      <Plant pos={[-7.4, 0, 2.6]} s={1.2} />
      <Plant pos={[7.4, 0, -5.4]} s={1.0} />
      <Plant pos={[7.4, FLOOR_H, 2.4]} s={0.95} />
      <Plant pos={[-7.4, FLOOR_H, 2.6]} s={0.95} />

      {/* 은은한 보조광 */}
      <pointLight position={[0, FLOOR_H + 1.6, 0]} intensity={12} color="#b9a6ff" distance={12} />
      <pointLight position={[-3, 2.4, -3]} intensity={8} color="#ffd9a0" distance={9} />
    </group>
  );
}

/* ── 카메라 리그 (층 이동/좌우 회전/좌우 이동) ─────────── */
export type CamApi = {
  rotate?: (deg: number) => void;
  pan?: (dx: number, dz: number) => void;
  focus?: (key: string) => void;
  reset?: () => void;
};
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
      camera.position.copy(goal.current.pos);
      c.target.copy(goal.current.tgt);
      c.update();
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
        const nx = dx * Math.cos(a) - dz * Math.sin(a);
        const nz = dx * Math.sin(a) + dz * Math.cos(a);
        setGoal([t.x + nx, p.y, t.z + nz], [t.x, t.y, t.z]);
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
        const rx = -fz;
        const rz = fx; // 우측 벡터(XZ)
        const mx = rx * dx + fx * dz;
        const mz = rz * dx + fz * dz;
        setGoal([p.x + mx, p.y, p.z + mz], [t.x + mx, t.y, t.z + mz]);
      },
      focus: (key) => {
        const v = FOCUS[key];
        if (v) setGoal(v.pos, v.tgt);
      },
      reset: () => setGoal(DEFAULT_CAM.pos, DEFAULT_CAM.tgt),
    };
  }, [camera, camApi]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={DEFAULT_CAM.tgt}
      minDistance={5}
      maxDistance={42}
      maxPolarAngle={Math.PI / 2.05}
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
}: {
  onSelect: (id: string) => void;
  selId: string | null;
  camApi: React.MutableRefObject<CamApi>;
}) {
  const { feed, meetingMembers } = useVE();
  const targetsRef = useRef<Targets>({});
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
  // 회의 발언 — 각 참가자의 마지막 발화(2D 연출과 동일)를 지속 말풍선으로
  const meetingSay: Record<string, string> = {};
  if (meetingMembers.length > 0) {
    for (const m of feed) {
      if (
        m.from &&
        meetingMembers.includes(m.from) &&
        ["talk", "summary", "draft", "revision", "review"].includes(m.kind)
      )
        meetingSay[m.from] = m.text;
    }
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
      targets[a.id] = [d[0] - 1.1, d[1], d[2] + 1.2];
    } else {
      targets[a.id] = homeOf(a.id);
    }
  }
  targetsRef.current = targets;

  return (
    <>
      <ambientLight intensity={0.72} />
      <directionalLight position={[6, 14, 8]} intensity={1.05} />

      <Building />
      <Decor />
      <ExecRoom />
      <MeetingRoom active={meetingMembers.length > 0} />

      {AGENTS.map((a) => (
        <Desk
          key={`desk-${a.id}`}
          pos={DESK_POS[a.id]}
          big={a.id === "pm"}
          seed={[...a.id].reduce((s, ch) => s + ch.charCodeAt(0), 0)}
        />
      ))}
      {AGENTS.map((a) => (
        <Cat
          key={a.id}
          id={a.id}
          targetsRef={targetsRef}
          onSelect={onSelect}
          selected={selId === a.id}
          inMeeting={meetingMembers.includes(a.id)}
          say={meetingSay[a.id]}
        />
      ))}

      <CameraRig camApi={camApi} />
    </>
  );
}

/* ── 직원 정보 팝업 (캔버스 밖 오버레이) ───────────────── */
function AgentPopup({ id, onClose }: { id: string; onClose: () => void }) {
  const a = AGENT_MAP[id];
  const { agentStatus, livePeek } = useVE();
  if (!a) return null;
  const st = agentStatus[id] ?? "idle";
  const peek = livePeek[id] ?? "";
  const stLabel: Record<string, string> = { idle: "대기 중", running: "작업 중", done: "완료", error: "오류" };
  return (
    <div className="o3d-popup" style={{ borderColor: a.color }}>
      <div className="o3d-pop-head" style={{ background: `${a.color}22` }}>
        <span className="o3d-pop-emoji">{a.emoji}</span>
        <div className="o3d-pop-title">
          <div className="o3d-pop-name">{a.name}</div>
          <div className="o3d-pop-role">{a.role}</div>
        </div>
        <button className="o3d-pop-x" onClick={onClose} title="닫기">
          ✕
        </button>
      </div>
      <div className="o3d-pop-body">
        <div className="o3d-pop-meta">
          <span className={`o3d-pop-tag ${a.phase === "dev" ? "dev" : "plan"}`}>
            {a.phase === "dev" ? "🛠️ 개발팀 · 2F" : a.id === "pm" || a.id === "qa" ? "🎯 임원실" : "📝 기획팀 · 1F"}
          </span>
          <span className={`o3d-pop-status s-${st}`}>● {stLabel[st]}</span>
        </div>
        <div className="o3d-pop-sec">담당 · {a.sectionTitle}</div>
        {st === "running" && peek && (
          <div className="o3d-pop-peek">…{peek.replace(/[#*>`]/g, "").replace(/\s+/g, " ").slice(-90)}</div>
        )}
      </div>
      <div className="o3d-pop-actions">
        <button
          className="o3d-pop-btn primary"
          onClick={() => useVE.getState().selectAgent(id)}
          title="이 직원과 1:1 대화로 이동"
        >
          💬 채팅으로
        </button>
        <button className="o3d-pop-btn" onClick={() => useVE.getState().openProfile(id)} title="프로필·모델 설정">
          📋 프로필
        </button>
      </div>
    </div>
  );
}

/* ── 카메라 컨트롤 오버레이 (층 이동/회전/이동) ─────────── */
function ControlsOverlay({ camApi }: { camApi: React.MutableRefObject<CamApi> }) {
  const call = (fn: keyof CamApi, ...args: any[]) => (camApi.current[fn] as any)?.(...args);
  return (
    <div className="o3d-ctl">
      <div className="o3d-ctl-group">
        <button className="o3d-cbtn" onClick={() => call("focus", "1f")} title="1F 기획층으로">
          🏢 1F
        </button>
        <button className="o3d-cbtn" onClick={() => call("focus", "2f")} title="2F 개발층으로">
          🛠️ 2F
        </button>
        <button className="o3d-cbtn" onClick={() => call("focus", "meeting")} title="회의실로">
          🗣 회의실
        </button>
        <button className="o3d-cbtn" onClick={() => call("focus", "all")} title="건물 전체 보기">
          🏙 전체
        </button>
      </div>
      <div className="o3d-ctl-group">
        <button className="o3d-cbtn ic" onClick={() => call("rotate", -45)} title="왼쪽으로 돌리기">
          ⟲
        </button>
        <button className="o3d-cbtn ic" onClick={() => call("pan", -3, 0)} title="왼쪽으로 이동">
          ◀
        </button>
        <button className="o3d-cbtn ic" onClick={() => call("reset")} title="처음 시점으로">
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

export function Office3D() {
  const [selId, setSelId] = useState<string | null>(null);
  const camApi = useRef<CamApi>({});
  return (
    <div className="office3d-wrap">
      <Canvas dpr={[1, 1.5]} camera={{ position: DEFAULT_CAM.pos, fov: 48 }}>
        <color attach="background" args={["#171b24"]} />
        <fog attach="fog" args={["#171b24", 30, 52]} />
        <OfficeScene onSelect={setSelId} selId={selId} camApi={camApi} />
      </Canvas>
      <ControlsOverlay camApi={camApi} />
      {selId && <AgentPopup id={selId} onClose={() => setSelId(null)} />}
      <div className="o3d-hint dim">🖱 드래그 회전 · 우측 버튼으로 층 이동/좌우 이동 · 직원 클릭 → 정보·채팅</div>
    </div>
  );
}
