// 토큰 사용량 → 비용 추정 + 무한 반복(비용 폭탄) 가드 설정.
// 단가는 공개 요금표 기준의 "추정치"다 — 실제 청구는 각 제공자 대시보드가 정답.

export interface PriceRule {
  match: RegExp;
  label: string;
  /** USD per 1M tokens */
  inPrice: number;
  outPrice: number;
  note?: string;
}

export const PRICING: PriceRule[] = [
  { match: /^ollama\//i, label: "로컬 Ollama", inPrice: 0, outPrice: 0, note: "무료 · 무제한 (전기값만)" },
  { match: /nvidia/i, label: "NVIDIA NIM", inPrice: 0, outPrice: 0, note: "무료 크레딧 차감 (요청당 1크레딧, 가입 시 1,000)" },
  { match: /gpt-5|github/i, label: "GitHub Models (GPT-5급)", inPrice: 1.25, outPrice: 10, note: "유료 결제 시 추정 단가" },
  { match: /claude/i, label: "Anthropic Claude", inPrice: 3, outPrice: 15, note: "Sonnet급 추정 단가" },
];
const FALLBACK: PriceRule = { match: /./, label: "알 수 없는 제공자", inPrice: 2, outPrice: 8, note: "보수적 추정" };

export function priceFor(model: string): PriceRule {
  return PRICING.find((p) => p.match.test(model)) ?? FALLBACK;
}

/** 추정 비용(USD) — inputTk/outputTk는 토큰 수 */
export function estimateCost(model: string, inputTk: number, outputTk: number): number {
  const p = priceFor(model);
  return (inputTk * p.inPrice + outputTk * p.outPrice) / 1_000_000;
}

export function fmtUsd(v: number): string {
  if (v === 0) return "$0";
  if (v < 0.01) return "<$0.01";
  return `$${v.toFixed(2)}`;
}

/* ── 비용 가드 (무한 반복 폭주 차단) ─────────────────── */

export interface CostGuard {
  enabled: boolean;
  /** 10분 슬라이딩 윈도 내 최대 LLM 호출 수 — 초과 시 호출 차단 + 진행 중 작업 중단 */
  maxPer10Min: number;
}
const GUARD_KEY = "ve-cost-guard";
export const GUARD_DEFAULT: CostGuard = { enabled: true, maxPer10Min: 60 };

export function loadGuard(): CostGuard {
  try {
    const g = JSON.parse(localStorage.getItem(GUARD_KEY) ?? "");
    if (typeof g?.maxPer10Min === "number" && typeof g?.enabled === "boolean") return g;
  } catch {
    /* noop */
  }
  return { ...GUARD_DEFAULT };
}
export function saveGuard(g: CostGuard) {
  try {
    localStorage.setItem(GUARD_KEY, JSON.stringify(g));
  } catch {
    /* noop */
  }
}
