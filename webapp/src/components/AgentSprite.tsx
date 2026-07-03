import { AGENT_MAP } from "../lib/agents";

/**
 * 픽셀풍 고양이 스튜디오 캐릭터 — 에이전트 색상 + 역할 소품으로 구분.
 * (보이는 사무실 v2: 이모지 → 커스텀 스프라이트)
 */

function Accessory({ id, c }: { id: string; c: string }) {
  switch (id) {
    case "pm": // 헤드셋 + 스타 배지
      return (
        <>
          <path d="M10 19 Q20 9 30 19" stroke="#3b4252" strokeWidth="2.2" fill="none" />
          <rect x="8.4" y="18" width="3.4" height="6" rx="1.6" fill="#3b4252" />
          <rect x="28.2" y="18" width="3.4" height="6" rx="1.6" fill="#3b4252" />
          <path d="M29 24 q-2 4 -6 4.5" stroke="#3b4252" strokeWidth="1.4" fill="none" />
          <path d="M20 30.4 l1.1 2.2 2.4.3-1.7 1.7.4 2.4-2.2-1.1-2.2 1.1.4-2.4-1.7-1.7 2.4-.3z" fill="#ffd76a" />
        </>
      );
    case "scenario": // 안경 + 책
      return (
        <>
          <circle cx="16.5" cy="22.5" r="3.4" fill="none" stroke="#3b4252" strokeWidth="1.2" />
          <circle cx="23.5" cy="22.5" r="3.4" fill="none" stroke="#3b4252" strokeWidth="1.2" />
          <path d="M19.9 22.5 h0.6" stroke="#3b4252" strokeWidth="1.2" />
          <rect x="24.5" y="30.5" width="7.5" height="5.5" rx="1" fill="#fff" stroke={c} strokeWidth="1" />
          <path d="M28.2 31 v4.5" stroke={c} strokeWidth="0.8" />
        </>
      );
    case "gameplay": // 캡모자 + 십자키
      return (
        <>
          <path d="M10.5 15.5 Q20 7.5 29.5 15.5 L29.5 13 Q20 5.5 10.5 13 Z" fill="#3d6fb4" />
          <rect x="24" y="10" width="11" height="3.4" rx="1.7" fill="#3d6fb4" />
          <path d="M18.6 31 h2.8 v2.2 h2.2 v2.8 h-2.2 v2.2 h-2.8 v-2.2 h-2.2 v-2.8 h2.2 z" fill="#39424e" transform="translate(0,-1.5)" />
        </>
      );
    case "systems": // 기어
      return (
        <>
          <g transform="translate(28.5,32.5)">
            <circle r="3.6" fill="#9aa5b1" />
            <circle r="1.5" fill="#39424e" />
            {[0, 45, 90, 135, 180, 225, 270, 315].map((d) => (
              <rect key={d} x="-0.9" y="-5.2" width="1.8" height="2" fill="#9aa5b1" transform={`rotate(${d})`} />
            ))}
          </g>
        </>
      );
    case "uiux": // 나침반 바늘 배지
      return (
        <>
          <circle cx="20" cy="33" r="3.6" fill="#eef2f6" stroke={c} strokeWidth="1" />
          <path d="M20 30.2 l1.3 2.8 -1.3 2.8 -1.3 -2.8 z" fill="#e05a5a" />
        </>
      );
    case "balance": // 저울
      return (
        <>
          <path d="M20 30 v4" stroke="#8a94a3" strokeWidth="1.3" />
          <path d="M15.5 31 h9" stroke="#8a94a3" strokeWidth="1.3" />
          <path d="M15.5 31 l-1.6 3 h3.2 z M24.5 31 l-1.6 3 h3.2 z" fill="#c9a648" />
        </>
      );
    case "bm": // 넥타이 + 동전
      return (
        <>
          <path d="M20 29 l-1.8 2 1.8 5 1.8 -5 z" fill="#b03a48" />
          <circle cx="28.5" cy="33" r="3" fill="#ffd76a" stroke="#c9a648" strokeWidth="1" />
          <path d="M28.5 31.4 v3.2 M27.3 32.2 h2.4" stroke="#c9a648" strokeWidth="0.9" />
        </>
      );
    case "visual": // 베레모 + 붓
      return (
        <>
          <path d="M10.5 14.5 Q20 6 29.5 14.5 Q20 11.5 10.5 14.5 Z" fill="#7a4fb0" />
          <circle cx="20" cy="7.8" r="1.5" fill="#7a4fb0" />
          <path d="M26 36 l4.5 -4.5" stroke="#8a6238" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M30.5 31.5 l1.8 -1.8" stroke={c} strokeWidth="2.6" strokeLinecap="round" />
        </>
      );
    case "td": // 보안경 + 렌치
      return (
        <>
          <rect x="12.5" y="20.6" width="7" height="3.8" rx="1.9" fill="none" stroke="#3b4252" strokeWidth="1.2" />
          <rect x="20.5" y="20.6" width="7" height="3.8" rx="1.9" fill="none" stroke="#3b4252" strokeWidth="1.2" />
          <path d="M12.5 22 h-2 M27.5 22 h2" stroke="#3b4252" strokeWidth="1.2" />
          <path d="M25.5 36 l4 -4" stroke="#9aa5b1" strokeWidth="2" strokeLinecap="round" />
          <path d="M29 32.5 a2.4 2.4 0 1 0 2.4 -2.4 l-1.4 1 z" fill="#9aa5b1" />
        </>
      );
    case "marketing": // 선글라스 + 확성기
      return (
        <>
          <rect x="12.8" y="20.8" width="6.6" height="3.4" rx="1.5" fill="#2a2f38" />
          <rect x="20.6" y="20.8" width="6.6" height="3.4" rx="1.5" fill="#2a2f38" />
          <path d="M19.4 22.2 h1.2" stroke="#2a2f38" strokeWidth="1.2" />
          <path d="M25.5 35.5 l4.5 -3 v6 z" fill={c} />
          <rect x="23.5" y="34" width="2.4" height="3" rx="0.8" fill="#8a94a3" />
        </>
      );
    case "scheduler": // 헤어밴드 + 달력 배지
      return (
        <>
          <path d="M11 15.5 Q20 9.5 29 15.5" stroke={c} strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <rect x="24.5" y="30" width="7.5" height="6.5" rx="1" fill="#fff" stroke="#c96a2c" strokeWidth="1" />
          <rect x="24.5" y="30" width="7.5" height="2" fill="#c96a2c" />
          <path d="M26.5 34 h1.4 M29.5 34 h1.4 M26.5 35.6 h1.4" stroke="#c96a2c" strokeWidth="0.9" />
        </>
      );
    case "qa": // 돋보기 + 체크리스트
      return (
        <>
          <circle cx="27.5" cy="31" r="3.2" fill="none" stroke="#3b4252" strokeWidth="1.4" />
          <path d="M29.8 33.4 l2.6 2.6" stroke="#3b4252" strokeWidth="1.6" strokeLinecap="round" />
          <rect x="9" y="29.5" width="7" height="7" rx="1" fill="#fff" stroke="#94a3b8" strokeWidth="1" />
          <path d="M10.5 32 l1.2 1.2 2.2-2.4" stroke="#3ba55d" strokeWidth="1.2" fill="none" />
        </>
      );
    default:
      return null;
  }
}

export function AgentSprite({ id, size = 40 }: { id: string; size?: number }) {
  const a = AGENT_MAP[id];
  if (!a) return null;
  const c = a.color;
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-label={a.name}>
      {/* 고양이 귀 */}
      <path d="M10.5 17 L12 8.5 L17.5 13.5 Z" fill={c} />
      <path d="M29.5 17 L28 8.5 L22.5 13.5 Z" fill={c} />
      <path d="M12.4 10.8 L13.2 13.8 L15.8 13 Z" fill="#f5b8c4" opacity="0.85" />
      <path d="M27.6 10.8 L26.8 13.8 L24.2 13 Z" fill="#f5b8c4" opacity="0.85" />
      {/* 몸통 */}
      <rect x="8" y="13" width="24" height="24" rx="8" fill={c} />
      {/* 얼굴 */}
      <rect x="11.2" y="16.5" width="17.6" height="12.5" rx="5.5" fill="#f7ead9" />
      {/* 눈/입/볼 */}
      <circle cx="16.5" cy="22.3" r="1.6" fill="#2a2f38" />
      <circle cx="23.5" cy="22.3" r="1.6" fill="#2a2f38" />
      <circle cx="17" cy="21.8" r="0.5" fill="#fff" />
      <circle cx="24" cy="21.8" r="0.5" fill="#fff" />
      <path d="M18 26 q2 1.8 4 0" stroke="#2a2f38" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      <circle cx="13.6" cy="25" r="1.2" fill="#f5b8c4" opacity="0.7" />
      <circle cx="26.4" cy="25" r="1.2" fill="#f5b8c4" opacity="0.7" />
      <Accessory id={id} c={c} />
    </svg>
  );
}
