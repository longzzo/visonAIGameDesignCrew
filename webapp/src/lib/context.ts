export interface ContextPolicy {
  /** 회의마다 공유 기억(결정·옵시디안·검색 근거)에 허용할 입력 토큰 추정치 */
  budgetTokens: number;
  /** GDD·결정 원장이 바뀌면 체크포인트를 자동으로 다시 만든다 */
  autoSnapshot: boolean;
  /** 체크포인트를 옵시디안 VisionEngine/<프로젝트>/AI 컨텍스트.md에 미러링한다 */
  obsidianMirror: boolean;
}

export interface ContextSnapshot {
  ok: boolean;
  project: string;
  generatedAt: number;
  stale: boolean;
  sourceTokens: number;
  packetTokens: number;
  savedTokens: number;
  reductionPercent: number;
  notePath: string | null;
  localPath: string | null;
  packet: string;
  policy: ContextPolicy;
}

export interface ContextBlock {
  id: string;
  label: string;
  text: string;
  /** 숫자가 클수록 먼저 보존한다. */
  priority: number;
  /** 한 블록이 예산을 독점하지 못하게 하는 상한. */
  maxTokens?: number;
}

export interface BudgetedContext {
  text: string;
  sourceTokens: number;
  usedTokens: number;
  savedTokens: number;
  omitted: string[];
  compressed: string[];
}

export const DEFAULT_CONTEXT_POLICY: ContextPolicy = {
  budgetTokens: 2400,
  autoSnapshot: true,
  obsidianMirror: true,
};

/** 한국어·마크다운 혼합 입력의 보수적인 로컬 추정치. 과금 수치가 아닌 예산 가드용이다. */
export function estimateContextTokens(text: string): number {
  return text.trim() ? Math.max(1, Math.ceil(text.length / 2.5)) : 0;
}

function clipAtBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text.trim();
  const raw = text.slice(0, Math.max(0, maxChars - 18));
  const newline = raw.lastIndexOf("\n");
  const space = raw.lastIndexOf(" ");
  const cut = Math.max(newline >= raw.length * 0.55 ? newline : -1, space >= raw.length * 0.7 ? space : -1);
  return `${raw.slice(0, cut > 0 ? cut : raw.length).trimEnd()}\n… [예산에 맞춰 압축]`;
}

/**
 * 여러 기억 블록을 우선순위·개별 상한·총 토큰 예산에 맞춰 조립한다.
 * 조용히 잘라내지 않고 압축 표식과 누락 목록을 남긴다.
 */
export function buildBudgetedContext(blocks: ContextBlock[], budgetTokens: number): BudgetedContext {
  const budget = Math.max(400, Math.min(8000, Math.round(budgetTokens || DEFAULT_CONTEXT_POLICY.budgetTokens)));
  const usable = blocks
    .filter((b) => b.text.trim())
    .map((b, index) => ({ ...b, index, tokens: estimateContextTokens(b.text) }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index);
  const sourceTokens = usable.reduce((sum, b) => sum + b.tokens, 0);
  const out: string[] = [];
  const omitted: string[] = [];
  const compressed: string[] = [];
  let remaining = budget;

  for (const block of usable) {
    // 제목과 최소 한 문단을 못 넣는다면 명시적으로 누락한다.
    if (remaining < 80) {
      omitted.push(block.label);
      continue;
    }
    const headerTokens = estimateContextTokens(`[${block.label}]\n`);
    const blockLimit = Math.max(80, block.maxTokens ?? remaining);
    const allowance = Math.max(40, Math.min(remaining - headerTokens, blockLimit - headerTokens));
    const clipped = clipAtBoundary(block.text.trim(), Math.floor(allowance * 2.5));
    const rendered = `[${block.label}]\n${clipped}`;
    const used = estimateContextTokens(rendered);
    if (used > remaining) {
      omitted.push(block.label);
      continue;
    }
    if (clipped.length < block.text.trim().length) compressed.push(block.label);
    out.push(rendered);
    remaining -= used;
  }

  if (omitted.length && remaining >= 30) {
    const notice = `※ 예산 초과로 제외: ${omitted.join(", ")}`;
    if (estimateContextTokens(notice) <= remaining) out.push(notice);
  }
  const text = out.join("\n\n");
  const usedTokens = estimateContextTokens(text);
  return {
    text,
    sourceTokens,
    usedTokens,
    savedTokens: Math.max(0, sourceTokens - usedTokens),
    omitted,
    compressed,
  };
}

export async function getContextSnapshot(project: string, rebuild = false): Promise<ContextSnapshot> {
  const r = await fetch(`/api/obsidian/context?project=${encodeURIComponent(project)}${rebuild ? "&rebuild=1" : ""}`);
  const j = await r.json();
  if (!r.ok || !j?.ok) throw new Error(j?.error || "컨텍스트 체크포인트를 읽지 못했습니다");
  return j as ContextSnapshot;
}

export async function saveContextPolicy(project: string, policy: ContextPolicy): Promise<ContextSnapshot> {
  const r = await fetch("/api/obsidian/context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project, action: "policy", policy }),
  });
  const j = await r.json();
  if (!r.ok || !j?.ok) throw new Error(j?.error || "컨텍스트 정책을 저장하지 못했습니다");
  return j as ContextSnapshot;
}
