// Vision Engine 8개 에이전트 정의 (OpenClaw 설정과 동일한 id 사용)

export interface AgentDef {
  id: string;
  name: string;
  emoji: string;
  role: string;
  /** 이 에이전트가 소유한 마스터 GDD 섹션의 헤딩 접두사 */
  section: string;
  sectionTitle: string;
  color: string;
}

export const AGENTS: AgentDef[] = [
  { id: "pm", name: "PM 디렉터", emoji: "🎯", role: "총괄·컨셉·GDD 통합", section: "## 1.", sectionTitle: "개요", color: "#8b7cf6" },
  { id: "scenario", name: "시나리오 라이터", emoji: "📖", role: "세계관·스토리·캐릭터", section: "## 2.", sectionTitle: "세계관·스토리", color: "#f472b6" },
  { id: "gameplay", name: "게임플레이 디자이너", emoji: "🕹️", role: "코어 루프·메커니크", section: "## 3.", sectionTitle: "게임플레이", color: "#60a5fa" },
  { id: "systems", name: "시스템 디자이너", emoji: "⚙️", role: "성장·경제·콘텐츠 구조", section: "## 4.", sectionTitle: "시스템", color: "#fbbf24" },
  { id: "uiux", name: "UI/UX 디자이너", emoji: "🧭", role: "화면 구조·온보딩", section: "## 5.", sectionTitle: "UI/UX", color: "#34d399" },
  { id: "balance", name: "밸런스 디자이너", emoji: "⚖️", role: "수치·난이도 곡선", section: "## 6.", sectionTitle: "밸런스", color: "#a3e635" },
  { id: "bm", name: "BM 전략가", emoji: "💰", role: "수익모델·라이브옵스 (읽기 전용)", section: "## 7.", sectionTitle: "수익모델", color: "#fde047" },
  { id: "visual", name: "아트 디렉터", emoji: "🎨", role: "아트 스타일·팔레트", section: "## 8.", sectionTitle: "아트", color: "#e879f9" },
];

export const AGENT_MAP: Record<string, AgentDef> = Object.fromEntries(
  AGENTS.map((a) => [a.id, a])
);

/** PM을 제외한 전문 에이전트 목록 (오케스트레이션 팬아웃 대상) */
export const SPECIALISTS = AGENTS.filter((a) => a.id !== "pm");

/**
 * 교차 검토 배정 — 각 산출물을 가장 이해관계가 얽힌 동료가 검토한다.
 *   시나리오 ← 게임플레이 (이야기가 플레이로 구현 가능한가)
 *   게임플레이 ← 시스템   (루프를 시스템이 지탱하는가)
 *   시스템 ← 밸런스       (구조가 수치적으로 지속 가능한가)
 *   밸런스 ← 시스템       (공식이 시스템 구조와 맞는가)
 *   UI/UX ← 게임플레이    (화면 흐름이 플레이 리듬과 맞는가)
 *   BM ← 게임플레이       (과금이 재미를 해치지 않는가)
 *   아트 ← 시나리오       (비주얼이 세계관과 맞는가)
 */
export const REVIEWERS: Record<string, string> = {
  scenario: "gameplay",
  gameplay: "systems",
  systems: "balance",
  balance: "systems",
  uiux: "gameplay",
  bm: "gameplay",
  visual: "scenario",
};

/**
 * 증분(기획 보존) 지시 프롬프트 — 기존 GDD 섹션을 컨텍스트로 주고
 * 새 지시사항만 반영한 "갱신본"을 요구한다. 섹션이 비어 있으면 신규 작성 모드.
 */
export function specialistPrompt(
  request: string,
  agent: AgentDef,
  webResearch = false,
  currentSection = "",
  overview = ""
): string {
  const hasExisting = currentSection.trim().length > 0;
  const parts: string[] = [];
  if (overview.trim()) {
    parts.push(`[프로젝트 개요 — 참고용]`, overview.trim().slice(0, 400), ``);
  }
  if (hasExisting) {
    parts.push(
      `[현재 확정된 "${agent.sectionTitle}" 기획 — 이것이 기준이다]`,
      currentSection.slice(0, 1500),
      ``,
      `[오너의 새 지시사항]`,
      request.trim(),
      ``,
      `위 지시사항을 기존 기획에 **반영**해 "${agent.sectionTitle}" 섹션의 갱신본 전체를 작성해라.`,
      `- 지시와 무관한 기존 확정 내용은 그대로 유지해라. 지시가 요구하는 부분만 바꾸거나 추가해라.`,
      `- 기존 기획을 무시하고 처음부터 새로 쓰지 마라.`
    );
  } else {
    parts.push(
      `[프로젝트 요청]`,
      request.trim(),
      ``,
      `너의 워크스페이스 지침(AGENTS.md)의 산출물 형식에 따라, 이 게임의 "${agent.sectionTitle}" 파트를 새로 작성해라.`
    );
  }
  parts.push(
    `- 순수 마크다운 텍스트로만. 소제목(###) 사용.`,
    `- 20줄 이내로 간결하고 구체적으로.`,
    webResearch
      ? `- 최신 정보·레퍼런스가 필요하면 web_search / web_fetch 도구로 조사해도 된다(다른 도구는 금지). 조사한 내용은 출처와 함께 본문에 녹여라.`
      : `- 도구/함수 호출 금지.`
  );
  return parts.join("\n");
}

/**
 * 1:1 대화 결론에 대한 PM 검증 프롬프트 — 기존 기획과 대조하고
 * "### 반영안" 헤딩 아래 섹션 갱신 최종본을 요구한다.
 */
export function pmVerifyPrompt(agent: AgentDef, proposal: string, currentSection: string, overview: string): string {
  return [
    `너는 PM이다. 오너가 ${agent.name}와 1:1로 논의해 내린 결론이다:`,
    `---`,
    proposal.slice(0, 1500),
    `---`,
    overview.trim() ? `[프로젝트 개요 — 참고]\n${overview.trim().slice(0, 400)}` : ``,
    `[현재 GDD "${agent.sectionTitle}" 섹션]`,
    currentSection.slice(0, 1200) || `(아직 비어 있음)`,
    ``,
    `1) 이 결론이 기존 기획과 모순되거나 위험한 점이 있으면 최대 3줄로 짚어라. 없으면 "문제 없음"이라고 써라.`,
    `2) 반영 권고 여부를 한 줄로 밝혀라.`,
    `3) 마지막에 반드시 "### 반영안" 헤딩을 쓰고, 그 아래에 결론을 반영한 "${agent.sectionTitle}" 섹션 갱신본 전체를 작성해라.`,
    `   (기존 내용 중 결론과 무관한 부분은 유지)`,
    `총 30줄 이내, 순수 마크다운, 도구 호출 금지.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** 동료 검토 지시 (reviewer 에이전트에게 전송) */
export function reviewPrompt(request: string, author: AgentDef, reviewer: AgentDef, draft: string): string {
  return [
    `[프로젝트 요청]`,
    request.trim(),
    ``,
    `동료 ${author.name}가 작성한 "${author.sectionTitle}" 초안이다:`,
    `---`,
    draft.slice(0, 1500),
    `---`,
    `너(${reviewer.name})의 전문 관점에서 이 초안을 검토해라.`,
    `형식: 좋은 점 1개 → 문제점 최대 2개 → 구체적 개선 제안 최대 2개.`,
    `8줄 이내, 순수 마크다운. 도구/함수 호출 금지.`,
  ].join("\n");
}

/** 검토 반영 수정 지시 (원 작성자에게 전송 — 같은 세션이라 초안 맥락 유지됨) */
export function revisePrompt(author: AgentDef, reviewer: AgentDef, review: string): string {
  return [
    `동료 ${reviewer.name}가 네 "${author.sectionTitle}" 초안을 검토한 의견이다:`,
    `---`,
    review.slice(0, 1000),
    `---`,
    `타당한 지적만 반영해 초안을 수정하고, 수정된 최종본 전체만 출력해라.`,
    `20줄 이내, 순수 마크다운. 도구/함수 호출 금지. 검토에 대한 답변이나 사족은 쓰지 마라.`,
  ].join("\n");
}

export function pmSummaryPrompt(
  request: string,
  outputs: { agent: AgentDef; text: string }[],
  currentOverview = ""
): string {
  const digest = outputs
    .map(({ agent, text }) => `### ${agent.sectionTitle} (${agent.name})\n${text.slice(0, 400)}`)
    .join("\n\n");
  const hasExisting = currentOverview.trim().length > 0;
  return [
    hasExisting ? `[현재 "1. 개요" 섹션 — 이것이 기준이다]\n${currentOverview.slice(0, 800)}\n` : ``,
    `[오너의 새 지시사항]`,
    request.trim(),
    ``,
    `[이번에 갱신된 산출물 요약]`,
    digest,
    ``,
    hasExisting
      ? `기존 개요를 유지하되, 이번 지시와 갱신 산출물이 요구하는 부분만 반영해 "1. 개요" 갱신본을 작성해라. 처음부터 새로 쓰지 마라.`
      : `위 산출물을 종합해 마스터 GDD의 "1. 개요" 섹션을 작성해라.`,
    `형식: 한 줄 피치 → 장르/플랫폼/타깃 → 핵심 루프 3줄 → 차별점 2개 → 산출물 간 충돌·조정 필요 사항(있으면 1~2개).`,
    `12줄 이내 순수 마크다운. 도구/함수 호출 금지.`,
  ]
    .filter(Boolean)
    .join("\n");
}
